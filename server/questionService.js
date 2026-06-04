const questions = require('./questions');
const aiQuestions = require('./aiQuestions');

// Resolve one question: try AI (unless bank requested / unavailable), fall back
// to the offline bank. Avoids repeating a question already used this game.
async function resolveQuestion(game, { topic, source, style, suddenDeath } = {}) {
  // Sudden death: always pull from the bank so we can guarantee a dominant-top
  // ("obvious") question.
  if (suddenDeath) {
    return questions.getSampleQuestion(game.usedQuestionHashes, topic, { suddenDeath: true });
  }
  if (source !== 'bank' && aiQuestions.isAvailable()) {
    const avoid = (game.recentQuestions || []).slice(-12);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await aiQuestions.generateQuestion(topic, style, avoid);
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
  return questions.getSampleQuestion(game.usedQuestionHashes, topic, { fmFriendly: style === 'fastmoney' });
}

module.exports = { resolveQuestion };
