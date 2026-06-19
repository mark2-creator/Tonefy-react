import sys
import asyncio
import re
import edge_tts

text = sys.argv[1]
output_path = sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else 'en-US-GuyNeural'

# Clean escape characters
text = text.replace('\\n', ' ').replace('\\t', ' ').replace('\n', ' ').replace('\t', ' ')
text = re.sub(r'\\+', ' ', text)
text = re.sub(r'\s+', ' ', text).strip()

async def main():
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)
    print("done")

asyncio.run(main())
