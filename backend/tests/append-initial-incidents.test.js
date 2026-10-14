"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAppendScope,
  appendInitialIncidentBatch,
} = require("../src/lib/append-initial-incidents");

function fixture() {
  const type = {
    id: 1,
    nombre: "Bache",
    slug: "bache",
    activo: true,
    individual: false,
    historico: false,
    emergencia: false,
    persistente: true,
  };
  const userIds = [11, 12, 13, 14, 15];
  const center = { latitud: -14.0721246, longitud: -75.7359964 };
  const now = new Date("2026-10-13T18:00:00Z");
  const dataset = {
    entries: Array.from({ length: 50 }, (_, index) => {
      const coordinates = {
        latitud: center.latitud + 0.00001 + index * 0.00003,
        longitud: center.longitud,
      };
      const description = `Desnivel en la calzada del tramo adicional ${index + 1}, que dificulta el paso de vehículos.`;
      return {
        incident: {
          tipo: type.nombre,
          tipoId: type.id,
          descripcion: description,
          ...coordinates,
          distrito: "Ica",
          nivelRiesgo: 2,
          estado: "VALIDADO",
          totalReportes: 1,
          validacion: 1,
          publicado: true,
          evaluacion: "AGENTE",
          individual: false,
          historico: false,
          emergencia: false,
          persistente: true,
          fuente: "CARGA_INICIAL",
          fechaEvento: now,
          fechaPublicacion: now,
        },
        report: {
          usuarioId: userIds[index % 5],
          tipo: type.nombre,
          tipoId: type.id,
          descripcion: description,
          ...coordinates,
          nivelRiesgo: 2,
          estado: "VALIDADO",
          confirmaciones: 0,
          fechaEvento: now,
        },
        review: {
          usuarioId: 11,
          accion: "CARGA_INICIAL",
          motivo: "Carga ilustrativa sin pruebas ni IA.",
          datos: { synthetic: true },
        },
        provenance: { synthetic: true },
      };
    }),
  };
  const roads = {
    boundary: {
      outer: [
        [
          [-75.76, -14.1],
          [-75.7, -14.1],
          [-75.7, -14.04],
          [-75.76, -14.04],
          [-75.76, -14.1],
        ],
      ],
      inner: [],
    },
  };
  return {
    types: [type],
    userIds,
    reviewerId: 11,
    center,
    roads,
    radiusMeters: 3000,
    expectedExistingCount: 500,
    dataset,
  };
}

test("append preparation keeps 50 catalog pairs within 3 km and rejects relaxed scopes, foreign authors and forged data", () => {
  validateAppendScope(fixture());
  for (const modify of [
    (args) => {
      args.radiusMeters = 3001;
    },
    (args) => {
      args.userIds[0] = 12;
    },
    (args) => {
      args.reviewerId = 99;
    },
    (args) => {
      args.dataset.entries.pop();
    },
    (args) => {
      args.dataset.entries[0].incident.latitud = -15;
      args.dataset.entries[0].report.latitud = -15;
    },
    (args) => {
      args.dataset.entries[0].review.usuarioId = 12;
    },
    (args) => {
      args.dataset.entries[0].report.usuarioId = 99;
    },
    (args) => {
      args.dataset.entries[0].incident.fuente = "CIUDADANO";
    },
    (args) => {
      args.dataset.entries[0].review.datos.synthetic = false;
    },
  ]) {
    const args = fixture();
    modify(args);
    assert.throws(() => validateAppendScope(args));
  }
});

test("append needs explicit database fingerprint before reading or writing any rows", async () => {
  let called = false;
  const database = {
    incidentType: {
      findMany: async () => {
        called = true;
      },
    },
  };
  await assert.rejects(
    appendInitialIncidentBatch({
      database,
      connection: "postgresql://local:local@127.0.0.1:5432/isolated",
      confirmTarget: "wrong",
      ...fixture(),
    }),
    { code: "APPEND_CONFIRM" },
  );
  assert.equal(called, false);
});

module.exports = { appendFixture: fixture };
