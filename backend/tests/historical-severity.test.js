"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { assessHistoricalSeverity } = require("../src/lib/historical-severity");
const description = (modality, address = "Ica") =>
  `Registro histórico de denuncia en SIDPOL. Modalidad publicada: ${modality}. Distrito del hecho según la fuente: ICA. Referencia de ubicación publicada: ${address}.`;
test("La gravedad distingue modalidad simple, agravada y arma expresamente publicada", () => {
  for (const [name, level] of [
    ["HURTO", 2],
    ["HURTO AGRAVADO", 3],
    ["ROBO", 3],
    ["ROBO AGRAVADO", 4],
    ["ROBO AGRAVADO A MANO ARMADA", 5],
    ["EXTORSIÓN", 4],
    ["CHANTAJE", 3],
    ["PERSONA DESAPARECIDA", 4],
    ["MENOR DESAPARECIDO", 5],
  ]) {
    const result = assessHistoricalSeverity(description(name));
    assert.equal(result.nivel, level);
    assert.equal(result.revisionHumana, false);
    assert.equal(result.metodo, "MODALIDAD_HISTORICA_V1");
    assert.ok(result.criterio);
  }
});
test("Una dirección o texto fuera de la modalidad no inventa armas, violencia ni gravedad", () => {
  assert.equal(
    assessHistoricalSeverity(
      description("HURTO", "Plaza de Armas; sin arma, sin lesiones"),
    ).nivel,
    2,
  );
  assert.equal(
    assessHistoricalSeverity(description("EXTORSION AGRAVADA")).nivel,
    4,
  );
});
test("No se improvisa un nivel para modalidades ausentes o desconocidas", () => {
  for (const text of [
    null,
    "Robo sin descripción",
    description("ROBO SIN ARMA"),
    description("OTRO"),
  ])
    assert.throws(() => assessHistoricalSeverity(text));
});
