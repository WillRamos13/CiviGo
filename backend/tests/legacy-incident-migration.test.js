"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { incidentRisk } = require("../src/lib/risk");

const directory = path.join(__dirname, "../prisma/migrations");
const workflow = "20261001090000_civigo_workflows";
const repair = "20261004120000_restore_legacy_incident_visibility";
const sql = (name) =>
  fs.readFile(path.join(directory, name, "migration.sql"), "utf8");

test("la migración recupera incidentes antiguos sin publicar ni validar reportes modernos", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("SET TIME ZONE 'UTC';");
    const migrations = (await fs.readdir(directory))
      .filter((name) => name < workflow && !name.includes("."))
      .sort();
    for (const name of migrations) await db.exec(await sql(name));
    await db.exec(`
      CREATE TABLE "_prisma_migrations" (
        migration_name TEXT, started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ
      );
      INSERT INTO "User" ("nombreUsuario", "correo", "telefono", "password")
      VALUES ('fixture', 'fixture@example.invalid', '+51900000000', 'unchanged');
      INSERT INTO "Incident" ("tipo", "latitud", "longitud", "nivelRiesgo", "estado", "fechaCreacion")
      SELECT label, -14.067, -75.728, 4, state, CURRENT_TIMESTAMP - INTERVAL '7 days'
      FROM (VALUES
        ('legacy_active', 'ACTIVO'), ('legacy_reviewed', 'ACTIVO'),
        ('legacy_retirement_reason', 'ACTIVO'), ('legacy_resolved', 'RESUELTO'),
        ('legacy_false', 'FALSO'), ('legacy_retired', 'RETIRADO'),
        ('legacy_pending', 'PENDIENTE'), ('legacy_agent', 'ACTIVO')
      ) AS cases(label, state);
      INSERT INTO "Report" ("usuarioId", "tipo", "descripcion", "latitud", "longitud", "incidenteId")
      SELECT 1, 'legacy_active', '', -14.067, -75.728, id FROM "Incident" WHERE tipo = 'legacy_active';
      BEGIN;
      INSERT INTO "_prisma_migrations" (migration_name, started_at)
      VALUES ('${workflow}', CURRENT_TIMESTAMP);
    `);
    await db.exec(await sql(workflow));
    await db.exec(`
      UPDATE "_prisma_migrations" SET finished_at = clock_timestamp();
      COMMIT;
    `);
    await db.exec(await sql("20261001143000_incident_publication"));
    await db.exec(`
      UPDATE "Incident" SET "motivoRetiro" = 'Mantener fuera del mapa' WHERE tipo = 'legacy_retirement_reason';
      UPDATE "Incident" SET "evaluacion" = 'AGENTE' WHERE tipo = 'legacy_agent';
      INSERT INTO "Review" ("usuarioId", "incidenteId", "accion", "motivo", "creadoEn")
      SELECT 1, id, 'REVISION', 'Mantener pendiente', CURRENT_TIMESTAMP FROM "Incident" WHERE tipo = 'legacy_reviewed';
      INSERT INTO "Incident" ("tipo", "latitud", "longitud", "estado")
      VALUES ('modern_active', -14.067, -75.728, 'ACTIVO'), ('modern_pending', -14.067, -75.728, 'PENDIENTE');
      INSERT INTO "Incident" ("tipo", "latitud", "longitud", "estado", "fechaCreacion")
      VALUES ('modern_backdated', -14.067, -75.728, 'ACTIVO', CURRENT_TIMESTAMP - INTERVAL '7 days');
      INSERT INTO "_prisma_migrations" (migration_name, started_at, rolled_back_at)
      VALUES ('${workflow}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      SET TIME ZONE 'America/Lima';
    `);
    const before = (await db.query('SELECT * FROM "Incident" ORDER BY id'))
      .rows;
    assert.ok(before.every((row) => row.publicado === false));
    const correction = await sql(repair);
    await db.exec(correction);
    const after = (await db.query('SELECT * FROM "Incident" ORDER BY id')).rows;
    assert.deepEqual(
      after.filter((row) => row.publicado).map((row) => row.tipo),
      ["legacy_active"],
    );
    for (let index = 0; index < before.length; index++) {
      const previous = before[index];
      const updated = after[index];
      if (previous.tipo === "legacy_active") {
        assert.deepEqual(updated, {
          ...previous,
          publicado: true,
          fechaEvento: previous.fechaCreacion,
          fechaPublicacion: previous.fechaCreacion,
        });
        assert.equal(incidentRisk(updated).pending, true);
        assert.equal(incidentRisk(updated).points, 0);
      } else assert.deepEqual(updated, previous);
    }
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM "AuditLog"')).rows[0]
        .count,
      1,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM "Report"')).rows[0]
        .count,
      1,
    );
    assert.equal(
      (await db.query('SELECT "password", "reputacion" FROM "User"')).rows[0]
        .password,
      "unchanged",
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM "PointEvent"'))
        .rows[0].count,
      0,
    );
    await db.exec(correction);
    assert.deepEqual(
      (await db.query('SELECT * FROM "Incident" ORDER BY id')).rows,
      after,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM "AuditLog"')).rows[0]
        .count,
      1,
    );
    await db.exec(
      'DELETE FROM "_prisma_migrations"; UPDATE "Incident" SET "publicado" = false, "fechaPublicacion" = NULL;',
    );
    await db.exec(correction);
    assert.ok(
      (await db.query('SELECT "publicado" FROM "Incident"')).rows.every(
        (row) => !row.publicado,
      ),
    );
    await db.exec('DROP TABLE "_prisma_migrations";');
    await db.exec(correction);
    assert.ok(
      (await db.query('SELECT "publicado" FROM "Incident"')).rows.every(
        (row) => !row.publicado,
      ),
    );
  } finally {
    await db.close();
  }
});
