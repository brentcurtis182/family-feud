// Test: reset-round clears the round but keeps scores.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));
let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

(async () => {
  const host = io(URL); const p1 = io(URL); const p2 = io(URL);
  await Promise.all([once(host, 'connect'), once(p1, 'connect'), once(p2, 'connect')]);
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'A', team2Name: 'B', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  p1.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team1', playerName: 'Al' });
  p2.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Bo' });
  await Promise.all([once(p1, 'game-joined'), once(p2, 'game-joined')]);
  host.emit('start-game'); await once(host, 'phase-changed');
  let hs = null; host.on('game-state-sync', (s) => { hs = s; });

  // Drive into mid-round with a revealed answer + a strike, give team1 a fake lead first
  host.emit('set-question', { source: 'bank' }); await once(host, 'question-ready'); await wait(40);
  host.emit('select-faceoff-players', { team1Player: 'Al' });
  host.emit('select-faceoff-players', { team2Player: 'Bo' });
  await wait(60);
  host.emit('open-buzzers'); await once(p1, 'buzzers-open');
  p1.emit('buzz'); await wait(60);
  host.emit('choose-play', { team: 'team1' }); await wait(50);
  host.emit('reveal-answer', { position: 0 }); await wait(40);
  host.emit('add-strike'); await wait(40);

  check('pre-reset: question loaded', !!hs.currentQuestion);
  check('pre-reset: has a strike', hs.activePlay.strikes === 1);
  check('pre-reset: bank > 0', hs.roundBank > 0);
  const scoreBefore = hs.teams.team1.score;
  const roundBefore = hs.round;

  // Reset
  host.emit('reset-round'); await wait(80);
  check('post-reset: phase ROUND_SETUP', hs.phase === 'ROUND_SETUP');
  check('post-reset: question cleared', hs.currentQuestion == null);
  check('post-reset: strikes cleared', hs.activePlay.strikes === 0);
  check('post-reset: bank cleared', hs.roundBank === 0);
  check('post-reset: face-off cleared', !hs.faceOff.team1Player && !hs.faceOff.winner);
  check('post-reset: round number kept', hs.round === roundBefore);
  check('post-reset: scores kept', hs.teams.team1.score === scoreBefore);

  // Can immediately load a new question after reset
  host.emit('set-question', { source: 'bank' }); await once(host, 'question-ready'); await wait(40);
  check('post-reset: can load a new question', !!hs.currentQuestion);

  host.close(); p1.close(); p2.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
