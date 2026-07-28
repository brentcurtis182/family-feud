const fs = require('fs');
const path = require('path');

// Questions the host has flagged as unplayable during a game (duplicate
// answers, nonsense, wrong language…). Keyed by the same sha1-of-text hash the
// rest of the app uses, so a flag matches the question wherever it came from —
// the bank, the curated set, or an AI generation that happened to repeat.
//
// Persisted to disk so flags survive a server restart. NOTE: on Railway the
// container filesystem is wiped by a redeploy, so anything flagged during a
// party is only durable once it's committed — `npm run flags:prune` bakes them
// into questionBank.json for that.
const FILE = path.join(__dirname, 'flagged.json');

let entries = new Map(); // hash -> { hash, text, topic, source, reason, at }

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.flagged || [];
    entries = new Map(list.filter((e) => e && e.hash).map((e) => [e.hash, e]));
  } catch {
    entries = new Map(); // no file yet (or unreadable) — start empty
  }
  return entries.size;
}

function save() {
  const payload = { flagged: [...entries.values()] };
  try {
    fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
  } catch (e) {
    console.error('Could not persist flagged questions:', e.message);
  }
}

function isFlagged(hash) {
  return entries.has(hash);
}

function count() {
  return entries.size;
}

function list() {
  return [...entries.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
}

// Record a flag. Returns the stored entry, or null if the input was unusable.
// Re-flagging an already-flagged question is a no-op that keeps the first
// reason (so a stray second tap can't overwrite a more specific one).
function flag({ hash, text, topic, source, reason }) {
  if (!hash || !text) return null;
  if (entries.has(hash)) return entries.get(hash);
  const entry = {
    hash,
    text: String(text).slice(0, 300),
    topic: topic || 'general',
    source: source || 'bank',
    reason: reason || 'unspecified',
    at: Date.now(),
  };
  entries.set(hash, entry);
  save();
  return entry;
}

function unflag(hash) {
  if (!entries.delete(hash)) return false;
  save();
  return true;
}

load();

module.exports = { isFlagged, flag, unflag, list, count, load, FILE };
