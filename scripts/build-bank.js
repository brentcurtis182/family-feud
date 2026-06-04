// One-off: convert the ProtoQA dataset (real Family Feud questions scraped from
// fan sites, with crowd-survey counts) into our offline bank shape.
//   input:  protoqa_train.jsonl  (downloaded from iesl/protoqa-data)
//   output: server/questionBank.json  ->  [{ text, topic, answers:[{text,points}] }]
//
// ProtoQA line shape:
//   { question:{original, normalized}, answers:{ raw:{ "<ans>": <count>, ... } }, ... }
// The raw counts are out of ~100 respondents, so they map straight to points.
//
// We build from `normalized` (consistently lowercased) and re-apply sentence
// casing so the whole bank reads uniformly, then drop the handful of clearly
// mangled scrape artifacts.
const fs = require('fs');
const path = require('path');

const IN = path.join(__dirname, '..', 'protoqa_train.jsonl');
const OUT = path.join(__dirname, '..', 'server', 'questionBank.json');

const MAX_ANSWERS = 8;   // FF boards top out around 8
const MIN_ANSWERS = 4;   // thinner than this isn't fun to play
const MIN_WORDS = 4;     // shorter than this is usually a fragment

// Words to re-capitalize after lowercasing (proper nouns the host reads aloud).
const PROPER = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'christmas', 'thanksgiving', 'halloween', 'easter', 'hanukkah', 'valentine',
  'santa', 'america', 'american', 'americans', 'god', 'jesus', 'english',
  'french', 'spanish', 'italian', 'chinese', 'japanese', 'mexican', 'canadian',
  'europe', 'european', 'canada', 'mexico', 'disney', 'walmart', 'hollywood',
  'vegas', 'hawaii', 'california', 'florida', 'texas', 'olympics', 'olympic',
]);
const UPPER = new Set(['tv', 'us', 'usa', 'dvd', 'cd', 'suv', 'atm', 'id', 'diy', 'bbq', 'ufo', 'fbi', 'nfl', 'nba']);

// Clearly-mangled leading words seen in the source (dropped letters / mashes).
const BAD_FIRST = new Set(['ame', 'namy', 'whatspecifically', 'theyve']);

function sentenceCase(s) {
  let t = (s || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  // Re-capitalize proper nouns / acronyms.
  t = t.replace(/[a-z][a-z'-]*/g, (w) => {
    if (UPPER.has(w)) return w.toUpperCase();
    if (PROPER.has(w)) return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  });
  // Standalone "i" -> "I".
  t = t.replace(/\bi\b/g, 'I');
  // Capitalize the first alphabetic character.
  t = t.replace(/^([^a-zA-Z]*)([a-z])/, (_, pre, c) => pre + c.toUpperCase());
  // Ensure sentence-ending punctuation.
  if (!/[.?!]$/.test(t)) t += '.';
  return t;
}

function cap(s) {
  s = (s || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Light keyword -> existing-topic tagging so the host's topic chips keep working.
const TOPIC_RULES = [
  ['food', /\b(food|eat|eating|dinner|lunch|breakfast|pizza|fruit|vegetable|snack|drink|candy|dessert|cake|restaurant|cook|kitchen|meal|sandwich|coffee|cereal|bbq|barbecue|ice cream)\b/],
  ['animals', /\b(animal|dog|cat|pet|zoo|bird|fish|horse|cow|pig|farm|wild|insect|bug|snake|bear|lion|shark)\b/],
  ['travel', /\b(beach|vacation|travel|trip|hotel|flight|airplane|airport|camping|camp|road trip|cruise|tourist|suitcase|pack)\b/],
  ['home', /\b(house|home|kitchen|bathroom|bedroom|garage|chore|clean|drawer|closet|furniture|garden|yard|lawn|laundry)\b/],
  ['entertainment', /\b(movie|tv|television|game|music|song|concert|book|read|party|board game|video game|celebrity|show|dance|hobby)\b/],
  ['everyday', /\b(morning|work|job|office|school|sleep|phone|car|drive|driving|money|store|shopping|wake|commute|gym|exercise)\b/],
];

function pickTopic(text) {
  const t = text.toLowerCase();
  for (const [topic, re] of TOPIC_RULES) if (re.test(t)) return topic;
  return 'general';
}

const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
const seen = new Set();
const out = [];
const stats = { total: lines.length, kept: 0, skipThin: 0, skipDup: 0, skipBad: 0, skipMangled: 0, byTopic: {}, byCount: {} };

for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch { stats.skipBad++; continue; }
  const qsrc = obj && obj.question;
  const raw = obj && obj.answers && obj.answers.raw;
  if (!qsrc || !raw || typeof raw !== 'object') { stats.skipBad++; continue; }

  // Prefer `original` (keeps apostrophes/punctuation); sentenceCase re-derives
  // casing from scratch so its mixed Title Case doesn't matter.
  const base = (qsrc.original || qsrc.normalized || '').toLowerCase().trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) { stats.skipThin++; continue; }
  // Drop obvious scrape artifacts: mangled leading word, or stray junk start.
  if (BAD_FIRST.has(words[0]) || /^[^a-z]/.test(base)) { stats.skipMangled++; continue; }

  const text = sentenceCase(base);
  if (text.length < 12 || text.length > 200) { stats.skipBad++; continue; }
  const key = text.toLowerCase();
  if (seen.has(key)) { stats.skipDup++; continue; }

  let answers = Object.entries(raw)
    .map(([t, c]) => ({ text: cap(t), points: Math.round(Number(c) || 0) }))
    .filter((a) => a.text && a.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, MAX_ANSWERS);

  if (answers.length < MIN_ANSWERS) { stats.skipThin++; continue; }

  seen.add(key);
  const topic = pickTopic(text + ' ' + answers.map((a) => a.text).join(' '));
  out.push({ text, topic, answers });
  stats.kept++;
  stats.byTopic[topic] = (stats.byTopic[topic] || 0) + 1;
  stats.byCount[answers.length] = (stats.byCount[answers.length] || 0) + 1;
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log('Wrote', OUT, `(${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(JSON.stringify(stats, null, 2));
console.log('\nSamples:');
for (const i of [0, 1500, 4000, 6500]) if (out[i]) console.log('-', out[i].text);
