import sys
import re
from gtts import gTTS

text = sys.argv[1]
output_path = sys.argv[2]
tld = sys.argv[3] if len(sys.argv) > 3 else 'com'

# Clean escape characters
text = text.replace('\\n', ' ').replace('\\t', ' ').replace('\n', ' ').replace('\t', ' ')
text = re.sub(r'\\+', ' ', text)
text = re.sub(r'\s+', ' ', text).strip()

tts = gTTS(text=text, lang='en', tld=tld)
tts.save(output_path)
print("done")
