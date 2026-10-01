"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { csvRows, prepareImport } = require("../src/lib/history-import");
const types = [
  {
    id: 1,
    slug: "robo",
    nombre: "Robo",
    historico: true,
    individual: true,
    activo: true,
  },
  {
    id: 2,
    slug: "incendio",
    nombre: "Incendio",
    historico: false,
    activo: true,
  },
];
const record = {
  tipo: "robo",
  fechaEvento: "2025-10-01",
  latitud: -14.0678,
  longitud: -75.7286,
  nivelRiesgo: 4,
  descripcion: "",
};
test("El CSV admite campos entre comillas, comas, saltos de línea y separador punto y coma", () => {
  const rows = csvRows(
    'tipo;fechaEvento;descripcion\nrobo;2025-10-01;"Texto; con coma, y\nsegunda línea"',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].descripcion, "Texto; con coma, y\nsegunda línea");
});
test("La vista previa separa datos históricos válidos de tipos, ubicaciones y fechas inválidas", () => {
  const result = prepareImport(
    {
      formato: "json",
      fuente: "Prueba automatizada",
      contenido: JSON.stringify([
        record,
        { ...record, tipo: "incendio" },
        { ...record, latitud: 0 },
        { ...record, fechaEvento: "2025-02-31" },
      ]),
    },
    types,
    new Date("2026-10-01"),
  );
  assert.equal(result.totalValidos, 1);
  assert.equal(result.errores.length, 3);
  assert.equal(result.registros[0].distrito, "Ica");
});
test("La clave de importación es estable y rechaza duplicados dentro del archivo", () => {
  const body = {
    formato: "json",
    fuente: "Fuente",
    contenido: JSON.stringify([record, record]),
  };
  const result = prepareImport(body, types);
  assert.equal(result.totalValidos, 1);
  assert.equal(result.errores.length, 1);
  assert.equal(
    result.registros[0].clave,
    prepareImport({ ...body, contenido: JSON.stringify([record]) }, types)
      .registros[0].clave,
  );
});
test("Una hora de Lima próxima a medianoche conserva el instante aunque el día UTC sea el siguiente", () => {
  const result = prepareImport(
    {
      formato: "json",
      fuente: "Ensayo",
      contenido: JSON.stringify([
        { ...record, fechaEvento: "2025-10-01T23:30:00-05:00" },
      ]),
    },
    types,
  );
  assert.equal(result.totalValidos, 1);
  assert.equal(result.registros[0].fechaEvento, "2025-10-02T04:30:00.000Z");
});

test("Fechas locales sin zona se interpretan en Lima independientemente de la zona del servidor", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Pacific/Auckland", "America/Lima"]) {
      process.env.TZ = timezone;
      const result = prepareImport(
        {
          formato: "json",
          fuente: "Ensayo",
          contenido: JSON.stringify([
            { ...record, fechaEvento: "2025-10-01T23:30:00" },
          ]),
        },
        types,
      );
      assert.equal(result.totalValidos, 1);
      assert.equal(result.registros[0].fechaEvento, "2025-10-02T04:30:00.000Z");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  const invalid = prepareImport(
    {
      formato: "json",
      fuente: "Ensayo",
      contenido: JSON.stringify([
        { ...record, fechaEvento: "2025-10-01T24:00:00" },
      ]),
    },
    types,
  );
  assert.equal(invalid.totalValidos, 0);
});

test("La importación rechaza tipos JSON incorrectos y referencias que se truncarían", () => {
  const rows = [
    { ...record, latitud: [record.latitud] },
    { ...record, nivelRiesgo: true },
    { ...record, tipo: ["robo"] },
    { ...record, descripcion: {} },
    { ...record, referencia: "x".repeat(201) },
    { ...record, referencia: {} },
    { ...record, _fila: { inesperado: true }, referencia: 0 },
  ];
  const result = prepareImport(
    { formato: "json", fuente: "Ensayo", contenido: JSON.stringify(rows) },
    types,
  );
  assert.equal(result.errores.length, 6);
  assert.equal(result.totalValidos, 1);
  assert.equal(result.registros[0].fila, 7);
  assert.equal(result.registros[0].referencia, "0");
});
