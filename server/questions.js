// Offline question bank — categorized by topic. Used directly as the "bank"
// source and as the fallback when AI generation is unavailable/fails.
// Shape: { text, topic, answers: [{ text, points }] }  (points sum ~100)
const crypto = require('crypto');

const SAMPLE_QUESTIONS = [
  // ---- everyday ----
  {
    text: 'Name something you do first thing in the morning.',
    topic: 'everyday',
    answers: [
      { text: 'Use the bathroom', points: 31 },
      { text: 'Drink coffee', points: 24 },
      { text: 'Check your phone', points: 18 },
      { text: 'Brush your teeth', points: 12 },
      { text: 'Eat breakfast', points: 9 },
      { text: 'Shower', points: 6 },
    ],
  },
  {
    text: 'Name a place where it would be rude to be on your phone.',
    topic: 'everyday',
    answers: [
      { text: 'Church', points: 28 },
      { text: 'A funeral', points: 22 },
      { text: 'A movie theater', points: 19 },
      { text: 'A job interview', points: 16 },
      { text: 'At dinner', points: 9 },
      { text: 'A wedding', points: 6 },
    ],
  },
  {
    text: 'Name something people lose all the time.',
    topic: 'everyday',
    answers: [
      { text: 'Keys', points: 34 },
      { text: 'Phone', points: 23 },
      { text: 'Wallet', points: 17 },
      { text: 'Glasses', points: 13 },
      { text: 'TV remote', points: 8 },
      { text: 'Socks', points: 5 },
    ],
  },

  // ---- general ----
  {
    text: 'Name something people are afraid of.',
    topic: 'general',
    answers: [
      { text: 'Spiders', points: 27 },
      { text: 'Heights', points: 23 },
      { text: 'Snakes', points: 17 },
      { text: 'The dark', points: 13 },
      { text: 'Death', points: 11 },
      { text: 'Clowns', points: 9 },
    ],
  },
  {
    text: 'Name something that makes a loud noise.',
    topic: 'general',
    answers: [
      { text: 'Thunder', points: 26 },
      { text: 'Fireworks', points: 21 },
      { text: 'A siren', points: 18 },
      { text: 'A dog barking', points: 14 },
      { text: 'A baby crying', points: 12 },
      { text: 'A jet engine', points: 9 },
    ],
  },

  // ---- food ----
  {
    text: 'Name a food people eat at the movies.',
    topic: 'food',
    answers: [
      { text: 'Popcorn', points: 42 },
      { text: 'Candy', points: 21 },
      { text: 'Nachos', points: 15 },
      { text: 'Hot dog', points: 11 },
      { text: 'Soda', points: 7 },
      { text: 'Pretzel', points: 4 },
    ],
  },
  {
    text: 'Name a topping people put on pizza.',
    topic: 'food',
    answers: [
      { text: 'Pepperoni', points: 35 },
      { text: 'Cheese', points: 22 },
      { text: 'Mushrooms', points: 15 },
      { text: 'Sausage', points: 12 },
      { text: 'Onions', points: 9 },
      { text: 'Peppers', points: 7 },
    ],
  },

  // ---- animals ----
  {
    text: 'Name an animal you might see at the zoo.',
    topic: 'animals',
    answers: [
      { text: 'Lion', points: 25 },
      { text: 'Elephant', points: 21 },
      { text: 'Monkey', points: 18 },
      { text: 'Giraffe', points: 15 },
      { text: 'Tiger', points: 12 },
      { text: 'Zebra', points: 9 },
    ],
  },
  {
    text: 'Name an animal that is hard to keep as a pet.',
    topic: 'animals',
    answers: [
      { text: 'Lion / tiger', points: 28 },
      { text: 'Snake', points: 20 },
      { text: 'Elephant', points: 16 },
      { text: 'Bear', points: 14 },
      { text: 'Alligator', points: 12 },
      { text: 'Shark', points: 10 },
    ],
  },

  // ---- home ----
  {
    text: 'Name something you might find in a junk drawer.',
    topic: 'home',
    answers: [
      { text: 'Batteries', points: 26 },
      { text: 'Pens', points: 22 },
      { text: 'Rubber bands', points: 16 },
      { text: 'Tape', points: 13 },
      { text: 'Scissors', points: 12 },
      { text: 'Keys', points: 6 },
      { text: 'Takeout menus', points: 5 },
    ],
  },
  {
    text: 'Name a chore people put off doing.',
    topic: 'home',
    answers: [
      { text: 'Dishes', points: 27 },
      { text: 'Laundry', points: 23 },
      { text: 'Vacuuming', points: 17 },
      { text: 'Taking out trash', points: 13 },
      { text: 'Cleaning bathroom', points: 11 },
      { text: 'Mowing the lawn', points: 9 },
    ],
  },

  // ---- travel ----
  {
    text: 'Name something you pack for a beach vacation.',
    topic: 'travel',
    answers: [
      { text: 'Sunscreen', points: 30 },
      { text: 'Swimsuit', points: 25 },
      { text: 'Towel', points: 18 },
      { text: 'Sunglasses', points: 12 },
      { text: 'Flip flops', points: 9 },
      { text: 'Hat', points: 6 },
    ],
  },

  // ---- entertainment ----
  {
    text: 'Name a board game families play together.',
    topic: 'entertainment',
    answers: [
      { text: 'Monopoly', points: 32 },
      { text: 'Scrabble', points: 19 },
      { text: 'Sorry', points: 15 },
      { text: 'Clue', points: 13 },
      { text: 'Candy Land', points: 11 },
      { text: 'Life', points: 10 },
    ],
  },
];

// Distinct topics present in the bank (for host topic chips).
const TOPICS = [...new Set(SAMPLE_QUESTIONS.map((q) => q.topic))];

function hashQuestion(text) {
  return crypto.createHash('sha1').update(text.toLowerCase().trim()).digest('hex');
}

// Build a playable question object (attaches reveal flags + a stable hash).
function buildQuestion(raw) {
  return {
    text: raw.text,
    topic: raw.topic || 'general',
    hash: hashQuestion(raw.text),
    answers: raw.answers.map((a) => ({
      text: a.text,
      points: a.points,
      revealed: false,
    })),
  };
}

// Pick a random bank question (optionally by topic) not already used this game.
function getSampleQuestion(usedHashes = new Set(), topic = null) {
  let pool = SAMPLE_QUESTIONS;
  if (topic && topic !== 'random') {
    const byTopic = SAMPLE_QUESTIONS.filter((q) => q.topic === topic);
    if (byTopic.length) pool = byTopic;
  }
  let available = pool.filter((q) => !usedHashes.has(hashQuestion(q.text)));
  // If this topic is exhausted, fall back to any unused question, then anything.
  if (!available.length) {
    available = SAMPLE_QUESTIONS.filter((q) => !usedHashes.has(hashQuestion(q.text)));
  }
  if (!available.length) available = SAMPLE_QUESTIONS;
  const raw = available[Math.floor(Math.random() * available.length)];
  return buildQuestion(raw);
}

module.exports = {
  SAMPLE_QUESTIONS,
  TOPICS,
  hashQuestion,
  buildQuestion,
  getSampleQuestion,
};
