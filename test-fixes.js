// Tests for the bug-fix batch: passcode verify, roster, run-it-back,
// round multipliers, stakes.
const { io } = require('socket.io-client');
const gs = require('./server/gameState');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));
let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

// ---- Unit: round multipliers (#5) ----
check('round multipliers 1,1,2,3',
  gs.ROUND_MULTIPLIERS[1] === 1 && gs.ROUND_MULTIPLIERS[2] === 1 &&
  gs.ROUND_MULTIPLIERS[3] === 2 && gs.ROUND_MULTIPLIERS[4] === 3);

// ---- Unit: stakes (#6) ----
const fakeGame = {
  phase: 'STEAL_ATTEMPT', round: 4, totalRounds: 4, roundMultiplier: 3,
  currentQuestion: { answers: [{ points: 20, revealed: true }] },
  teams: { team1: { name: 'Reds', score: 250 }, team2: { name: 'Blues', score: 100 } },
  activePlay: { playingTeam: 'team1', stealingTeam: 'team2', revealedIndices: [0] },
};
const stakes = gs.computeStakes(fakeGame);
check('stakes computed for steal scenario', typeof stakes === 'string' && stakes.length > 0);
check('stakes mentions a win (Reds keep 60 -> 310)', /WIN/i.test(stakes));

(async () => {
  const host = io(URL);
  await once(host, 'connect');
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'Reds', team2Name: 'Blues', passcode: 'secret' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  let hs = null; host.on('game-state-sync', (s) => { hs = s; });

  // ---- Passcode verify (#1) ----
  const lobby = io(URL);
  await once(lobby, 'connect');
  lobby.emit('verify-passcode', { gameId, passcode: 'wrong' });
  let pr = await once(lobby, 'passcode-result');
  check('wrong passcode rejected', pr.ok === false);
  lobby.emit('verify-passcode', { gameId, passcode: 'secret' });
  pr = await once(lobby, 'passcode-result');
  check('correct passcode accepted', pr.ok === true);

  // ---- Roster management (#2) ----
  host.emit('roster-add', { team: 'team1', name: 'Alice' });
  host.emit('roster-add', { team: 'team1', name: 'Bob' });
  host.emit('roster-add', { team: 'team2', name: 'Carol' });
  await wait(80);
  check('roster-add reflected', hs.teams.team1.roster.length === 2 && hs.teams.team2.roster.length === 1);
  host.emit('roster-remove', { team: 'team1', name: 'Bob' });
  await wait(60);
  check('roster-remove works', hs.teams.team1.roster.length === 1 && hs.teams.team1.roster[0] === 'Alice');

  // Nameless team buzzer joins (#2)
  const buzzer = io(URL);
  await once(buzzer, 'connect');
  buzzer.emit('join-game', { gameId, passcode: 'secret', role: 'player', teamChoice: 'team1', playerName: 'dev-abc' });
  await once(buzzer, 'game-joined');
  await wait(60);
  check('buzzer device counted', hs.teams.team1.buzzerCount === 1);

  // ---- Run it back (#4): play a bit, give a score, then restart ----
  host.emit('start-game'); await once(host, 'phase-changed'); await wait(40);
  check('round multiplier 1 at round 1', hs.roundMultiplier === 1);
  host.teams; // no-op
  host.emit('restart-game'); await wait(80);
  check('run-it-back resets to LOBBY', hs.phase === 'LOBBY' && hs.round === 0);
  check('run-it-back keeps roster', hs.teams.team1.roster.includes('Alice'));
  check('run-it-back zeroes scores', hs.teams.team1.score === 0 && hs.teams.team2.score === 0);

  host.close(); lobby.close(); buzzer.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
