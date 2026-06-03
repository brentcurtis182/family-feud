// Phase 7: judge mode (host-only). Judge adjudicates reveals/strikes.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));
let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

(async () => {
  const host = io(URL), judge = io(URL), p1 = io(URL), p2 = io(URL);
  await Promise.all([host, judge, p1, p2].map((s) => once(s, 'connect')));

  // host-only mode so a separate judge is allowed
  host.emit('create-game', { hostMode: 'host-only', team1Name: 'Reds', team2Name: 'Blues', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });

  // Judge joins (allowed only in host-only mode)
  judge.emit('join-game', { gameId, passcode: 'pw', role: 'judge' });
  const judgeJoined = await once(judge, 'game-joined');
  check('judge allowed to join host-only game', judgeJoined.role === 'judge');
  judge.emit('rejoin', { gameId, role: 'judge' });
  let js = null; judge.on('game-state-sync', (s) => { js = s; });

  // Players
  p1.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team1', playerName: 'Al' });
  p2.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Bo' });
  await Promise.all([once(p1, 'game-joined'), once(p2, 'game-joined')]);

  let hs = null; host.on('game-state-sync', (s) => { hs = s; });
  host.emit('start-game'); await once(host, 'phase-changed');

  // Host runs flow up to team play
  host.emit('set-question', { source: 'bank' }); await once(host, 'question-ready'); await wait(40);
  check('judge sees FULL answers (text visible)',
    js && js.currentQuestion && typeof js.currentQuestion.answers[0].text === 'string');

  host.emit('select-faceoff-players', { team1Player: 'Al' });
  host.emit('select-faceoff-players', { team2Player: 'Bo' });
  await wait(60);
  host.emit('open-buzzers'); await once(p1, 'buzzers-open');
  p1.emit('buzz'); await wait(60);
  host.emit('choose-play', { team: 'team1' }); await wait(50);

  const q = hs.currentQuestion;
  const mult = hs.roundMultiplier;

  // JUDGE reveals answer 0
  judge.emit('reveal-answer', { position: 0 });
  await wait(60);
  check('judge reveal updated the board', hs.currentQuestion.answers[0].revealed === true);
  check('judge reveal updated the bank', hs.roundBank === q.answers[0].points * mult);

  // JUDGE adds a strike
  judge.emit('add-strike'); await wait(50);
  check('judge strike registered', hs.activePlay.strikes === 1);

  // A player must NOT be able to reveal/strike
  p2.emit('add-strike'); await wait(50);
  check('player cannot add strike', hs.activePlay.strikes === 1);

  // In host-JUDGE mode, a separate judge is rejected
  const host2 = io(URL); const judge2 = io(URL);
  await Promise.all([once(host2, 'connect'), once(judge2, 'connect')]);
  host2.emit('create-game', { hostMode: 'host-judge', team1Name: 'X', team2Name: 'Y', passcode: 'pw' });
  const g2 = await once(host2, 'game-created');
  judge2.emit('join-game', { gameId: g2.gameId, passcode: 'pw', role: 'judge' });
  const err = await Promise.race([
    once(judge2, 'error').then((e) => ({ err: e })),
    once(judge2, 'game-joined').then((j) => ({ joined: j })),
  ]);
  check('judge rejected in host-judge mode', !!err.err);

  [host, judge, p1, p2, host2, judge2].forEach((s) => s.close());
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
