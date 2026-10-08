"use strict";
const { distanceMeters } = require("./risk");

function heading(a, b) {
  const rad = Math.PI / 180,
    aLat = a[1] * rad,
    bLat = b[1] * rad;
  const delta = (b[0] - a[0]) * rad;
  return (
    (Math.atan2(
      Math.sin(delta) * Math.cos(bLat),
      Math.cos(aLat) * Math.sin(bLat) -
        Math.sin(aLat) * Math.cos(bLat) * Math.cos(delta),
    ) /
      rad +
      360) %
    360
  );
}
function maneuver(previous, edge) {
  if (!previous) return "salida";
  if (
    edge.segment.tags.junction === "roundabout" &&
    previous.segment.tags.junction !== "roundabout"
  )
    return "rotonda";
  const before = previous.coordinates,
    after = edge.coordinates;
  const angle =
    ((heading(after[0], after[1]) -
      heading(before.at(-2), before.at(-1)) +
      540) %
      360) -
    180;
  if (Math.abs(angle) > 150) return "retorno";
  if (angle > 30) return "derecha";
  if (angle < -30) return "izquierda";
  return "recto";
}
function instruction(type, street, previous, edge) {
  const suffix = street ? ` por ${street}` : " por la vía";
  if (
    previous?.segment.tags.junction === "roundabout" &&
    edge.segment.tags.junction !== "roundabout"
  )
    return `Sal de la rotonda y continúa${suffix}.`;
  return {
    salida: `Inicia el recorrido${suffix}.`,
    recto: `Continúa${suffix}.`,
    izquierda: `Gira a la izquierda${suffix}.`,
    derecha: `Gira a la derecha${suffix}.`,
    retorno: `Realiza un cambio de sentido${suffix}.`,
    rotonda: "Entra en la rotonda y sigue el recorrido indicado.",
  }[type];
}
function stepsFromEdges(edges, mode, edgeSeconds) {
  const steps = [],
    coordinates = [];
  let distance = 0,
    duration = 0,
    previousEdge = null;
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    if (edge.length < 0.01) continue;
    const start = Math.max(0, coordinates.length - 1);
    for (const coordinate of edge.coordinates) {
      if (
        !coordinates.length ||
        distanceMeters(coordinates.at(-1), coordinate) > 0.01
      )
        coordinates.push(coordinate);
    }
    const type = maneuver(previousEdge, edge);
    const street = String(
      edge.segment.nombre || edge.segment.tags.name || "",
    ).slice(0, 150);
    const seconds = edgeSeconds(edge, mode);
    const previous = steps.at(-1);
    if (
      type === "recto" &&
      previous &&
      previous.calle === street &&
      edge.segment.tags.junction !== "roundabout" &&
      previousEdge?.segment.tags.junction !== "roundabout"
    ) {
      previous.distancia += edge.length;
      previous.duracion += seconds;
      previous.indiceFin = coordinates.length - 1;
      previous.geometria.coordinates = coordinates.slice(previous.indiceInicio);
    } else {
      steps.push({
        id: `paso-${steps.length}`,
        tipo: type,
        maniobra: type,
        instruccion: instruction(type, street, previousEdge, edge),
        calle: street,
        distancia: edge.length,
        duracion: seconds,
        distanciaAcumulada: distance,
        duracionAcumulada: duration,
        coordenadas: edge.coordinates[0],
        indiceInicio: start,
        indiceFin: coordinates.length - 1,
        geometria: {
          type: "LineString",
          coordinates: coordinates.slice(start),
        },
        fuente: "OpenStreetMap",
      });
    }
    distance += edge.length;
    duration += seconds;
    previousEdge = edge;
  }
  const last = coordinates.at(-1);
  if (last)
    steps.push({
      id: `paso-${steps.length}`,
      tipo: "llegada",
      maniobra: "llegada",
      instruccion:
        "Llegaste al final del recorrido por la vía. Comprueba el acceso al destino.",
      calle: "",
      distancia: 0,
      duracion: 0,
      distanciaAcumulada: distance,
      duracionAcumulada: duration,
      coordenadas: last,
      indiceInicio: coordinates.length - 1,
      indiceFin: coordinates.length - 1,
      geometria: { type: "LineString", coordinates: [last, last] },
      fuente: "OpenStreetMap",
    });
  return steps;
}
function updateStepDurations(
  route,
  duration,
  progressPoints,
  providerDistance,
) {
  const factor = route.duracion > 0 ? duration / route.duracion : 1;
  const points = Array.isArray(progressPoints)
    ? progressPoints.map((point) => ({
        distance: Number(point.distanceInMeters),
        time: Number(point.travelDurationInSeconds),
      }))
    : [];
  const valid =
    points.length >= 2 &&
    points.length <= 10000 &&
    Number.isFinite(providerDistance) &&
    providerDistance > 0 &&
    points.every(
      (point, index) =>
        Number.isFinite(point.distance) &&
        Number.isFinite(point.time) &&
        point.distance >= 0 &&
        point.distance <= providerDistance &&
        point.time >= 0 &&
        point.time <= duration &&
        (!index ||
          (point.distance >= points[index - 1].distance &&
            point.time >= points[index - 1].time)),
    );
  const timeline = valid
    ? [
        { distance: 0, time: 0 },
        ...points.filter(
          (point) => point.distance > 0 && point.distance < providerDistance,
        ),
        { distance: providerDistance, time: duration },
      ]
    : null;
  const timeAt = (distance) => {
    const target = Math.min(
      providerDistance,
      Math.max(0, (distance / route.distancia) * providerDistance),
    );
    for (let index = 1; index < timeline.length; index++) {
      if (timeline[index].distance < target) continue;
      const before = timeline[index - 1],
        after = timeline[index];
      const fraction =
        after.distance > before.distance
          ? (target - before.distance) / (after.distance - before.distance)
          : 1;
      return before.time + (after.time - before.time) * fraction;
    }
    return duration;
  };
  return route.pasos.map((step) => ({
    ...step,
    duracion: timeline
      ? timeAt(step.distanciaAcumulada + step.distancia) -
        timeAt(step.distanciaAcumulada)
      : step.duracion * factor,
    duracionAcumulada: timeline
      ? timeAt(step.distanciaAcumulada)
      : step.duracionAcumulada * factor,
  }));
}
module.exports = { heading, maneuver, stepsFromEdges, updateStepDurations };
