export type RoadGeometry = GeoJSON.FeatureCollection & { version: string };
export type RoadRisk = { version: string; revision: string; values: [string | number, number, number, boolean][] };
export function applyRoadRisk(geometry: RoadGeometry, risk: RoadRisk): GeoJSON.FeatureCollection {
    if (geometry.version !== risk.version) throw new Error('La red vial cambió. Vuelve a cargar sus datos.');
    const values = new Map(risk.values.map(row => [row[0], row]));
    return { type: 'FeatureCollection', features: geometry.features.map(feature => {
        const row = values.get(feature.id!);
        return row ? { ...feature, properties: { ...feature.properties, puntos: row[1], nivelRiesgo: row[2], pendiente: row[3] } } : feature;
    }) };
}
