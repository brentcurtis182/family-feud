const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

// Static instructions — cached across calls via prompt caching (5-min TTL).
const SYSTEM_PROMPT = `You write survey questions for a Family Feud-style party game.

Respond with ONLY valid JSON (no markdown, no commentary), in exactly this shape:
{"text": "<the survey question>", "answers": [{"text": "<short answer>", "points": <integer>}]}

Rules:
- Provide 5 to 8 answers.
- Order answers from most to least popular (descending points).
- points are positive integers that sum to exactly 100 (they represent survey percentages).
- Each answer is short: 1-3 words, distinct, and family-friendly.
- Phrase the question like a survey prompt, e.g. "Name something...", "Name a...", "We asked 100 people...".
- Keep it broadly relatable and fun for a party.`;

let client = null;

function isAvailable() {
  return !!(config.anthropicApiKey && config.anthropicApiKey !== 'your-key-here');
}

function getClient() {
  if (!isAvailable()) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

// Pull the first JSON object out of a model response (tolerates stray text/fences).
function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Validate + clean the model output into our raw question shape, or null if unusable.
function normalize(parsed, topic) {
  if (!parsed || typeof parsed.text !== 'string' || !Array.isArray(parsed.answers)) {
    return null;
  }

  const seen = new Set();
  let answers = parsed.answers
    .filter((a) => a && typeof a.text === 'string')
    .map((a) => ({
      text: a.text.trim(),
      points: Math.max(1, Math.round(Number(a.points) || 0)),
    }))
    .filter((a) => {
      const key = a.text.toLowerCase();
      if (!a.text || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.points - a.points);

  if (answers.length < 4) return null; // too thin to play
  if (answers.length > 8) answers = answers.slice(0, 8);

  return { text: parsed.text.trim(), topic: topic || 'general', answers };
}

// Generate one question via the API. Returns raw {text, topic, answers} or null
// (null signals the caller to fall back to the offline bank).
async function generateQuestion(topic) {
  const c = getClient();
  if (!c) return null;

  const topicLine =
    topic && topic !== 'random'
      ? `Topic: ${topic}.`
      : 'Pick any fun, broad, everyday topic.';

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: `${topicLine} Generate one question now as JSON.` },
    ],
  });

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return normalize(extractJson(text), topic);
}

module.exports = {
  isAvailable,
  generateQuestion,
  MODEL,
  SYSTEM_PROMPT,
  getClient,
  _test: { extractJson, normalize },
};
