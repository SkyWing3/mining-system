// Orquestación completa sin hardware (equivalente a tests/test_app.py).
#include <unity.h>

#include <ArduinoJson.h>

#include "../fakes.h"
#include "mining/app.h"

using namespace mining;

void setUp() {}
void tearDown() {}

namespace {

struct Harness {
    explicit Harness(bool configured = true, bool voice = true) {
        std::string error;
        TEST_ASSERT_TRUE(parseSettings(std::string(defaultSettingsJson()), settings, error));
        if (configured) {
            settings.wifi.ssid = "Mina";
            settings.connection->apiKey = std::string(64, 'a');
        }
        settings.alerts.confirmSamples = 1;
        settings.voice.enabled = voice;
        evaluator = ThresholdEvaluator(settings.alerts);
        outbox.load(error);
        voices.load(error);
        AppContext context;
        context.settings = &settings;
        context.outputs = &outputs;
        context.clock = &wall;
        context.monotonic = clock.fn();
        if (configured) {
            context.outbox = &outbox;
            context.wakeLink = [this] { ++linkWakes; };
            if (voice) {
                context.voices = &voices;
                context.wakeUploader = [this] { ++uploaderWakes; };
            }
        }
        if (voice) context.recorder = &recorder;
        app.reset(new Application(context));
    }

    void press(Action action, int times = 1) {
        for (int i = 0; i < times; ++i) app->process(action);
    }

    void reading(double ppm, bool simulated = false) {
        SensorSnapshot snapshot;
        snapshot.coPpm = ppm;
        snapshot.coState = CoState::Ok;
        snapshot.simulated = simulated;
        MonitorUpdate update;
        update.snapshot = snapshot;
        update.assessment = evaluator.update(snapshot);
        app->process(update);
    }

    std::vector<std::string> codes() {
        std::vector<std::string> result;
        while (auto entry = outbox.first(false)) {
            JsonDocument frame;
            deserializeJson(frame, entry->frame);
            result.push_back(std::string(frame["code"] | "") + "|" + std::string(frame["detail"] | ""));
            outbox.acknowledge(entry->id);
        }
        return result;
    }

    Settings settings;
    FakeClock clock;
    Counter random;
    MemoryStore store;
    WallClock wall{1, clock.fn()};
    Outbox outbox{store, "/out", random.fn()};
    VoiceQueue voices{store, "/voice", 2, random.fn()};
    RecordingOutputs outputs;
    FakeRecorder recorder{clock.fn()};
    ThresholdEvaluator evaluator{settings.alerts};
    std::unique_ptr<Application> app;
    int linkWakes = 0;
    int uploaderWakes = 0;
};

}  // namespace

void test_danger_sends_one_automatic_alarm_per_transition() {
    Harness h;
    h.reading(250, true);
    h.reading(260, true);
    TEST_ASSERT_TRUE(h.app->menu().alarmVisible);
    TEST_ASSERT_EQUAL(LedColor::Red, h.outputs.last("led")->color);
    std::vector<std::string> codes = h.codes();
    TEST_ASSERT_EQUAL(1u, codes.size());
    TEST_ASSERT_EQUAL_STRING("CO_ALARM|CO 250 ppm (simulado)", codes[0].c_str());
    // Back to normal re-arms the alarm.
    h.reading(5);
    h.reading(250);
    codes = h.codes();
    TEST_ASSERT_EQUAL(1u, codes.size());
    TEST_ASSERT_EQUAL_STRING("CO_ALARM|CO 250 ppm", codes[0].c_str());
}

void test_message_from_menu_is_queued() {
    Harness h;
    h.press(Action::Down, kMessagesPage);
    h.press(Action::Enter, 3);
    TEST_ASSERT_EQUAL_STRING("Guardado en cola", h.app->menu().deliveryStatus.c_str());
    TEST_ASSERT_EQUAL(1u, h.app->menu().pendingMessages);
    TEST_ASSERT_TRUE(h.linkWakes > 0);
    // Each press gives a short vibration as feedback.
    TEST_ASSERT_EQUAL(kMessagesPage + 3, static_cast<int>(h.outputs.count("vibrate")));
    TEST_ASSERT_EQUAL_STRING("HELP|", h.codes()[0].c_str());
}

void test_notice_is_confirmed_durably() {
    Harness h;
    NoticeReceived notice;
    notice.noticeId = 31;
    notice.text = "Ir al refugio";
    h.app->process(notice);
    TEST_ASSERT_EQUAL(LedColor::Blue, h.outputs.last("led")->color);
    TEST_ASSERT_TRUE(h.outputs.last("led")->blink);
    h.press(Action::Enter);
    TEST_ASSERT_TRUE(h.outbox.hasNoticeAck(31, "read"));
    TEST_ASSERT_TRUE(h.outputs.last("led")->blink == false);
}

