"use strict";
const { distanceMeters } = require("./risk");
const MAX_RISK_SEGMENT_METERS = 150;
const VIRTUAL_RISK_NODE_PREFIX = "civigo-risk-node:";

/** Subdivide edges without joining crossing roads or replacing real OSM nodes. */
function subdivideRoads(segments, maxLength = MAX_RISK_SEGMENT_METERS) {
  if (!Number.isFinite(maxLength) || maxLength < 10)
    throw new Error("Longitud de tramo inválida.");
  return segments.flatMap((segment) => {
    const coordinates = segment.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const pieces = [];
    let current = [coordinates[0].slice()],
      length = 0,
      offset = 0;
    for (let index = 1; index < coordinates.length; index++) {
      const end = coordinates[index];
      let start = coordinates[index - 1];
      let remaining = distanceMeters(start, end);
      while (remaining > 1e-7 && length + remaining > maxLength + 1e-7) {
        const available = maxLength - length;
        const fraction = available / remaining;
        const cut = [
          start[0] + (end[0] - start[0]) * fraction,
          start[1] + (end[1] - start[1]) * fraction,
        ];
        current.push(cut);
        pieces.push({
          coordinates: current,
          length: maxLength,
          startOffset: offset,
          endOffset: offset + maxLength,
        });
        offset += maxLength;
        current = [cut.slice()];
        length = 0;
        start = cut;
        remaining = distanceMeters(start, end);
      }
      current.push(end.slice());
      length += remaining;
    }
    if (length > 1e-7)
      pieces.push({
        coordinates: current,
        length,
        startOffset: offset,
        endOffset: offset + length,
      });
    return pieces.map((piece, index) => ({
      ...segment,
      ...piece,
      id: pieces.length === 1 ? segment.id : `${segment.id}:risk:${index}`,
      parentEdgeId: segment.parentEdgeId ?? segment.id,
      osmId: segment.osmId ?? segment.id,
      start:
        index === 0
          ? segment.start
          : `${VIRTUAL_RISK_NODE_PREFIX}${segment.id}:${index}`,
      end:
        index === pieces.length - 1
          ? segment.end
          : `${VIRTUAL_RISK_NODE_PREFIX}${segment.id}:${index + 1}`,
    }));
  });
}
module.exports = {
  subdivideRoads,
  MAX_RISK_SEGMENT_METERS,
  VIRTUAL_RISK_NODE_PREFIX,
};
