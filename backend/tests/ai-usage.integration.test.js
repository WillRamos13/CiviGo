const test = require('node:test');
const assert = require('node:assert/strict');
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(connection).hostname)) throw new Error('Requires local test database');
  require('./helpers/provider-environment').disableExternalProviders();
  process.env.DATABASE_URL = connection;
}

test('AI request quotas are atomic for concurrent requests, persistent and service-specific', { skip: !connection, timeout: 60000 }, async t => {
  const { PrismaClient } = require('@prisma/client');
  const { reserveAiRequest } = require('../src/lib/ai-usage');
  const { createGuardedAi } = require('../src/lib/guarded-ai');
  const db = new PrismaClient({ datasources: { db: { url: connection } } });
  const limits = { daily: 2, monthly: 3 };
  // Isolated future calendar windows: no production counter can be touched.
  const first = new Date('2091-01-31T23:59:00Z');
  const before = new Date('2091-01-30T12:00:00Z');
  const after = new Date('2091-02-01T00:00:00Z');
  const where = { OR: [{ clave: { startsWith: 'ai:chat:day:2091-' } }, { clave: { startsWith: 'ai:chat:month:2091-' } },
    { clave: { startsWith: 'ai:reportes:day:2091-' } }, { clave: { startsWith: 'ai:reportes:month:2091-' } }] };
  try {
    await db.usageCounter.deleteMany({ where });
    await t.test('Concurrent requests cannot exceed the daily quota; losing reservations do not consume the month', async () => {
      const result = await Promise.all(Array.from({ length: 8 }, () => reserveAiRequest(db, 'chat', before, limits)));
      assert.equal(result.filter(Boolean).length, 2);
      assert.equal((await db.usageCounter.findUnique({ where: { clave: 'ai:chat:day:2091-01-30' } })).cantidad, 2);
      assert.equal((await db.usageCounter.findUnique({ where: { clave: 'ai:chat:month:2091-01' } })).cantidad, 2);
    });
    await t.test('New clients inherit monthly usage and the next month resets both windows', async () => {
      // PGlite supports one connected client; reconnect a fresh Prisma instance
      // to prove persistence independently of the original adapter instance.
      await db.$disconnect();
      const newProcess = new PrismaClient({ datasources: { db: { url: connection } } });
      try {
        assert.equal(await reserveAiRequest(newProcess, 'chat', first, limits), true);
        assert.equal(await reserveAiRequest(newProcess, 'chat', first, limits), false);
        assert.equal((await newProcess.usageCounter.findUnique({ where: { clave: 'ai:chat:day:2091-01-31' } })).cantidad, 1);
        assert.equal(await reserveAiRequest(newProcess, 'chat', after, limits), true);
        assert.equal(await reserveAiRequest(newProcess, 'reportes', first, limits), true);
      } finally { await newProcess.$disconnect(); }
    });
    await t.test('Exhausted chat returns null for the guide and leaves the report allowance independent', async () => {
      let chatCalls = 0;
      let reportCalls = 0;
      t.mock.method(console, 'warn', () => {});
      const guarded = createGuardedAi({
        reserve: purpose => reserveAiRequest(db, purpose, first, limits),
        adapter: { aiStatus: () => ({ chatConfigurado: true, reportesConfigurado: true }),
          assist: async () => { chatCalls++; return 'AI fixture'; },
          evaluateReport: async () => { reportCalls++; return null; } },
      });
      assert.equal(await guarded.assist('Cómo reporto', {}), null);
      assert.equal(chatCalls, 0);
      assert.equal(await guarded.evaluateReport({}, {}), null);
      assert.equal(reportCalls, 1, 'provider failure consumes its allowance');
      assert.equal(await guarded.evaluateReport({}, {}), null);
      assert.equal(reportCalls, 1, 'quota fallback preserves the human review contract');
    });
  } finally {
    await db.usageCounter.deleteMany({ where });
    await db.$disconnect();
  }
});
