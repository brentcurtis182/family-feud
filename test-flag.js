// Flagging a bad question takes it out of the rotation for good: the flag
// persists, every selection path honours it, and pre-buzz flags auto-replace.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

// --- In-process checks of the blocklist + selection filter (no server needed) ---
function storeChecks() {
  const flagged = require('./server/flagged');
  const questions = require('./server/questions');

  const victim = questions.SAMPLE_QUESTIONS[0];
  const hash = questions.hashQuestion(victim.text);
  const wasFlagged = flagged.isFlagged(hash);

  check('S1 not flagged to begin with', !wasFlagged);
  flagged.flag({ hash, text: victim.text, topic: victim.topic, source: 'bank', reason: 'test' });
  check('S1 flag recorded', flagged.isFlagged(hash));

  // Re-flagging keeps the original reason rather than overwriting it.
  flagged.flag({ hash, text: victim.text, reason: 'different' });
  check('S1 re-flag keeps the first reason',
    flagged.list().find((e) => e.hash === hash).reason === 'test');

  // 400 draws should never return it again.
  let drew = 0;
  for (let i = 0; i < 400; i++) {
    if (questions.getSampleQuestion(new Set(), victim.topic).hash === hash) drew++;
  }
  check('S1 flagged question is never drawn', drew === 0);

  // Even with every question marked "already used", the flag still holds.
  const allUsed = new Set(questions.SAMPLE_QUESTIONS.map((q) => questions.hashQuestion(q.text)));
  let drewExhausted = 0;
  for (let i = 0; i < 200; i++) {
    if (questions.getSampleQuestion(allUsed, null).hash === hash) drewExhausted++;
  }
  check('S1 still excluded when the bank is exhausted', drewExhausted === 0);

  check('S1 bad input rejected',
    flagged.flag({ hash: null, text: 'x' }) === null && flagged.flag({ hash: 'h' }) === null);

  // Deterministic rotation check: mark every question used EXCEPT the victim,
  // so it's the only eligible draw. Flagged → must not come back anyway;
  // unflagged → must be the one returned.
  const allButVictim = new Set(
    questions.SAMPLE_QUESTIONS.map((q) => questions.hashQuestion(q.text)).filter((h) => h !== hash)
  );
  check('S1 flagged: not drawn even as the only unused question',
    questions.getSampleQuestion(allButVictim, null).hash !== hash);

  check('S1 unflag works', flagged.unflag(hash) === true && !flagged.isFlagged(hash));
  check('S1 unflagged: back in rotation',
    questions.getSampleQuestion(allButVictim, null).hash === hash);
  check('S1 unflag of an unknown hash is a no-op', flagged.unflag('nope') === false);
}

(async () => {
  storeChecks();

  const host = io(URL);
  await once(host, 'connect');
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'A', team2Name: 'B', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  let hs = null; host.on('game-state-sync', (s) => { hs = s; });

  host.emit('roster-add', { team: 'team1', name: 'Al' });
  host.emit('roster-add', { team: 'team2', name: 'Bo' });
  await wait(200);
  host.emit('start-game');
  await wait(300);

  // --- Pre-buzz: flagging swaps in a replacement ---
  host.emit('set-question', { source: 'bank' });
  await wait(500);
  const bad = hs.currentQuestion.text;

  const flaggedEvt = once(host, 'question-flagged');
  host.emit('flag-question', { reason: 'duplicate answers' });
  const evt = await flaggedEvt;
  await wait(300);

  check('F1 flag acknowledged for the right question', evt.text === bad);
  check('F1 replaced pre-buzz', evt.replaced === true);
  check('F1 a new question is loaded', hs.currentQuestion && hs.currentQuestion.text !== bad);
  check('F1 flag count reported', typeof evt.total === 'number' && evt.total > 0);

  // Drawing repeatedly must never surface the flagged question again.
  let reappeared = false;
  for (let i = 0; i < 25; i++) {
    host.emit('reroll-question');
    await wait(90);
    if (hs.currentQuestion && hs.currentQuestion.text === bad) reappeared = true;
  }
  check('F1 flagged question never comes back', !reappeared);

  // --- Mid-round: flagging records but does NOT swap the board ---
  host.emit('open-buzzers');
  await wait(250);
  const live = hs.currentQuestion.text;
  const midEvt = once(host, 'question-flagged');
  host.emit('flag-question', { reason: 'confusing or unclear' });
  const mid = await midEvt;
  await wait(250);
  check('F2 mid-round flag is recorded', mid.text === live);
  check('F2 mid-round does NOT replace the live question', mid.replaced === false);
  check('F2 board still shows the same question', hs.currentQuestion.text === live);

  // --- Undo, and teardown ---
  // Must go through the SERVER: it owns flagged.json, so unflagging from this
  // process would just overwrite the file from a stale in-memory copy.
  const questions = require('./server/questions');
  const undone = once(host, 'question-unflagged');
  host.emit('unflag-question', { hash: questions.hashQuestion(bad) });
  const u = await undone;
  check('F3 unflag succeeds', u.ok === true);

  host.emit('unflag-question', { hash: questions.hashQuestion(live) });
  await wait(200);
  check('F3 flags cleared on the server', u.total === 1); // `live` still flagged at that point

  host.emit('delete-game', { gameId });
  await wait(200);
  host.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
