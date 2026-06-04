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
- Keep it broadly relatable and fun for a party.
- The exact question phrasing/style is specified per request.`;

// Varied topic pool so "random" doesn't keep landing on the same few questions.
const TOPIC_POOL = [
  'food', 'fast food', 'breakfast', 'desserts', 'drinks', 'animals', 'pets', 'the zoo',
  'around the house', 'the kitchen', 'the bathroom', 'chores', 'technology', 'phones',
  'travel', 'the beach', 'camping', 'vacations', 'school', 'the office', 'jobs', 'money',
  'sports', 'the gym', 'holidays', 'Christmas', 'weddings', 'dating', 'marriage', 'kids',
  'weather', 'music', 'movies', 'TV', 'cars', 'driving', 'clothing', 'bad habits',
  'superheroes', 'the grocery store', 'birthdays', 'mornings', 'sleep', 'the doctor',
];

function randomTopic() {
  return TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
}

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
// style: 'survey'  → "We asked 100 people / married women / men..." full sentence
//        'fastmoney' → short, punchy Fast Money prompt (no survey framing)
async function generateQuestion(topic, style, avoid = []) {
  const c = getClient();
  if (!c) return null;

  // For "random", pick a concrete topic from the pool so successive questions
  // are varied instead of converging on the same few.
  const effectiveTopic = topic && topic !== 'random' ? topic : randomTopic();

  // Fast Money prompts should keep mixing it up — sometimes a classic "name..."
  // prompt, sometimes a numeric/scale opener like the real show throws in.
  const FM_FRAMINGS = [
    'Phrase it as a SHORT, punchy Fast Money prompt (e.g. "Name a...", "Name something...", "A reason..."). Keep it brief.',
    'Phrase it as a SHORT Fast Money prompt that asks for a NUMBER as the answer (e.g. "How many...", "At what age...", "What time...") — the answers should be specific numbers/ranges with survey percentages.',
    'Phrase it as a Fast Money "on a scale of 1 to 10" style prompt (e.g. "On a scale of 1 to 10, how..."). The answers should be the numbers people picked most (each a number 1-10) with survey percentages.',
    'Phrase it as a SHORT "fill in the blank" Fast Money prompt (e.g. "Complete the phrase: ___", "Name the first word that comes to mind when you hear ___"). Keep it brief.',
    'Phrase it as a SHORT comparison Fast Money prompt (e.g. "Name something more likely to happen on a Monday than a Friday"). Keep it brief.',
  ];
  const styleLine = style === 'fastmoney'
    ? FM_FRAMINGS[Math.floor(Math.random() * FM_FRAMINGS.length)] + ' Do NOT use a "we asked 100" framing.'
    : 'Phrase it as a survey question using a "We asked 100 people / married women / married men..." framing — a full, natural sentence.';

  // Vary the answer count so it isn't always 7.
  const count = 4 + Math.floor(Math.random() * 5); // 4..8

  // Steer the model away from anything already asked this game.
  const avoidLine = avoid && avoid.length
    ? ` Do NOT repeat or paraphrase any of these already-asked questions — pick a clearly different subject:\n${avoid.map((q) => `- ${q}`).join('\n')}\n`
    : '';

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 1,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: `Topic: ${effectiveTopic}. ${styleLine} Provide EXACTLY ${count} answers.${avoidLine} Generate one fresh, creative question now as JSON.` },
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
