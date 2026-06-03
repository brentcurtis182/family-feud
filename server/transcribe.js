const config = require('./config');

// Provider-agnostic speech-to-text using the OpenAI-compatible
// /audio/transcriptions endpoint (works for both OpenAI and Groq Whisper).
const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    key: () => config.groqApiKey,
  },
  openai: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    key: () => config.openaiApiKey,
  },
};

function provider() {
  return PROVIDERS[config.sttProvider] || PROVIDERS.groq;
}

function isAvailable() {
  const p = provider();
  return !!(p && p.key());
}

function extFor(mime = '') {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'mp4';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

// Transcribe an audio buffer. Returns the recognized text (may be empty).
async function transcribeAudio(buffer, mimeType = 'audio/webm') {
  const p = provider();
  if (!p.key()) throw new Error('No STT API key configured');

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, `audio.${extFor(mimeType)}`);
  form.append('model', p.model);
  form.append('response_format', 'json');
  form.append('language', 'en');

  const resp = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key()}` },
    body: form,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`STT ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.text || '').trim();
}

module.exports = { isAvailable, transcribeAudio, provider: () => config.sttProvider };
