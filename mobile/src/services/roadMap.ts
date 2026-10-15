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

  const values = new Map<string | number, [string | number, number, number, boolean]>(
    risk.values.map((row) => [row[0], row])
  );

  return {
    type: 'FeatureCollection',
    features: geometry.features.map((feature) => {
      const row = feature.id !== undefined ? values.get(feature.id) : undefined;
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
