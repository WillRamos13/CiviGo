const test = require('node:test');
const assert = require('node:assert/strict');
const { aiUsageLimits, reserveAiRequest } = require('../src/lib/ai-usage');
const { createGuardedAi } = require('../src/lib/guarded-ai');

test('AI quotas have separate service defaults and invalid or zero settings stop paid requests', async () => {
  assert.deepEqual(aiUsageLimits('chat', {}), { daily: 1000, monthly: 15000 });
  assert.deepEqual(aiUsageLimits('reportes', {}), { daily: 200, monthly: 3000 });
  const env = { AI_CHAT_DAILY_REQUEST_LIMIT: '12', AI_CHAT_MONTHLY_REQUEST_LIMIT: '400',
    AI_REPORT_DAILY_REQUEST_LIMIT: '0', AI_REPORT_MONTHLY_REQUEST_LIMIT: 'broken' };
  assert.deepEqual(aiUsageLimits('chat', env), { daily: 12, monthly: 400 });
  assert.deepEqual(aiUsageLimits('reportes', env), { daily: 0, monthly: 0 });
  assert.equal(aiUsageLimits('chat', { AI_CHAT_DAILY_REQUEST_LIMIT: '-1' }).daily, 0);
  assert.equal(aiUsageLimits('chat', { AI_CHAT_DAILY_REQUEST_LIMIT: '2.5' }).daily, 0);
  assert.equal(await reserveAiRequest(null, 'chat', new Date(), { daily: 0, monthly: 10 }), false);
  assert.throws(() => aiUsageLimits('other'), TypeError);
});

test('Quota exhaustion or unavailable database falls back without contacting the AI provider', async t => {
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  const adapter = { aiStatus: () => ({ chatConfigurado: true, reportesConfigurado: true }),
    assist: async (...args) => { calls.push(['chat', ...args]); return 'Respuesta'; },
    evaluateReport: async (...args) => { calls.push(['reportes', ...args]); return { gravedad: 2 }; } };
  for (const reserve of [async () => false, async () => { throw new Error('private database details'); }]) {
    const guarded = createGuardedAi({ adapter, reserve });
    assert.equal(await guarded.assist('Cómo reporto', {}), null);
    assert.equal(await guarded.evaluateReport({}, {}), null);
  }
  assert.equal(calls.length, 0);
  const reserved = [];
  const permitted = createGuardedAi({ adapter, reserve: async purpose => { reserved.push(purpose); return true; } });
  assert.equal(await permitted.assist('Cómo reporto', { fixture: true }, []), 'Respuesta');
  assert.deepEqual(await permitted.evaluateReport({ descripcion: 'Fixture' }, { slug: 'incendio' }), { gravedad: 2 });
  assert.deepEqual(reserved, ['chat', 'reportes']);
  assert.deepEqual(calls[0], ['chat', 'Cómo reporto', { fixture: true }, []]);
});

test('Unconfigured providers do not consume the durable allowance', async () => {
  const unavailable = async () => null;
  const guarded = createGuardedAi({ adapter: { aiStatus: () => ({ chatConfigurado: false, reportesConfigurado: false }),
    assist: unavailable, evaluateReport: unavailable }, reserve: async () => { assert.fail('No request to reserve'); } });
  assert.equal(await guarded.assist('Ayuda', {}), null);
  assert.equal(await guarded.evaluateReport({}, {}), null);
});

test('Serialization conflicts retry the whole reservation and exhausted windows roll back', async () => {
  let attempts = 0;
  const db = { $transaction: async work => {
    if (++attempts < 3) throw Object.assign(new Error('Serialization conflict'), { code: 'P2034' });
    return work({ usageCounter: { upsert: async () => ({ cantidad: 1 }) } });
  } };
  assert.equal(await reserveAiRequest(db, 'chat'), true);
  assert.equal(attempts, 3);
  await assert.rejects(reserveAiRequest({ $transaction: async () => { throw new Error('down'); } }, 'chat'), /down/);
});
