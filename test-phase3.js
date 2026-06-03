// End-to-end test for Phase 3 reveal/strike mechanics.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function once(sock, ev) {
  return new Promise((res) => sock.once(ev, res));
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

(async () => {
  const host = io(URL);
  const tv = io(URL);
  await Promise.all([once(host, 'connect'), once(tv, 'connect')]);

  // Host creates a game
  host.emit('create-game', {
    hostMode: 'host-judge',
    team1Name: 'Reds',
    team2Name: 'Blues',
    passcode: 'pw',
  });
  const created = await once(host, 'game-created');
  const gameId = created.gameId;
  check('game created', !!gameId);

  // Host rejoins (mirrors host.html), TV joins as gamescreen
  host.emit('rejoin', { gameId, role: 'host' });
  tv.emit('join-game', { gameId, passcode: 'pw', role: 'gamescreen' });
  await once(tv, 'game-joined');

  // Start game -> round 1
  host.emit('start-game');
  await once(host, 'phase-changed');

  // Load a question
  host.emit('set-question', { source: 'bank' });
  const hostState = await once(host, 'game-state-sync');
  check('host sees full answers', !!hostState.currentQuestion &&
    typeof hostState.currentQuestion.answers[0].text === 'string');
  // No face-off contestants picked in this isolated test, so we stay in setup;
  // reveal/strike mechanics still operate on the loaded question.
  check('phase is ROUND_SETUP', hostState.phase === 'ROUND_SETUP');

  // TV should get sanitized state (answers hidden until revealed)
  const tvState = await once(tv, 'game-state-sync');
  check('TV gets answerCount', tvState.currentQuestion.answerCount > 0);
  check('TV answer text hidden pre-reveal',
    tvState.currentQuestion.answers[0].text === null);

  const topPoints = hostState.currentQuestion.answers[0].points;
  const mult = hostState.roundMultiplier;

  // Reveal answer 0 — expect answer-revealed on TV + bank = points * multiplier
  const revealedP = once(tv, 'answer-revealed');
  host.emit('reveal-answer', { position: 0 });
  const revealed = await revealedP;
  check('TV got answer-revealed for pos 0', revealed.position === 0);
  check('reveal carries points', revealed.points === topPoints);
  check('round bank = points * multiplier', revealed.roundBank === topPoints * mult);

  // TV state now shows that answer's text
  const tvState2 = await once(tv, 'game-state-sync');
  check('TV now sees revealed answer text',
    typeof tvState2.currentQuestion.answers[0].text === 'string');
  check('TV bank updated', tvState2.roundBank === topPoints * mult);

  // Add two strikes
  let strikeEv = once(tv, 'strike-added');
  host.emit('add-strike');
  let s = await strikeEv;
  check('strike 1 registered', s.strikes === 1);

  strikeEv = once(tv, 'strike-added');
  host.emit('add-strike');
  s = await strikeEv;
  check('strike 2 registered', s.strikes === 2);

  // Hide answer 0 again (correction) — bank back to 0.
  // Track the latest sync continuously to avoid latching a stale queued one.
  let latestHostState = null;
  host.on('game-state-sync', (st) => { latestHostState = st; });
  host.emit('hide-answer', { position: 0 });
  await wait(200);
  check('hide-answer resets bank', latestHostState && latestHostState.roundBank === 0);
  check('answer hidden again',
    latestHostState && latestHostState.currentQuestion.answers[0].revealed === false);

  await wait(100);
  host.close();
  tv.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
