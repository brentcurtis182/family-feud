// List the questions flagged as unplayable during games.
//   node scripts/flags.js            → show them
//   node scripts/flags.js --prune    → delete them from questionBank.json for good
//
// Why prune: server/flagged.json keeps flags across restarts, but Railway wipes
// the container filesystem on every redeploy. Pruning bakes the decisions into
// the committed bank so they survive deploys.
const fs = require('fs');
const path = require('path');
const flagged = require('../server/flagged');
const { hashQuestion } = require('../server/questions');

const BANK = path.join(__dirname, '..', 'server', 'questionBank.json');
const prune = process.argv.includes('--prune');

const list = flagged.list();
if (!list.length) {
  console.log('No flagged questions.');
  process.exit(0);
}

const byReason = new Map();
for (const e of list) byReason.set(e.reason, (byReason.get(e.reason) || 0) + 1);

console.log(`${list.length} flagged question${list.length === 1 ? '' : 's'}:\n`);
for (const e of list) {
  const when = new Date(e.at).toISOString().slice(0, 10);
  console.log(`  [${e.reason}] (${e.source}, ${e.topic}, ${when})`);
  console.log(`    ${e.text}`);
}
console.log('\nBy reason:');
for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}

if (!prune) {
  console.log('\nRe-run with --prune to remove these from server/questionBank.json permanently.');
  process.exit(0);
}

const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
const before = bank.length;
const kept = bank.filter((q) => !flagged.isFlagged(hashQuestion(q.text)));
const removed = before - kept.length;

if (!removed) {
  console.log('\nNothing to prune — no flagged question is in the bank (they were AI-generated).');
  process.exit(0);
}

fs.writeFileSync(BANK, JSON.stringify(kept, null, 2) + '\n');
console.log(`\nPruned ${removed} question${removed === 1 ? '' : 's'} from the bank (${before} → ${kept.length}).`);
console.log('Commit server/questionBank.json so it survives the next deploy.');
