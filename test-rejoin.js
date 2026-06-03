// Regression test: player must stay on the roster across the lobby->player.html
// page redirect (which disconnects socket A and reconnects as socket B via rejoin).
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

(async () => {
  const host = io(URL);
  await once(host, 'connect');
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'Curtis', team2Name: 'Maynard', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });

  let hostState = null;
  host.on('game-state-sync', (s) => { hostState = s; });

  // --- Simulate the lobby page: socket A joins as a player ---
  const a = io(URL);
  await once(a, 'connect');
  a.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Roger' });
  await once(a, 'game-joined');
  await wait(80);
  check('player on roster after join-game', hostState &&
    hostState.teams.team2.players.some((p) => p.playerName === 'Roger'));

  // --- Page redirect: socket A disconnects, socket B loads player.html + rejoin ---
  a.close();
  await wait(120); // let disconnect fire (removes player)
  const b = io(URL);
  await once(b, 'connect');
  b.emit('rejoin', { gameId, role: 'player', teamChoice: 'team2', playerName: 'Roger' });
  await wait(120);

  check('player STILL on roster after redirect churn', hostState &&
    hostState.teams.team2.players.some((p) => p.playerName === 'Roger'));
  check('exactly one Roger (no duplicate)', hostState &&
    hostState.teams.team2.players.filter((p) => p.playerName === 'Roger').length === 1);

  // list-games should report the correct count too
  const lister = io(URL);
  await once(lister, 'connect');
  lister.emit('list-games');
  const games = await once(lister, 'games-list');
  const g = games.find((x) => x.gameId === gameId);
  check('list-games playerCount = 1', g && g.playerCount === 1);

  host.close(); b.close(); lister.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