void test_voice_flow_records_queues_and_confirms_upload() {
    Harness h;
    h.store.files["/rec.wav"] = "RIFF";
    h.press(Action::Down, kVoicePage);
    h.press(Action::Enter, 2);
    TEST_ASSERT_TRUE(h.recorder.recording());
    h.clock.now += 3500;
    h.app->tick();
    TEST_ASSERT_EQUAL(3, h.app->menu().recordingSeconds);
    h.press(Action::Enter);
    TEST_ASSERT_EQUAL(VoiceMode::Confirm, h.app->menu().voiceMode);
    TEST_ASSERT_EQUAL(3500, h.app->menu().voiceDurationMs);
    h.press(Action::Enter);
    TEST_ASSERT_EQUAL_STRING("Guardado en cola", h.app->menu().voiceStatus.c_str());
    TEST_ASSERT_EQUAL(1u, h.app->menu().pendingVoices);
    TEST_ASSERT_EQUAL(1, h.uploaderWakes);
    std::string id = h.app->menu().pendingVoiceId;
    h.app->process(VoiceEvent{true, id, ""});
    TEST_ASSERT_EQUAL_STRING("Enviado a central", h.app->menu().voiceStatus.c_str());
}

void test_recording_stops_at_the_limit_and_can_be_discarded() {
    Harness h;
    h.press(Action::Down, kVoicePage);
    h.press(Action::Enter, 2);
    h.clock.now += h.settings.voice.maxSeconds * 1000;
    h.app->tick();
    TEST_ASSERT_FALSE(h.recorder.recording());
    TEST_ASSERT_EQUAL(VoiceMode::Confirm, h.app->menu().voiceMode);
    h.press(Action::Down);
    h.press(Action::Enter);
    TEST_ASSERT_TRUE(h.recorder.discarded);
    TEST_ASSERT_EQUAL(0, h.voices.pending());
    // A failing microphone is reported on the OLED.
    h.recorder.startError = "Micro no disponible";
    h.press(Action::Enter);
    TEST_ASSERT_EQUAL(VoiceMode::Result, h.app->menu().voiceMode);
    TEST_ASSERT_EQUAL_STRING("Micro no disponible", h.app->menu().voiceStatus.c_str());
}

void test_full_voice_queue_blocks_new_recordings() {
    Harness h;
    for (int i = 0; i < 2; ++i) {
        std::string id;
        h.store.files["/rec.wav"] = "RIFF";
        TEST_ASSERT_EQUAL(VoiceQueue::Result::Ok, h.voices.enqueue("/rec.wav", 1000, 1, Stamp{}, id));
    }
    h.press(Action::Down, kVoicePage);
    h.press(Action::Enter, 2);
    TEST_ASSERT_FALSE(h.recorder.recording());
    TEST_ASSERT_EQUAL_STRING("Cola de voz llena", h.app->menu().voiceStatus.c_str());
}

void test_unconfigured_device_never_claims_delivery() {
    Harness h(false);
    TEST_ASSERT_EQUAL(LedColor::Green, h.outputs.last("led")->color);
    h.press(Action::Down, kMessagesPage);
    h.press(Action::Enter, 3);
    TEST_ASSERT_EQUAL_STRING("Sin configurar", h.app->menu().deliveryStatus.c_str());
    h.press(Action::Enter);
    h.press(Action::Up);
    h.press(Action::Enter);
    h.press(Action::Down, 1);
    h.press(Action::Enter, 2);
    TEST_ASSERT_EQUAL_STRING("Sin configurar", h.app->menu().voiceStatus.c_str());
    FakeCanvas canvas;
    h.app->render(canvas);
    TEST_ASSERT_TRUE(canvas.hasText("Central: sin configurar"));
    Harness mute(true, false);
    mute.press(Action::Down, kVoicePage);
    mute.press(Action::Enter, 2);
    TEST_ASSERT_EQUAL_STRING("Voz desactivada", mute.app->menu().voiceStatus.c_str());
}

void test_link_events_drive_the_led() {
    Harness h;
    TEST_ASSERT_EQUAL(LedColor::Blue, h.outputs.last("led")->color);
    h.app->process(TransportEvent{TransportKind::Connected, "", "", {}});
    TEST_ASSERT_EQUAL(LedColor::Green, h.outputs.last("led")->color);
    h.app->process(TransportEvent{TransportKind::Disconnected, "", "timeout", {}});
    TEST_ASSERT_EQUAL(LedColor::Blue, h.outputs.last("led")->color);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_danger_sends_one_automatic_alarm_per_transition);
    RUN_TEST(test_message_from_menu_is_queued);
    RUN_TEST(test_notice_is_confirmed_durably);
    RUN_TEST(test_voice_flow_records_queues_and_confirms_upload);
    RUN_TEST(test_recording_stops_at_the_limit_and_can_be_discarded);
    RUN_TEST(test_full_voice_queue_blocks_new_recordings);
    RUN_TEST(test_unconfigured_device_never_claims_delivery);
    RUN_TEST(test_link_events_drive_the_led);
    return UNITY_END();
}
