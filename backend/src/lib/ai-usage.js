const { serializable } = require('./upload-quota');

// Counts outbound request attempts, not tokens or money. Calendar windows use
// UTC, share a database across replicas and survive restarts and deployments.
function aiUsageLimits(purpose, env = process.env) {
  if (!['chat', 'reportes'].includes(purpose)) throw new TypeError('Invalid AI service');
  const report = purpose === 'reportes';
  const prefix = report ? 'AI_REPORT' : 'AI_CHAT';
  const value = (window, fallback) => {
    const raw = env[`${prefix}_${window}_REQUEST_LIMIT`];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    // An invalid configured limit fails closed; zero explicitly pauses AI.
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1000000 ? parsed : 0;
  };
  return { daily: value('DAILY', report ? 200 : 1000), monthly: value('MONTHLY', report ? 3000 : 15000) };
}

class QuotaReached extends Error {}

async function reserveAiRequest(db, purpose, now = new Date(), limits = aiUsageLimits(purpose)) {
  if (!['chat', 'reportes'].includes(purpose)) throw new TypeError('Invalid AI service');
  if (!Number.isFinite(+now) || ![limits.daily, limits.monthly].every(v => Number.isSafeInteger(v) && v >= 0))
    throw new TypeError('Invalid AI quota');
  if (!limits.daily || !limits.monthly) return false;
  const date = now.toISOString();
  const windows = [
    { name: 'month', period: date.slice(0, 7), limit: limits.monthly,
      expiresAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 3)) },
    { name: 'day', period: date.slice(0, 10), limit: limits.daily,
      expiresAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3)) },
  ];
  try {
    await serializable(db, async tx => {
      for (const window of windows) {
        const clave = `ai:${purpose}:${window.name}:${window.period}`;
        const row = await tx.usageCounter.upsert({ where: { clave },
          create: { clave, cantidad: 1, expiresAt: window.expiresAt }, update: { cantidad: { increment: 1 } } });
        if (row.cantidad > window.limit) throw new QuotaReached();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof QuotaReached) return false;
    throw error;
  }
}

module.exports = { aiUsageLimits, reserveAiRequest };
