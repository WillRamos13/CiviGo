const { serializable } = require("./upload-quota");

// One reservation per image sent to Web Detection. Counters share the database
// across replicas and count attempts even if the external provider later fails.
function imageWebUsageLimits(env = process.env) {
  const value = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1000000
      ? parsed
      : 0;
  };
  return {
    daily: value("IMAGE_WEB_DAILY_LIMIT", 100),
    monthly: value("IMAGE_WEB_MONTHLY_LIMIT", 1000),
  };
}

class QuotaReached extends Error {}

async function reserveImageWebRequest(
  db,
  now = new Date(),
  limits = imageWebUsageLimits(),
) {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(+now) ||
    ![limits.daily, limits.monthly].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000,
    )
  )
    throw new TypeError("Invalid image web quota");
  if (!limits.daily || !limits.monthly) return false;
  const date = now.toISOString();
  const windows = [
    {
      name: "month",
      period: date.slice(0, 7),
      limit: limits.monthly,
      expiresAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 3),
      ),
    },
    {
      name: "day",
      period: date.slice(0, 10),
      limit: limits.daily,
      expiresAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3),
      ),
    },
  ];
  try {
    await serializable(db, async (tx) => {
      for (const window of windows) {
        const clave = `vision:web:${window.name}:${window.period}`;
        const row = await tx.usageCounter.upsert({
          where: { clave },
          create: { clave, cantidad: 1, expiresAt: window.expiresAt },
          update: { cantidad: { increment: 1 } },
        });
        if (row.cantidad > window.limit) throw new QuotaReached();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof QuotaReached) return false;
    throw error;
  }
}

module.exports = { imageWebUsageLimits, reserveImageWebRequest };
