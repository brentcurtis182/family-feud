// Line-up rotation: each round the face-off moves one down each team's line,
// the host can override, and roster edits don't silently change whose turn it is.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

// Host + one buzzer per team, with a 3-name line-up on team1 and 2 on team2.
async function setupGame() {
  const host = io(URL); const p1 = io(URL); const p2 = io(URL);
  await Promise.all([once(host, 'connect'), once(p1, 'connect'), once(p2, 'connect')]);
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'Reds', team2Name: 'Blues', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  p1.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team1', playerName: 'dev-1' });
  p2.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'dev-2' });
  await Promise.all([once(p1, 'game-joined'), once(p2, 'game-joined')]);

  for (const n of ['Alice', 'Bianca', 'Cara']) host.emit('roster-add', { team: 'team1', name: n });
  for (const n of ['Dan', 'Eli']) host.emit('roster-add', { team: 'team2', name: n });
  await wait(120);

  host.emit('start-game');
  await once(host, 'phase-changed');

  let hs = null;
  host.on('game-state-sync', (s) => { hs = s; });
  host.emit('rejoin', { gameId, role: 'host' }); // forces a first state sync
  await wait(120);

  const state = () => hs;
  const picks = () => [
    hs.faceOff.team1Player && hs.faceOff.team1Player.playerName,
    hs.faceOff.team2Player && hs.faceOff.team2Player.playerName,
  ];

  // Play a round out to ROUND_END, scoring as little as possible: one answer,
  // then strike out and let the steal fail. A board clear would cross 300 and
  // end the game before the rotation has run its full length.
  async function playRound() {
    host.emit('set-question', { source: 'bank' });
    await wait(80);
    host.emit('open-buzzers');
    await once(p1, 'buzzers-open');
    p1.emit('buzz');
    await wait(80);
    host.emit('choose-play', { team: 'team1' });
    await wait(60);
    host.emit('reveal-answer', { position: 0 });
    await wait(50);
    for (let i = 0; i < 3; i++) { host.emit('add-strike'); await wait(35); }
    await wait(60);
    host.emit('add-strike'); // steal fails -> ROUND_END
    await wait(90);
  }

  return { host, p1, p2, gameId, state, picks, playRound };
}

(async () => {
  // --- Rotation down the line, wrapping at the end of the shorter team ---
  {
    const g = await setupGame();

    check('R1 opens with the top of each line', String(g.picks()) === 'Alice,Dan');
    check('R1 turnIndex is 0 for both',
      g.state().teams.team1.turnIndex === 0 && g.state().teams.team2.turnIndex === 0);

    await g.playRound();
    g.host.emit('advance-round');
    await wait(100);
    check('R2 moves one down each line', String(g.picks()) === 'Bianca,Eli');

    await g.playRound();
    g.host.emit('advance-round');
    await wait(100);
    // team2 has only 2 names, so it wraps back to the top while team1 keeps going.
    check('R3 advances team1 and wraps team2', String(g.picks()) === 'Cara,Dan');

    await g.playRound();
    g.host.emit('advance-round');
    await wait(100);
    check('R4 wraps team1 back to the top', String(g.picks()) === 'Alice,Eli');

    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Host override moves the pointer, and the next round follows from there ---
  {
    const g = await setupGame();
    check('starts on Alice', g.picks()[0] === 'Alice');

    g.host.emit('select-faceoff-players', { team1Player: 'Cara' });
    await wait(100);
    check('override picks Cara', g.picks()[0] === 'Cara');
    check('override moved the pointer', g.state().teams.team1.turnIndex === 2);

    await g.playRound();
    g.host.emit('advance-round');
    await wait(100);
    check('next round continues from the override (wraps to Alice)', g.picks()[0] === 'Alice');

    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Reset-round replays the same pair rather than burning their turn ---
  {
    const g = await setupGame();
    await g.playRound();
    g.host.emit('advance-round');
    await wait(100);
    check('on Bianca/Eli before the reset', String(g.picks()) === 'Bianca,Eli');

    g.host.emit('reset-round');
    await wait(120);
    check('reset-round keeps the same pair up', String(g.picks()) === 'Bianca,Eli');

    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Roster edits keep the pointer on the same person ---
  {
    const g = await setupGame();
    g.host.emit('select-faceoff-players', { team1Player: 'Bianca' });
    await wait(100);
    check('pointer on Bianca (index 1)', g.state().teams.team1.turnIndex === 1);

    // Removing someone ahead of her shifts the array but not whose turn it is.
    g.host.emit('roster-remove', { team: 'team1', name: 'Alice' });
    await wait(120);
    check('removal above keeps Bianca up', g.picks()[0] === 'Bianca');
    check('pointer followed her to index 0', g.state().teams.team1.turnIndex === 0);

    // Reordering does the same.
    g.host.emit('roster-add', { team: 'team1', name: 'Dara' });
    await wait(100);
    g.host.emit('roster-reorder', { team: 'team1', index: 0, direction: 'down' });
    await wait(120);
    check('reorder moved Bianca down the line',
      String(g.state().teams.team1.roster) === 'Cara,Bianca,Dara');
    check('reorder kept Bianca up', g.picks()[0] === 'Bianca');
    check('pointer followed the reorder', g.state().teams.team1.turnIndex === 1);

    // Removing whoever is up refills the slot from the line-up instead of blanking.
    g.host.emit('roster-remove', { team: 'team1', name: 'Bianca' });
    await wait(120);
    check('removing the current player refills the slot', g.picks()[0] === 'Dara');

    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Moving a player across teams drops the stale pick on the old team ---
  {
    const g = await setupGame();
    g.host.emit('roster-move', { fromTeam: 'team1', name: 'Alice' });
    await wait(150);
    check('Alice left team1', !g.state().teams.team1.roster.includes('Alice'));
    check('Alice joined team2', g.state().teams.team2.roster.includes('Alice'));
    check('team1 refilled from its line-up', g.picks()[0] === 'Bianca');
    check('team2 pick still valid', g.state().teams.team2.roster.includes(g.picks()[1]));

    g.host.close(); g.p1.close(); g.p2.close();
  }

  await wait(150);
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
