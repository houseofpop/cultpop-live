#!/usr/bin/env python3
"""Genera gli effetti sonori del LED (sintetizzati da zero: nessun diritto d'autore).
ATTENZIONE: i suoni in uso ora sono quelli scelti da Magnific (originali in assets/originali/suoni-magnific).
Questo script li sovrascriverebbe con quelli sintetizzati: parte solo con --sovrascrivi.
Uso: python3 scripts/suoni.py --sovrascrivi  → public/audio/*.mp3
Per usare suoni vostri basta sostituire i file (stessi nomi) o cambiare i percorsi in config/show.json → show.suoni."""
import numpy as np, subprocess, pathlib, wave, tempfile, json

SR = 44100
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'audio'
rng = np.random.default_rng(7)

def t_(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.005, r=0.2, sustain=1.0):
    e = np.ones(n) * sustain
    na, nr = int(SR * a), min(n, int(SR * r))
    e[:na] = np.linspace(0, sustain, na)
    e[n - nr:] *= np.linspace(1, 0, nr) ** 2
    return e
def lp(x, fc):  # filtro passa-basso a un polo
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    for i, v in enumerate(x): s = (1 - a) * v + a * s; y[i] = s
    return y
def hp(x, fc): return x - lp(x, fc)
def mix(total, *parts):
    out = np.zeros(int(SR * total))
    for start, sig in parts:
        i = int(SR * start); j = min(len(out), i + len(sig)); out[i:j] += sig[:j - i]
    return out
def saw(f, d, bright=12):
    t = t_(d); return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, bright + 1))
def brass(f, d, vel=1.0):
    t = t_(d); n = len(t)
    sig = sum((np.sin(2 * np.pi * f * k * t + 0.3 * k) / k ** 1.15) * np.clip(1.4 - k / (4 + 10 * np.minimum(1, t / 0.06)), 0, 1) for k in range(1, 14))
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.3)
    return sig * vib * env(n, 0.02, min(0.25, d * 0.5)) * vel
def bell(f, d):
    t = t_(d); parts = [(1, 1, 1.6), (2.0, .55, 2.6), (3.01, .3, 4), (4.2, .2, 6), (5.4, .12, 8)]
    return sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * k) for r, a, k in parts) * env(len(t), 0.002, 0.05)
def snare(vel=1.0, d=0.12):
    t = t_(d); n = len(t)
    noise = hp(rng.standard_normal(n), 1800) * np.exp(-t * 32)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 45) * 0.6
    return (noise + body) * vel
def kick(d=0.5):
    t = t_(d); f = 48 + 90 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
def crash(d=2.6, vel=1.0):
    t = t_(d); n = len(t)
    noise = hp(rng.standard_normal(n), 5000) * np.exp(-t * 1.6)
    metal = sum(np.sin(2 * np.pi * f * t + rng.random() * 6) for f in (3170, 4410, 5530, 6870, 8210)) * 0.05 * np.exp(-t * 2.2)
    return (noise * 0.55 + metal) * env(n, 0.001, 0.4) * vel
def roll(d, v0=0.25, v1=1.0, rate=(18, 30)):
    out = np.zeros(int(SR * (d + 0.2))); t = 0.0
    while t < d:
        p = t / d; vel = (v0 + (v1 - v0) * p ** 1.6) * (0.8 + 0.4 * rng.random())
        s = snare(vel); i = int(t * SR); out[i:i + len(s)] += s[:len(out) - i]
        t += 1 / (rate[0] + (rate[1] - rate[0]) * p)
    return out
def whoosh(d=0.8):
    n = int(SR * d); t = t_(d); x = rng.standard_normal(n)
    # passa-banda che sale e scende
    y = np.empty(n); s1 = s2 = 0.0
    for i in range(n):
        fc = 300 + 5200 * np.sin(np.pi * t[i] / d) ** 2; a = np.exp(-2 * np.pi * fc / SR)
        s1 = (1 - a) * x[i] + a * s1; s2 = (1 - a) * s1 + a * s2; y[i] = s1 - s2
    return y * np.sin(np.pi * t / d) ** 1.5
