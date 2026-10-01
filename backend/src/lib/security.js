const net = require("node:net");
const crypto = require("node:crypto");
const { HttpError, asyncRoute } = require("./http");
const { loadUser } = require("./auth");

function trustProxy(value) {
  if (!value || value === "false") return false;
  const entries = String(value)
    .split(",")
    .map((part) => part.trim());
  for (const entry of entries) {
    if (["loopback", "linklocal", "uniquelocal"].includes(entry)) continue;
    const [address, prefix, ...extra] = entry.split("/");
    const version = net.isIP(address);
    if (
      !version ||
      extra.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))
    )
      throw new Error(
        "TRUST_PROXY debe contener IP/CIDR explícitos o nombres de redes reconocidos; no true ni número de saltos.",
      );
  }
  return entries;
}

function originGuard(allowed) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    let refererOrigin;
    if (req.headers.referer) {
      try {
        refererOrigin = new URL(req.headers.referer).origin;
      } catch {
        return next(new HttpError(403, "Origen de solicitud inválido."));
      }
    }
    if (
      (origin && !allowed.includes(origin)) ||
      (!origin && refererOrigin && !allowed.includes(refererOrigin)) ||
      (!origin && req.headers["sec-fetch-site"] === "cross-site")
    )
      return next(
        new HttpError(
          403,
          "Origen de solicitud no permitido.",
          "ORIGIN_DENIED",
        ),
      );
    next();
  };
}

function counter({
  now = Date.now,
  windowMs = 60000,
  maxBuckets = 10000,
} = {}) {
  const buckets = new Map();
  return (key, limit, res) => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || time - bucket.start >= windowMs) {
      if (buckets.size >= maxBuckets) {
        for (const [k, value] of buckets)
          if (time - value.start >= windowMs) buckets.delete(k);
        if (buckets.size >= maxBuckets)
          buckets.delete(buckets.keys().next().value);
      }
      bucket = { start: time, count: 0 };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.start + windowMs - time) / 1000))),
      );
      throw new HttpError(
        429,
        "Demasiadas solicitudes. Inténtalo en un minuto.",
        "RATE_LIMITED",
      );
    }
  };
}

function rateLimits(options = {}) {
  const count = counter(options);
  const ip = (req, res, next) => {
    try {
      count("ip:" + req.ip, options.ipLimit ?? 2400, res);
      if (
        /^\/api\/users\/(login|register|phone\/(request|verify)|email\/(request|verify))\/?$/.test(
          req.path,
        )
      )
        count("auth-ip:" + req.ip, options.authIpLimit ?? 200, res);
      next();
    } catch (error) {
      next(error);
    }
  };
  const identity = asyncRoute(async (req, res, next) => {
    if (["/", "/api/health", "/api/ready"].includes(req.path)) return next();
    const route = req.path
      .replace(/\/\d+(?=\/|$)/g, "/:id")
      .replace(/\/[a-f0-9-]{36}(?=\/|$)/gi, "/:id");
    if (/^\/api\/users\/login\/?$/.test(req.path)) {
      if (typeof req.body?.correo === "string") {
        const emailHash = crypto
          .createHash("sha256")
          .update(req.body.correo.trim().toLowerCase())
          .digest("hex");
        count("login-account:" + emailHash, options.loginLimit ?? 20, res);
      }
      // La cuota por cuenta y la cuota de autenticación por IP ya protegen
      // el login; una sesión previa no cambia la identidad que se autentica.
      return next();
    }
    const user = await (options.loadUser || loadUser)(req);
    // Solo identidades verificadas por la sesión separan a clientes detrás
    // de Next; cookies aleatorias y headers XFF no conceden otra cuota.
    const key = user ? "user:" + user.id : "anonymous:" + req.ip;
    const sensitive = /^\/api\/users\/(phone|email)\/(request|verify)\/?$/.test(
      req.path,
    );
    count(
      key + ":" + req.method + ":" + route,
      sensitive
        ? (options.identityAuthLimit ?? 20)
        : user
          ? (options.userLimit ?? 180)
          : (options.anonymousLimit ?? 600),
      res,
    );
    next();
  });
  return { ip, identity };
}
module.exports = { trustProxy, originGuard, rateLimits, counter };
