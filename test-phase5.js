// End-to-end test for Phase 5: play/pass, strikes->steal, scoring, win.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));

let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

// Build a game with host + two contestants; returns helpers.
async function setupGame(name) {
  const host = io(URL); const p1 = io(URL); const p2 = io(URL);
  await Promise.all([once(host, 'connect'), once(p1, 'connect'), once(p2, 'connect')]);
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'Reds', team2Name: 'Blues', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  p1.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team1', playerName: 'Alice' });
  p2.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Bob' });
  await Promise.all([once(p1, 'game-joined'), once(p2, 'game-joined')]);
  host.emit('start-game');
  await once(host, 'phase-changed');

  let hs = null;
  host.on('game-state-sync', (s) => { hs = s; });
  const state = () => hs;
  const sockets = { host, p1, p2, gameId };

  // Drive a face-off so a team wins the buzz (Alice/team1 by default).
  async function faceOff() {
    host.emit('set-question', { source: 'bank' });
    await wait(60);
    host.emit('select-faceoff-players', { team1Player: 'Alice' });
    host.emit('select-faceoff-players', { team2Player: 'Bob' });
    await wait(80);
    host.emit('open-buzzers');
    await once(p1, 'buzzers-open');
    p1.emit('buzz');
    await wait(80); // now FACE_OFF_ANSWER, team1 won
  }

  return { ...sockets, state, faceOff };
}

(async () => {
  // --- Scenario 1: steal SUCCESS gives bank to stealing team ---
  {
    const g = await setupGame('steal-success');
    await g.faceOff();
    g.host.emit('choose-play', { team: 'team1' });
    await wait(60);
    const q = g.state().currentQuestion;
    const mult = g.state().roundMultiplier;
    // team1 reveals answer 0, then strikes out
    g.host.emit('reveal-answer', { position: 0 });
    await wait(50);
    g.host.emit('add-strike'); await wait(30);
    g.host.emit('add-strike'); await wait(30);
    g.host.emit('add-strike'); await wait(80); // -> STEAL_ATTEMPT, team2 steals
    check('S1 phase STEAL_ATTEMPT after 3 strikes', g.state().phase === 'STEAL_ATTEMPT');
    check('S1 stealing team is team2', g.state().activePlay.stealingTeam === 'team2');
    // team2 steals by revealing answer 1
    g.host.emit('reveal-answer', { position: 1 });
    await wait(80);
    const expected = (q.answers[0].points + q.answers[1].points) * mult;
    check('S1 steal success -> team2 gets full bank',
      g.state().teams.team2.score === expected);
    check('S1 team1 got nothing', g.state().teams.team1.score === 0);
    check('S1 phase ROUND_END', g.state().phase === 'ROUND_END');
    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Scenario 2: steal FAIL keeps bank with playing team ---
  {
    const g = await setupGame('steal-fail');
    await g.faceOff();
    g.host.emit('choose-play', { team: 'team1' });
    await wait(60);
    const q = g.state().currentQuestion;
    const mult = g.state().roundMultiplier;
    g.host.emit('reveal-answer', { position: 0 });
    await wait(50);
    g.host.emit('add-strike'); await wait(30);
    g.host.emit('add-strike'); await wait(30);
    g.host.emit('add-strike'); await wait(80); // -> steal by team2
    g.host.emit('add-strike'); // steal FAILS (strike during steal)
    await wait(80);
    check('S2 steal fail -> team1 keeps bank',
      g.state().teams.team1.score === q.answers[0].points * mult);
    check('S2 team2 got nothing', g.state().teams.team2.score === 0);
    check('S2 phase ROUND_END', g.state().phase === 'ROUND_END');
    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Scenario 3: board clear awards playing team + advance-round increments ---
  {
    const g = await setupGame('board-clear');
    await g.faceOff();
    g.host.emit('choose-play', { team: 'team1' });
    await wait(60);
    const q = g.state().currentQuestion;
    const mult = g.state().roundMultiplier;
    const sum = q.answers.reduce((a, x) => a + x.points, 0);
    for (let i = 0; i < q.answers.length; i++) {
      g.host.emit('reveal-answer', { position: i });
      await wait(35);
    }
    await wait(80);
    check('S3 board clear -> team1 gets full sum*mult',
      g.state().teams.team1.score === sum * mult);
    const roundBefore = g.state().round;
    g.host.emit('advance-round');
    await wait(80);
    check('S3 advance-round increments round', g.state().round === roundBefore + 1);
    check('S3 next round phase ROUND_SETUP', g.state().phase === 'ROUND_SETUP');
    g.host.close(); g.p1.close(); g.p2.close();
  }

  // --- Scenario 4: reach 300 -> GAME_OVER with a winner ---
  {
    const g = await setupGame('win');
    let safety = 0;
    while (g.state() === null || g.state().phase !== 'GAME_OVER') {
      if (++safety > 10) break;
      await g.faceOff();
      g.host.emit('choose-play', { team: 'team1' });
      await wait(50);
      const q = g.state().currentQuestion;
      for (let i = 0; i < q.answers.length; i++) {
        g.host.emit('reveal-answer', { position: i });
        await wait(25);
      }
      await wait(80);
      if (g.state().phase === 'ROUND_END') {
        g.host.emit('advance-round');
        await wait(80);
      }
    }
    check('S4 reached GAME_OVER', g.state().phase === 'GAME_OVER');
    check('S4 winner is team1', g.state().winner === 'team1');
    check('S4 winning score >= 300', g.state().teams.team1.score >= 300);
    g.host.close(); g.p1.close(); g.p2.close();
  }

  await wait(150);
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
