"""Genera una pista ambiental original para el video promocional (public/music.wav)."""
import sys
import wave

import numpy as np

SR = 44100
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 80.0
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/music.wav"
BPM = 96
BEAT = 60 / BPM

t = np.arange(int(SR * DURATION)) / SR
mix = np.zeros((len(t), 2))


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# Progresión: Am - F - C - G (dos compases cada acorde)
chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
bar = BEAT * 4
chord_len = bar * 2

# Pad suave con ataque y relajación lentos
for i in range(int(DURATION / chord_len) + 1):
    start = i * chord_len
    chord = chords[i % len(chords)]
    s0 = int(start * SR)
    s1 = min(len(t), int((start + chord_len + 1.5) * SR))
    if s0 >= len(t):
        break
    seg = t[s0:s1] - start
    env = np.minimum(1, seg / 1.2) * np.clip((chord_len + 1.5 - seg) / 1.5, 0, 1)
    for j, m in enumerate(chord):
        f = note(m)
        tone = 0.6 * np.sin(2 * np.pi * f * seg) + 0.25 * np.sin(2 * np.pi * 2 * f * seg + 0.3) + 0.1 * np.sin(2 * np.pi * 3 * f * seg)
        lfo = 1 + 0.004 * np.sin(2 * np.pi * (0.2 + j * 0.07) * seg)
        tone *= lfo
        pan = 0.3 + 0.4 * (j / 3)
        mix[s0:s1, 0] += tone * env * 0.045 * (1 - pan)
        mix[s0:s1, 1] += tone * env * 0.045 * pan
    # Bajo
    f = note(chord[0] - 12)
    bass = np.sin(2 * np.pi * f * seg) * env * 0.09
    mix[s0:s1] += bass[:, None]

# Pulso: bombo suave y arpegio a partir del compás 4
beats = int(DURATION / BEAT)
for b in range(beats):
    start = b * BEAT
    if start < bar * 4:
        continue
    s0 = int(start * SR)
    n = int(0.35 * SR)
    seg = np.arange(min(n, len(t) - s0)) / SR
    if len(seg) == 0:
        continue
    freq = 90 * np.exp(-seg * 18) + 45
    kick = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-seg * 9) * 0.16
    mix[s0:s0 + len(seg)] += kick[:, None]
    # Arpegio en corcheas
    chord = chords[int(start / chord_len) % len(chords)]
    for k in range(2):
        st = start + k * BEAT / 2
        a0 = int(st * SR)
        an = int(0.4 * SR)
        aseg = np.arange(min(an, len(t) - a0)) / SR
        if len(aseg) == 0:
            continue
        m = chord[(b * 2 + k) % 4] + 12
        f = note(m)
        pluck = (np.sin(2 * np.pi * f * aseg) + 0.3 * np.sin(4 * np.pi * f * aseg)) * np.exp(-aseg * 7) * 0.03
        side = 0.35 if (b * 2 + k) % 2 else 0.65
        mix[a0:a0 + len(aseg), 0] += pluck * (1 - side)
        mix[a0:a0 + len(aseg), 1] += pluck * side

# Eco simple
d = int(BEAT * 0.75 * SR)
echo = np.zeros_like(mix)
echo[d:] = mix[:-d] * 0.25
mix += echo[:, ::-1]

# Fundido de entrada y salida
fade_in = np.clip(t / 2.0, 0, 1)
fade_out = np.clip((DURATION - t) / 4.0, 0, 1)
mix *= (fade_in * fade_out)[:, None]
mix /= max(1e-9, np.abs(mix).max()) / 0.8

with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("ok", OUT, DURATION)
