// Live STT round-trip: build a short WAV tone and send it through transcribe.js
// to confirm the Groq key + request format + response parsing all work.
const transcribe = require('./server/transcribe');

function makeWav(seconds = 1, freq = 0, rate = 16000) {
  const n = seconds * rate;
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    const v = freq ? Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000) : 0;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

(async () => {
  console.log('available:', transcribe.isAvailable(), '| provider:', transcribe.provider());
  try {
    const wav = makeWav(1, 0); // 1s of silence is enough to validate the call
    const text = await transcribe.transcribeAudio(wav, 'audio/wav');
    console.log('PASS: Groq round-trip OK. Transcript:', JSON.stringify(text));
    process.exit(0);
  } catch (e) {
    console.log('FAIL:', e.message);
    process.exit(1);
  }
})();
