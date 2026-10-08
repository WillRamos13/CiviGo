const { lengthOf } = require("../../src/lib/roads");
const points = {
  a: [-75.729, -14.067],
  b: [-75.727, -14.067],
  c: [-75.727, -14.066],
  d: [-75.729, -14.066],
};
function segment(id, start, end, tags = {}) {
  const coordinates = [points[start], points[end]];
  return {
    id,
    start,
    end,
    coordinates,
    length: lengthOf(coordinates),
    tags: { highway: "residential", ...tags },
    nombre: id,
  };
}
const roads = {
  segments: [
    segment("ab", "a", "b"),
    segment("bc", "b", "c"),
    segment("cd", "c", "d"),
    segment("da", "d", "a"),
  ],
  boundary: {
    outer: [
      [
        [-75.74, -14.08],
        [-75.71, -14.08],
        [-75.71, -14.05],
        [-75.74, -14.05],
        [-75.74, -14.08],
      ],
    ],
    inner: [],
  },
  atribucion: "Test",
  actualizadoEn: "2026-10-08",
};
const input = {
  origen: { latitud: -14.067, longitud: -75.7289 },
  destino: { latitud: -14.067, longitud: -75.7271 },
  modo: "driving",
};
const incident = {
  id: 1,
  tipo: "accidente",
  latitud: -14.067,
  longitud: -75.728,
  nivelRiesgo: 5,
  validacion: 1,
  estado: "ACTIVO",
  evaluacion: "AGENTE",
  fechaEvento: "2026-10-08T10:00:00Z",
};
module.exports = { roads, input, incident, points, segment };
