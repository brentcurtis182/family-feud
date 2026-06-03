const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: process.env.PORT || 3000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Speech-to-text for Fast Money transcription (provider-agnostic).
  // STT_PROVIDER = 'groq' (free tier) | 'openai'. Set the matching key.
  sttProvider: (process.env.STT_PROVIDER || 'groq').toLowerCase(),
  groqApiKey: process.env.GROQ_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
};
