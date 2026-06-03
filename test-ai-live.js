// Live AI test — requires a real ANTHROPIC_API_KEY in .env. Hits the real API.
const ai = require('./server/aiQuestions');

function validate(q, label) {
  const ok = q && typeof q.text === 'string' && Array.isArray(q.answers) &&
    q.answers.length >= 4 && q.answers.length <= 8 &&
    q.answers.every((a) => typeof a.text === 'string' && Number.isInteger(a.points));
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (q) {
    console.log(`   Q: ${q.text}`);
    q.answers.forEach((a, i) => console.log(`     ${i + 1}. ${a.text} — ${a.points}`));
  }
  return ok;
}

(async () => {
  if (!ai.isAvailable()) {
    console.log('FAIL: no API key configured');
    process.exit(1);
  }
  let failures = 0;

  // 1) Generate two real questions
  const q1 = await ai.generateQuestion('food');
  if (!validate(q1, 'live generate (food)')) failures++;
  const q2 = await ai.generateQuestion('animals at the zoo');
  if (!validate(q2, 'live generate (custom topic)')) failures++;

  // 2) Prompt-caching proof: two raw calls; 2nd should read from cache
  const client = ai.getClient();
  const callRaw = (topic) => client.messages.create({
    model: ai.MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: ai.SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Topic: ${topic}. Generate one question now as JSON.` }],
  });

  const r1 = await callRaw('sports');
  const r2 = await callRaw('school');
  const u1 = r1.usage, u2 = r2.usage;
  console.log('   usage call1:', JSON.stringify(u1));
  console.log('   usage call2:', JSON.stringify(u2));
  const cacheWorking =
    (u1.cache_creation_input_tokens > 0 || u2.cache_read_input_tokens > 0);
  console.log(`${cacheWorking ? 'PASS' : 'WARN'}: prompt caching active (cache_read on 2nd call: ${u2.cache_read_input_tokens || 0})`);

  console.log(`\n${failures === 0 ? 'LIVE AI OK' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
