export interface RoadFeatureProperties {
  id: string | number;
  nombre?: string;
  puntos: number;
  nivelRiesgo: number;
  pendiente: boolean;
}

export type RoadGeometry = GeoJSON.FeatureCollection<GeoJSON.LineString, RoadFeatureProperties> & {
  version: string;
};

export interface RoadRisk {
  version: string;
  revision: string;
  values: [string | number, number, number, boolean][];
  actualizadoEn?: string;
}

export function applyRoadRisk(geometry: RoadGeometry, risk: RoadRisk): GeoJSON.FeatureCollection {
  if (geometry.version !== risk.version) {
    throw new Error('La red vial cambió. Vuelve a cargar sus datos.');
  }

  if (geometry.type !== 'FeatureCollection' || typeof risk.revision !== 'string' || !risk.revision ||
    !Array.isArray(geometry.features) || !geometry.features.every((feature) => feature?.type === 'Feature' &&
      feature.geometry?.type === 'LineString' && Array.isArray(feature.geometry.coordinates) &&
      feature.geometry.coordinates.length >= 2 && feature.geometry.coordinates.every((point) =>
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) ||
    !Array.isArray(risk.values) ||
    !risk.values.every((row) => Array.isArray(row) && row.length === 4 &&
      (typeof row[0] === 'string' || (typeof row[0] === 'number' && Number.isFinite(row[0]))) &&
      Number.isFinite(row[1]) && row[1] >= 0 && Number.isInteger(row[2]) &&
      row[2] >= 0 && row[2] <= 5 && typeof row[3] === 'boolean')) {
    throw new Error('Los datos de riesgo vial están incompletos. Se conserva la última capa.');
  }

  const values = new Map<string | number, [string | number, number, number, boolean]>(
    risk.values.map((row) => [row[0], row])
  );

  return {
    type: 'FeatureCollection',
    features: geometry.features.map((feature) => {
      const id = feature.id ?? feature.properties?.id;
      const row = id !== undefined ? values.get(id) : undefined;
      return row
        ? {
            ...feature,
            properties: {
              ...feature.properties,
              puntos: row[1],
              nivelRiesgo: row[2],
              pendiente: row[3],
            },
          }
        : feature;
    }),
  };
}
