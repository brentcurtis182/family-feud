// Phase 8 (reworked v2): host-captured, 3-beat reveal (cursor → pick answer → score),
// board shows the PICKED survey answer (not transcript), P1-before-P2, remind, dup buzz.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, e) => new Promise((res) => s.once(e, res));
let failures = 0;
const check = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${l}`); if (!c) failures++; };

(async () => {
  const host = io(URL), tv = io(URL), p2dev = io(URL);
  await Promise.all([host, tv, p2dev].map((s) => once(s, 'connect')));
  host.emit('create-game', { hostMode: 'host-judge', team1Name: 'A', team2Name: 'B', passcode: 'pw' });
  const { gameId } = await once(host, 'game-created');
  host.emit('rejoin', { gameId, role: 'host' });
  let hs = null; host.on('game-state-sync', (s) => { hs = s; });
  tv.emit('join-game', { gameId, passcode: 'pw', role: 'gamescreen' });
  await once(tv, 'game-joined');
  let ts = null; tv.on('game-state-sync', (s) => { ts = s; });
  p2dev.emit('join-game', { gameId, passcode: 'pw', role: 'player', teamChoice: 'team2', playerName: 'Bo' });
  await once(p2dev, 'game-joined');
  p2dev.emit('rejoin', { gameId, role: 'player', teamChoice: 'team2', playerName: 'Bo' });

  host.emit('start-game'); await once(host, 'phase-changed');
  host.emit('fastmoney-start', { p1: 'Al', p2: 'Bo', source: 'bank' });
  await once(host, 'phase-changed'); await wait(60);
  check('phase FAST_MONEY_P1', hs.phase === 'FAST_MONEY_P1');

  // Submit P1 (transcript notes; board text comes from the host's pick, not these)
  host.emit('fastmoney-submit', { player: 'p1', answers: ['', '', '', '', ''] });
  await once(host, 'phase-changed'); await wait(50);
  check('phase FAST_MONEY_P1_REVEAL', hs.phase === 'FAST_MONEY_P1_REVEAL');

  // 3-beat reveal of p1[0]
  host.emit('fastmoney-cursor', { player: 'p1', index: 0 }); await wait(40);
  check('① cursor on, no answer/score yet',
    ts.fastMoney.reveal.p1[0].cursor === true &&
    ts.fastMoney.reveal.p1[0].text === null &&
    ts.fastMoney.reveal.p1[0].answerRevealed === false);

  const ansP = once(tv, 'fm-answer-revealed');
  host.emit('fastmoney-pick', { player: 'p1', index: 0, text: 'Eggs', points: 40 });
  await ansP; await wait(40);
  check('② words on board (picked text), score still hidden',
    ts.fastMoney.reveal.p1[0].text === 'Eggs' && ts.fastMoney.reveal.p1[0].points === null);
  check('② score not counted yet', hs.fastMoney.totals.p1 === 0);

  const scoreP = once(tv, 'fm-score-revealed');
  host.emit('fastmoney-reveal-score', { player: 'p1', index: 0 });
  await scoreP; await wait(40);
  check('③ score on board', ts.fastMoney.reveal.p1[0].points === 40);
  check('③ subtotal updates', hs.fastMoney.totals.p1 === 40);

  for (let i = 1; i < 5; i++) {
    host.emit('fastmoney-pick', { player: 'p1', index: i, text: 'X' + i, points: 20 }); await wait(20);
    host.emit('fastmoney-reveal-score', { player: 'p1', index: i }); await wait(20);
  }
  await wait(40);
  check('p1 total = 40 + 4*20 = 120', hs.fastMoney.totals.p1 === 120);

  // Hand off to P2
  host.emit('fastmoney-to-p2'); await once(host, 'phase-changed'); await wait(40);
  check('phase P2_WAIT', hs.phase === 'FAST_MONEY_P2_WAIT');
  host.emit('fastmoney-remind', { show: true }); await wait(40);
  check('remind on', hs.fastMoney.remindP1 === true);
  host.emit('fastmoney-start-p2'); await once(host, 'phase-changed'); await wait(40);
  check('phase FAST_MONEY_P2', hs.phase === 'FAST_MONEY_P2');
  check('remind cleared', hs.fastMoney.remindP1 === false);

  const dupP = once(p2dev, 'fm-dup-buzz');
  host.emit('fastmoney-dup-buzz'); await dupP;
  check('dup-buzz reaches P2 device', true);

  host.emit('fastmoney-submit', { player: 'p2', answers: ['', '', '', '', ''] });
  await once(host, 'phase-changed'); await wait(50);
  check('phase FAST_MONEY_REVEAL', hs.phase === 'FAST_MONEY_REVEAL');

  // P2 reveal: a duplicate + two scoring answers
  host.emit('fastmoney-pick', { player: 'p2', index: 0, text: 'Eggs', points: 0, duplicate: true }); await wait(20);
  host.emit('fastmoney-reveal-score', { player: 'p2', index: 0 }); await wait(30);
  check('p2[0] duplicate stored as 0', hs.fastMoney.reveal.p2[0].duplicate === true && hs.fastMoney.reveal.p2[0].points === 0);

  host.emit('fastmoney-pick', { player: 'p2', index: 1, text: 'Tea', points: 50 }); await wait(20);
  host.emit('fastmoney-reveal-score', { player: 'p2', index: 1 }); await wait(20);
  host.emit('fastmoney-pick', { player: 'p2', index: 2, text: 'Cereal', points: 40 }); await wait(20);
  host.emit('fastmoney-reveal-score', { player: 'p2', index: 2 }); await wait(30);
  check('combined total = 120 + 90 = 210', hs.fastMoney.total === 210);
  check('won (>=200)', hs.fastMoney.won === true);

  host.emit('fastmoney-unassign', { player: 'p2', index: 2 }); await wait(40);
  check('unassign lowers total + clears win', hs.fastMoney.total === 170 && hs.fastMoney.won === false);

  [host, tv, p2dev].forEach((s) => s.close());
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
