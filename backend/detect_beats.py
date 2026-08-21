"""Beat times for a piece of audio, as JSON on stdout.

Tempo alone is not enough to mark beats. The autocorrelation in scripts/analyse-music.py
gives the beat PERIOD - how far apart beats are - and the library uses it for a tempo
band, which is all a band needs. A marker on a timeline needs the PHASE as well: where
the first beat actually falls. A period that is right and a phase that is wrong puts
every marker exactly between the beats, which is worse than no markers, because it is
confidently wrong rather than absent.

So this runs in two stages:

  period   spectral-flux onset envelope, autocorrelated, strongest lag in 60-180 BPM.
           Same method as the library measurement, which was already checked against
           68 real tracks.
  phase    a pulse train at that period is slid across the onset envelope and the
           offset with the most onset energy under its pulses wins. This is the part
           tempo detection alone does not give you.

Output beats are the grid, not the raw onsets. A grid is what a musician means by "the
beat" and what a cut wants to land on; raw onsets include every snare flam and vocal
consonant, so cutting to them looks nervous rather than rhythmic.

No librosa or aubio on this box, so this is numpy over ffmpeg's PCM.
"""
import sys, json, subprocess, numpy as np

SR, HOP, WIN = 22050, 512, 1024

def pcm(path):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le',
                        '-ac', '1', '-ar', str(SR), '-'],
                       capture_output=True)
    if p.returncode != 0:
        raise SystemExit(json.dumps({'error': 'could not decode audio'}))
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float64) / 32768.0

def onset_envelope(x):
    n = (x.size - WIN) // HOP
    if n < 8:
        return None
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, WIN), strides=(x.strides[0] * HOP, x.strides[0]))
    spec = np.abs(np.fft.rfft(frames * np.hanning(WIN), axis=1))
    # Half-wave rectified spectral flux: energy APPEARING, not energy leaving. A note
    # ending is not an onset, and without the rectification a decay reads as one.
    flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
    flux -= flux.mean()
    if flux.std() > 0:
        flux /= flux.std()
    return flux

def autocorr(v):
    n = 1 << int(np.ceil(np.log2(2 * len(v))))
    F = np.fft.rfft(v - v.mean(), n)
    ac = np.fft.irfft(F * np.conj(F))[:len(v)]
    return ac / (ac[0] or 1.0)

def detect(path, max_beats=2000):
    x = pcm(path)
    if x.size < SR * 3:
        return {'error': 'too short to find a beat'}
    flux = onset_envelope(x)
    if flux is None:
        return {'error': 'too short to find a beat'}

    fps = SR / HOP
    ac = autocorr(flux)
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 60)      # 60-180 BPM
    seg = ac[lo:hi]
    if seg.size == 0:
        return {'error': 'no steady beat found'}
    period = lo + int(np.argmax(seg))                      # in frames
    bpm = 60.0 * fps / period
    strength = float(seg.max())                            # how periodic it actually is

    # Phase: slide a pulse train and take the offset with the most onset energy under it.
    # Summed over the whole track rather than the first few bars, so an intro that starts
    # off-grid cannot set the phase for everything after it.
    idx = np.arange(0, len(flux), period)
    scores = [flux[(idx + off).astype(int)[(idx + off) < len(flux)]].sum()
              for off in range(period)]
    offset = int(np.argmax(scores))

    times = [(offset + k * period) / fps for k in range(int((len(flux) - offset) / period) + 1)]
    times = [round(t, 3) for t in times if t >= 0][:max_beats]
    return {
        'bpm': round(bpm, 1),
        # Reported so the caller can decide. A spoken-word track has no beat, and this
        # will still return a grid for it - a number near zero is how you tell.
        'strength': round(strength, 3),
        'beats': times,
    }

if __name__ == '__main__':
    print(json.dumps(detect(sys.argv[1])))
