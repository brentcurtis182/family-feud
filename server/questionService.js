const questions = require('./questions');
const aiQuestions = require('./aiQuestions');

// Resolve one question: try AI (unless bank requested / unavailable), fall back
// to the offline bank. Avoids repeating a question already used this game.
async function resolveQuestion(game, { topic, source } = {}) {
  if (source !== 'bank' && aiQuestions.isAvailable()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await aiQuestions.generateQuestion(topic);
        if (raw) {
          const q = questions.buildQuestion(raw);
          if (!game.usedQuestionHashes.has(q.hash)) return q;
        }
      } catch (e) {
        console.error('AI question generation failed:', e.message);
        break; // fall through to the bank
      }
    }
  }
  return questions.getSampleQuestion(game.usedQuestionHashes, topic);
}

module.exports = { resolveQuestion };
