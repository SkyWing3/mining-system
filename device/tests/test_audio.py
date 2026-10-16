import io
import json
import queue
import tempfile
import threading
import unittest
import wave
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from src.audio import wav
from src.audio.recorder import ArecordRecorder, RecorderError, SimulatedRecorder
from src.communication.uploader import VoiceUploader
from src.communication.voice_queue import VoiceQueue, VoiceQueueFull


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class FakeProcess:
    def __init__(self, data: bytes):
        self.stdout = io.BytesIO(data)
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = 0

    def kill(self):
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


class WavTests(unittest.TestCase):
    def test_encode_produces_mono_16_bit_pcm(self):
        samples = wav.synthetic_voice(1.0, 16000)
        data = wav.encode(samples, 16000)
        with wave.open(io.BytesIO(data)) as reader:
            self.assertEqual((reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getnframes()), (1, 2, 16000, 16000))

    def test_normalize_raises_quiet_audio_without_clipping(self):
        quiet = array("h", [0, 1000, -2000, 500])
        louder = wav.normalize(quiet, max_gain=8)
        self.assertEqual(max(abs(sample) for sample in louder), 16000)
        loud = array("h", [32767, -32768])
        self.assertEqual(list(wav.normalize(loud)), list(loud))
        self.assertEqual(list(wav.normalize(array("h", [0, 0]))), [0, 0])

    def test_arecord_recorder_streams_raw_samples(self):
        raw = array("h", [100] * 16000).tobytes()
        commands = []

        def popen(command, **_):
            commands.append(command)
            return FakeProcess(raw)

        clock = Clock()
        recorder = ArecordRecorder("plughw:1", 16000, 30, popen=popen, clock=clock)
        recorder.start()
        self.assertTrue(recorder.recording)
        self.assertIn("S16_LE", commands[0])
        recording = recorder.stop()
        self.assertEqual(recording.duration_ms, 1000)
        self.assertFalse(recorder.recording)
        with self.assertRaises(RecorderError):
            recorder.stop()

    def test_short_or_missing_recordings_fail(self):
        recorder = ArecordRecorder("plughw:1", 16000, 30, popen=lambda *_, **__: FakeProcess(b"\x00\x00" * 100))
        recorder.start()
        with self.assertRaises(RecorderError):
            recorder.stop()

        def missing(*_, **__):
            raise FileNotFoundError("arecord")

        with self.assertRaises(RecorderError):
            ArecordRecorder("plughw:1", 16000, 30, popen=missing).start()

    def test_simulated_recorder_uses_elapsed_time(self):
        clock = Clock()
        recorder = SimulatedRecorder(16000, 10, clock)
        recorder.start()
        clock.now = 3.2
        self.assertEqual(recorder.stop().duration_ms, 3200)


class Handler(BaseHTTPRequestHandler):
    responses: list = []
    received: list = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).received.append((dict(self.headers), body))
        status = type(self).responses.pop(0) if type(self).responses else 201
        payload = json.dumps({"message": "rechazado"} if status >= 400 else {"duplicate": False}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


class VoiceUploadTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.voices = VoiceQueue(Path(self.folder.name) / "voice", max_pending=2)
        Handler.responses, Handler.received = [], []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.events = queue.Queue()
        self.uploader = VoiceUploader(f"http://127.0.0.1:{self.server.server_port}/api/device/voice", "b" * 64, self.voices, self.events)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def test_queue_limit_and_persistence(self):
        audio = wav.encode(wav.synthetic_voice(0.5, 16000), 16000)
        first = self.voices.enqueue(audio, 500)
        self.voices.enqueue(audio, 500)
        with self.assertRaises(VoiceQueueFull):
            self.voices.enqueue(audio, 500)
        reopened = VoiceQueue(self.voices.path, 2)
        self.assertEqual(reopened.first().voice_id, first)
        self.assertEqual(reopened.first().audio.read_bytes(), audio)

    def test_upload_sends_headers_and_removes_on_success(self):
        audio = wav.encode(wav.synthetic_voice(0.5, 16000), 16000)
        voice_id = self.voices.enqueue(audio, 500)
        self.assertTrue(self.uploader.upload_next())
        headers, body = Handler.received[0]
        self.assertEqual(body, audio)
        self.assertEqual(headers["X-Client-Message-Id"], voice_id)
        self.assertEqual(headers["X-Device-Key"], "b" * 64)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertEqual(self.voices.pending, 0)
        self.assertEqual(self.events.get_nowait().kind, "uploaded")
        self.assertIsNone(self.uploader.upload_next())

    def test_transient_errors_keep_and_invalid_audio_is_quarantined(self):
        audio = wav.encode(wav.synthetic_voice(0.5, 16000), 16000)
        self.voices.enqueue(audio, 500)
        Handler.responses = [409, 503, 400]
        self.assertFalse(self.uploader.upload_next())
        self.assertFalse(self.uploader.upload_next())
        self.assertEqual(self.voices.pending, 1)
        self.assertTrue(self.uploader.upload_next())
        self.assertEqual(self.voices.pending, 0)
        rejected = self.events.get_nowait()
        self.assertEqual((rejected.kind, rejected.detail), ("rejected", "rechazado"))
        self.assertEqual(len(list((self.voices.path / "rejected").glob("*.wav"))), 1)

    def test_unreachable_central_is_retried(self):
        self.voices.enqueue(wav.encode(wav.synthetic_voice(0.5, 16000), 16000), 500)
        offline = VoiceUploader("http://127.0.0.1:9/api/device/voice", "b" * 64, self.voices, self.events)
        self.assertFalse(offline.upload_next())
        self.assertEqual(self.voices.pending, 1)


if __name__ == "__main__":
    unittest.main()
