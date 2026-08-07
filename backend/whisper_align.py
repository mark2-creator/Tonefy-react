import sys
import json
import time
from faster_whisper import WhisperModel

t0 = time.time()
audio_path = sys.argv[1]
model = WhisperModel("tiny", device="cpu", compute_type="int8")
t1 = time.time()
print(f"MODEL_LOAD_TIME: {t1-t0:.2f}s", file=sys.stderr)

segments, info = model.transcribe(
    audio_path,
    word_timestamps=True,
    beam_size=1,
    vad_filter=True,
)

words = []
for segment in segments:
    for word in segment.words:
        words.append({
            "word": word.word.strip(),
            "start": round(word.start, 3),
            "end": round(word.end, 3)
        })

t2 = time.time()
print(f"TRANSCRIBE_TIME: {t2-t1:.2f}s", file=sys.stderr)

print(json.dumps(words))
