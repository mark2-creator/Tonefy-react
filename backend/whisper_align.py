import sys
import json
import whisper

audio_path = sys.argv[1]
model = whisper.load_model("tiny")
result = model.transcribe(audio_path, word_timestamps=True)

words = []
for segment in result["segments"]:
    for word in segment.get("words", []):
        words.append({
            "word": word["word"].strip(),
            "start": round(word["start"], 3),
            "end": round(word["end"], 3)
        })

print(json.dumps(words))
