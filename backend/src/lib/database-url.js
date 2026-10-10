"use strict";

function configurationError(message) {
  const error = new Error(message);
  error.code = "DATABASE_CONFIG";
  return error;
}

function parseConnection(value, variable) {
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname)
      throw new Error();
    return url;
  } catch {
    // Never include a supplied URL: it contains database credentials.
    throw configurationError(
      `${variable} debe ser una conexión PostgreSQL válida.`,
    );
  }
}

function transactionPooler(url) {
  const host = url.hostname.toLowerCase();
  return (
    url.port === "6543" &&
    (host.endsWith(".pooler.supabase.com") ||
      /^db\.[a-z0-9-]+\.supabase\.co$/.test(host))
  );
}

function runtimeDatabaseUrl(value = process.env.DATABASE_URL) {
  if (value === undefined || value === "") return undefined;
  const url = parseConnection(value, "DATABASE_URL");
  const limits = url.searchParams.getAll("connection_limit");
  if (!limits.length) url.searchParams.set("connection_limit", "2");
  else if (
    limits.length !== 1 ||
    !/^[1-9]\d*$/.test(limits[0]) ||
    !Number.isSafeInteger(Number(limits[0]))
  )
    throw configurationError(
      "connection_limit debe ser un entero positivo, sin duplicados.",
    );
  if (transactionPooler(url)) url.searchParams.set("pgbouncer", "true");
  return url.href;
}

function migrationDatabaseUrl(env = process.env) {
  const direct = env.DIRECT_URL?.trim();
  const value = direct || env.DATABASE_URL?.trim();
  if (!value) return undefined;
  const url = parseConnection(value, direct ? "DIRECT_URL" : "DATABASE_URL");
  if (transactionPooler(url))
    throw configurationError(
      "Las migraciones requieren DIRECT_URL con Direct connection o Session pooler (5432). El Transaction pooler (6543) se reserva para DATABASE_URL del backend.",
    );
  url.searchParams.set("connection_limit", "1");
  return url.href;
}

function cliDatabaseUrl(env, command) {
  // Generate/validate/format do not need a live connection. In particular,
  // Railway must be able to build before DIRECT_URL is configured for deploy.
  return ["migrate", "db", "studio", "introspect"].includes(command)
    ? migrationDatabaseUrl(env)
    : undefined;
}

module.exports = { runtimeDatabaseUrl, migrationDatabaseUrl, cliDatabaseUrl };
