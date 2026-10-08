require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const { HttpError } = require("./lib/http");
const { services } = require("./lib/providers");
const { trustProxy, originGuard, rateLimits } = require("./lib/security");
const app = express();
app.disable("x-powered-by");
let proxySetting = false;
try {
  proxySetting = trustProxy(process.env.TRUST_PROXY);
} catch (error) {
  // Un valor inválido no debe tumbar el servicio; se ignoran las cabeceras.
  console.warn(error.message + " Se ignora TRUST_PROXY.");
}
app.set("trust proxy", proxySetting);
const allowed = (
  process.env.FRONTEND_URL ||
  "https://civigo-rho.vercel.app,http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new HttpError(403, "Origen no permitido."));
    },
    credentials: true,
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (process.env.NODE_ENV === "production")
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  next();
});
app.use(originGuard(allowed));
const limits = rateLimits();
app.use(limits.ip);
app.use("/api/history", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "256kb" }));
app.use(limits.identity);
app.use("/api/history", require("./routes/history"));
app.get("/", (req, res) =>
  res.json({ message: "API CiviGo funcionando", version: "2.0.0" }),
);
app.get("/api/health", (req, res) =>
  res.json({ ok: true, servicios: services() }),
);
app.use("/api/users", require("./routes/users"));
app.use("/api/catalog", require("./routes/catalog"));
app.use("/api/uploads", require("./routes/uploads"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/incidents", require("./routes/incidents"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/navigation", require("./routes/navigation"));
app.use("/api/announcements", require("./routes/announcements"));
app.use("/api", require("./routes/community"));
app.use("/api", require("./routes/participation"));
app.use("/api", require("./routes/operations"));
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message;
  let code = error.code;
  if (error.code === "P2002") {
    status = 409;
    message = "Este dato o aporte ya está registrado.";
    code = "DUPLICATE";
  } else if (error.code === "P2025") {
    status = 404;
    message = "Registro no encontrado.";
  } else if (error.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "El archivo supera 15 MB.";
  } else if (error.name === "MulterError") {
    status = 400;
    message = "Carga de archivos inválida.";
  } else if (error.type === "entity.too.large") {
    status = 413;
    message = "Solicitud demasiado grande.";
  } else if (error instanceof SyntaxError && "body" in error) {
    status = 400;
    message = "JSON inválido.";
  }
  if (status >= 500) {
    message =
      status === 503 && error instanceof HttpError
        ? message
        : "El servicio no pudo completar la solicitud.";
    console.error(
      "Error de API:",
      error.code || error.name,
      "en",
      req.method,
      req.path,
    );
  }
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
});
function start() {
  if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL)
    console.warn(
      "FRONTEND_URL no configurado; se usan los orígenes por defecto.",
    );
  const port = Number(process.env.PORT) || 4000;
  // Railway y otras plataformas solo alcanzan el proceso por la interfaz pública.
  const deployed =
    process.env.NODE_ENV === "production" ||
    !!process.env.RAILWAY_ENVIRONMENT_NAME;
  const host = process.env.API_HOST || (deployed ? "0.0.0.0" : "127.0.0.1");
  const server = app.listen(port, host, () =>
    console.log("API CiviGo escuchando en puerto " + port),
  );
  let timer;
  if (process.env.ENABLE_JOBS !== "false") {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await require("./lib/lifecycle").processLifecycle();
      } catch (e) {
        console.error("Revisión de plazos pendiente:", e.code || e.name);
      } finally {
        running = false;
      }
    };
    timer = setInterval(run, 5 * 60000);
    timer.unref();
    run();
  }
  function shutdown() {
    if (timer) clearInterval(timer);
    server.close(() =>
      require("./lib/db")
        .$disconnect()
        .finally(() => process.exit(0)),
    );
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}
if (require.main === module) start();
module.exports = app;
module.exports.app = app;
module.exports.start = start;