def chord(notes, d, fn=brass, vel=1.0): return sum(fn(f, d, vel) if fn is brass else fn(f, d) for f in notes)
N = {'C4': 261.63, 'E4': 329.63, 'G4': 392.0, 'A4': 440.0, 'Bb4': 466.16, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'G5': 783.99, 'A5': 880.0, 'C6': 1046.5, 'G3': 196.0, 'C3': 130.81, 'F4': 349.23}

def save(name, x, peak_db=-1.0, extra_db=0):
    x = x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: tmp = f.name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes())
    # stesso volume percepito per tutti i suoni (loudnorm in due passaggi, lineare: il crescendo del rullo resta)
    fx = 'aecho=0.8:0.9:40|70:0.18|0.1'
    m = subprocess.run(['ffmpeg', '-hide_banner', '-i', tmp, '-af', f'{fx},loudnorm=I=-16:TP=-1.5:LRA=20:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    ln = f"loudnorm=I=-16:TP=-1.5:LRA=20:linear=true:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-af', f'{fx},{ln},volume={extra_db}dB', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', str(OUT / f'{name}.mp3')], check=True)
    pathlib.Path(tmp).unlink()
    print('ok', name, f'{len(x) / SR:.1f}s')

import sys
if '--sovrascrivi' not in sys.argv:
    sys.exit('Non sovrascrivo i suoni Magnific in public/audio: aggiungi --sovrascrivi se vuoi davvero quelli sintetizzati.')
OUT.mkdir(parents=True, exist_ok=True)
# 1. SOS: allarme da quiz, tre colpi che salgono + accordo
save('sos', mix(1.6, (0, chord([N['C5'], N['E5']], .14, saw)), (.16, chord([N['D5'], N['F5']], .14, saw)), (.32, chord([N['E5'], N['G5']], .14, saw)),
               (.5, chord([N['C4'], N['E4'], N['G4'], N['C5']], 1.0, brass)), (.5, kick()), (.5, crash(1.1, .5))) * 0.9)
# 2. Tempo scaduto: buzzer da game show
bz = (saw(110, .75, 20) + saw(116, .75, 20)) * env(int(SR * .75), .01, .08)
save('fine-sos', mix(0.9, (0, lp(bz, 2500))))
# 3. Risposta corretta: campanelli che salgono
save('risposta', mix(2.2, *[(i * .09, bell(f, 1.8) * (0.8 + i * .1)) for i, f in enumerate([N['C5'], N['E5'], N['G5'], N['C6']])], (.36, crash(1.6, .35))))
# 4. Classifica / generazioni: whoosh
save('whoosh', whoosh(0.85), -3)
# 5. Votazioni chiuse: rullo breve + piatto
save('chiuse', mix(3.8, (0, roll(2.2, .2, 1.0)), (2.2, kick(.8)), (2.2, crash(1.6))))
# 6. Verdetto: rullo lungo (si ferma da solo al 1°), colpo per 3° e 2°, fanfara per il vincitore
save('rullo', roll(7.0, .15, .9, (16, 26)))
save('colpo', mix(1.5, (0, kick(.7)), (0, crash(1.4, .55)), (0, snare(1.2, .2))), extra_db=6)  # breve: il misuratore lo sottostima
fan = mix(3.6,
          (0.00, chord([N['G4'], N['C5'], N['E5']], .16)), (0.18, chord([N['G4'], N['C5'], N['E5']], .16)), (0.36, chord([N['G4'], N['C5'], N['E5']], .16)),
          (0.56, chord([N['C4'], N['G4'], N['C5'], N['E5'], N['G5']], 2.4)), (0.56, chord([N['C3']], 2.4)), (0.56, kick(.9)), (0.56, crash(2.8)))
save('fanfara', fan)
