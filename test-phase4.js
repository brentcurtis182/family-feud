// End-to-end test for Phase 4 face-off + buzzers.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

(async () => {
  const host = io(URL);
  const p1 = io(URL); // team1 contestant
  const p2 = io(URL); // team2 contestant
  await Promise.all([once(host, 'connect'), once(p1, 'connect'), once(p2, 'connect')]);

  host.emit('create-game', {
    hostMode: 'host-judge', team1Name: 'Reds', team2Name: 'Blues', passcode: 'pw',
  });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });

  // Players join
  p1.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team1', playerName: 'Alice' });
  p2.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Bob' });
  await Promise.all([once(p1, 'game-joined'), once(p2, 'game-joined')]);

  host.emit('start-game');
  await once(host, 'phase-changed');

  // Load question, then select contestants
  host.emit('set-question', { source: 'bank' });
  await once(host, 'game-state-sync');

  host.emit('select-faceoff-players', { team1Player: 'Alice' });
  host.emit('select-faceoff-players', { team2Player: 'Bob' });

  // Track latest host state to observe FACE_OFF_READY
  let hostState = null;
  host.on('game-state-sync', (s) => { hostState = s; });
  await wait(150);
  check('both contestants selected',
    hostState && hostState.faceOff.team1Player.playerName === 'Alice' &&
    hostState.faceOff.team2Player.playerName === 'Bob');
  check('phase FACE_OFF_READY after question + players',
    hostState && hostState.phase === 'FACE_OFF_READY');

  // Players should learn they are contestants via their own state sync
  let p1State = null, p2State = null;
  p1.on('game-state-sync', (s) => { p1State = s; });
  p2.on('game-state-sync', (s) => { p2State = s; });

  // Open buzzers
  const p1BuzzOpen = once(p1, 'buzzers-open');
  host.emit('open-buzzers');
  await p1BuzzOpen;
  await wait(50);
  check('buzzers open in state', p1State && p1State.faceOff.buzzersOpen === true);

  // p1 (Alice) buzzes first, then p2 a bit later
  const buzzResultHost = once(host, 'buzz-result');
  p1.emit('buzz');
  await wait(60);
  p2.emit('buzz'); // should be ignored (face-off already won)
  const result = await buzzResultHost;

  check('winner is team1 (Alice buzzed first)', result.winner === 'team1');
  check('winner name correct', result.playerName === 'Alice');
  check('reaction time recorded (>0)', result.reactionMs >= 0);

  await wait(100);
  check('phase FACE_OFF_ANSWER after buzz', hostState && hostState.phase === 'FACE_OFF_ANSWER');
  check('playingTeam set to winner', hostState && hostState.activePlay.playingTeam === 'team1');
  check('only one buzz recorded (late buzz ignored)',
    hostState && hostState.faceOff.buzzes.length === 1);

  // Team-based buzzing: ANY teammate's buzzer wins for the team (new model).
  const p3 = io(URL);
  await once(p3, 'connect');
  p3.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'dev-carol' });
  await once(p3, 'game-joined');
  host.emit('reset-faceoff');
  await wait(80);
  host.emit('select-faceoff-players', { team1Player: 'Alice' });
  host.emit('select-faceoff-players', { team2Player: 'Bob' });
  await wait(80);
  host.emit('open-buzzers');
  await once(p3, 'buzzers-open');
  p3.emit('buzz'); // a team2 buzzer (not the named contestant) — counts for team2
  await wait(120);
  check('teammate buzz counts for the team (team-based)',
    hostState && hostState.phase === 'FACE_OFF_ANSWER' && hostState.faceOff.winner === 'team2');

  host.close(); p1.close(); p2.close(); p3.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
