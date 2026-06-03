// Diagnostic: list live games + player counts from the running server.
const { io } = require('socket.io-client');
const s = io('http://localhost:3000');
s.on('connect', () => s.emit('list-games'));
s.on('games-list', (games) => {
  console.log('Active games:', games.length);
  for (const g of games) {
    console.log(JSON.stringify(g));
  }
  s.close();
  process.exit(0);
});
setTimeout(() => { console.log('timeout'); process.exit(1); }, 3000);
