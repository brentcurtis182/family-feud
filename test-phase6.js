// Phase 6 tests: AI parsing (unit) + bank/topic/fallback (end-to-end).
const { io } = require('socket.io-client');
const ai = require('./server/aiQuestions');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

// ---- Unit: AI response parsing/normalization (no API needed) ----
function unitTests() {
  const { extractJson, normalize } = ai._test;

  const fenced = '```json\n{"text":"Name a fruit","answers":[' +
    '{"text":"Apple","points":40},{"text":"Banana","points":25},' +
    '{"text":"Orange","points":20},{"text":"Grape","points":10},{"text":"Mango","points":5}]}\n```';
  const parsed = extractJson(fenced);
  check('extractJson handles markdown fences', parsed && parsed.text === 'Name a fruit');

  const norm = normalize(parsed, 'food');
  check('normalize sorts descending', norm && norm.answers[0].points >= norm.answers[1].points);
  check('normalize keeps topic', norm && norm.topic === 'food');

  // too few answers -> rejected
  check('normalize rejects thin answer sets',
    normalize({ text: 'q', answers: [{ text: 'a', points: 100 }] }, 'x') === null);

  // de-dupes answers and coerces points
  const dup = normalize({ text: 'q', answers: [
    { text: 'Dog', points: '30' }, { text: 'dog', points: 10 },
    { text: 'Cat', points: 25 }, { text: 'Fish', points: 20 }, { text: 'Bird', points: 15 },
  ] }, 'animals');
  check('normalize de-dupes (case-insensitive) + coerces points',
    dup && dup.answers.length === 4 && Number.isInteger(dup.answers[0].points));

  check('garbage returns null', extractJson('no json here') === null);
}

(async () => {
  unitTests();

  const host = io(URL);
  await once(host, 'connect');
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'A', team2Name: 'B', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  let hs = null;
  host.on('game-state-sync', (s) => { hs = s; });
  host.emit('start-game');
  await once(host, 'phase-changed');
  await wait(50);

  check('state exposes topics list', Array.isArray(hs.topics) && hs.topics.length > 0);
  check('aiAvailable is boolean', typeof hs.aiAvailable === 'boolean');

  // Bank source with a specific topic
  host.emit('set-question', { topic: 'food', source: 'bank' });
  await once(host, 'question-ready');
  await wait(40);
  check('bank question respects topic (food)', hs.currentQuestion && hs.currentQuestion.topic === 'food');
  check('question has 4-8 answers', hs.currentQuestion.answers.length >= 4 && hs.currentQuestion.answers.length <= 8);

  // Default source with no API key -> falls back to bank, still produces a question
  host.emit('reroll-question');
  await once(host, 'question-ready');
  await wait(40);
  check('reroll fallback yields a question', !!hs.currentQuestion && typeof hs.currentQuestion.text === 'string');

  // Dedupe: pull several food questions; should not repeat while bank has unused ones
  const seen = new Set([hs.currentQuestion.text]);
  let repeats = 0;
  for (let i = 0; i < 2; i++) {
    host.emit('set-question', { topic: 'food', source: 'bank' });
    await once(host, 'question-ready');
    await wait(30);
    if (seen.has(hs.currentQuestion.text)) repeats++;
    seen.add(hs.currentQuestion.text);
  }
  check('no immediate repeats while bank has unused questions', repeats === 0);

  host.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
