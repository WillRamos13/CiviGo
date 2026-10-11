"use strict";
const { nearestRiskSegment, projectToLine, distanceMeters } = require("./risk");
const { heading } = require("./navigation-steps");

// These are temporary routing exclusions, never CiviGo incidents or risk points.
// Only a complete road closure with matching line geometry can close a road.
// A point, lane closure or congestion cannot identify an impassable street.
function closureExclusions(events, roads, now = new Date()) {
  const pointsBySegment = new Map(),
    applied = new Set();
  let unmapped = 0,
    samples = 0;
  for (const event of events) {
    if (
      event.fuente !== "TOMTOM" ||
      event.tipo !== "calle-bloqueada" ||
      event.temporal !== true ||
      (event.inicio && new Date(event.inicio) > now) ||
      (event.fin && new Date(event.fin) <= now)
    )
      continue;
    const coordinates =
      event.geometria?.type === "LineString" ? event.geometria.coordinates : [];
    let matched = false;
    for (let i = 1; i < coordinates.length && samples < 10000; i++) {
      const a = coordinates[i - 1],
        b = coordinates[i];
      const length = distanceMeters(a, b);
      if (length < 1) continue;
      const count = Math.min(500, Math.max(2, Math.ceil(length / 15)));
      for (let j = 0; j < count && samples < 10000; j++) {
        samples++;
        const fraction = (j + 0.5) / count;
        const point = [
          a[0] + (b[0] - a[0]) * fraction,
          a[1] + (b[1] - a[1]) * fraction,
        ];
        const match = nearestRiskSegment(point, roads.segments);
        if (!match || match.projection.distance > 12) continue;
        const line = match.segment.coordinates,
          index = match.projection.index;
        const difference = Math.abs(
          ((heading(a, b) - heading(line[index - 1], line[index]) + 540) %
            360) -
            180,
        );
        // Avoid closing an intersecting street from a crossing or endpoint.
        if (difference > 30 && difference < 150) continue;
        if (
          distanceMeters(match.projection.coordinates, line[0]) < 2 ||
          distanceMeters(match.projection.coordinates, line.at(-1)) < 2
        )
          continue;
        const id = String(match.segment.id);
        if (!pointsBySegment.has(id)) pointsBySegment.set(id, []);
        pointsBySegment.get(id).push(match.projection.coordinates);
        matched = true;
      }
    }
    if (matched) applied.add(event.id);
    else unmapped++;
  }
  return {
    applied: applied.size,
    unmapped,
    blocks(segment, coordinates) {
      // GeoJSON vertex order alone is not an authoritative direction restriction.
      // Conservatively exclude the matched closed portion in both directions.
      return (pointsBySegment.get(String(segment.id)) || []).some(
        (point) => projectToLine(point, coordinates)?.distance < 1,
      );
    },
  };
}

module.exports = { closureExclusions };
