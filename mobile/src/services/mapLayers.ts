import type { Map } from 'mapbox-gl';
import type { Incidente } from '../types';

export const INCIDENT_MARKER_MIN_ZOOM = 14;
export const TRAFFIC_SOURCE_ID = 'tomtom-flow';
export const TRAFFIC_LAYER_ID = 'tomtom-flow-layer';

/** Mapbox owns the outer marker transform. Only change visibility on zoom. */
export function bindIncidentMarkerZoom(
  map: Pick<Map, 'getContainer' | 'getZoom' | 'on' | 'off'>,
  onVisibilityChange?: (visible: boolean) => void,
) {
  const container = map.getContainer();
  let previous: boolean | undefined;
  const update = () => {
    const visible = map.getZoom() >= INCIDENT_MARKER_MIN_ZOOM;
    if (visible === previous) return;
    previous = visible;
    container.classList.toggle('incident-markers-visible', visible);
    onVisibilityChange?.(visible);
  };
  update();
  map.on('zoom', update);
  return () => {
    map.off('zoom', update);
    container.classList.remove('incident-markers-visible');
  };
}

export function incidentTypeKey(incident: Pick<Incidente, 'tipo' | 'tipoNombre' | 'tipoSlug'>): string {
  return (incident.tipoSlug || incident.tipoNombre || incident.tipo || 'sin-tipo')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-tipo';
}

export function filterMapIncidents(incidents: Incidente[], type: string): Incidente[] {
  return type ? incidents.filter(incident => incidentTypeKey(incident) === type) : incidents;
}

type TrafficLayerMap = Pick<Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'getStyle' | 'setLayoutProperty'>;

/** URL comes exclusively from trafficTileUrl, which pins it to our HTTPS API. */
export function syncTrafficLayer(map: TrafficLayerMap, enabled: boolean, url: string, bounds?: [number, number, number, number]) {
  if (!enabled) {
    if (map.getLayer(TRAFFIC_LAYER_ID)) map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'none');
    return;
  }
  if (!map.getSource(TRAFFIC_SOURCE_ID)) {
    map.addSource(TRAFFIC_SOURCE_ID, {
      type: 'raster', tiles: [url], tileSize: 256, minzoom: 5, maxzoom: 18,
      ...(bounds ? { bounds } : {}), attribution: '© TomTom',
    });
  } else {
    const source = map.getSource(TRAFFIC_SOURCE_ID) as { tiles?: string[]; setTiles?: (tiles: string[]) => void };
    if (source.tiles?.[0] !== url) source.setTiles?.([url]);
  }
  if (!map.getLayer(TRAFFIC_LAYER_ID)) {
    const firstLabel = map.getStyle()?.layers?.find(layer => layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined)?.id;
    map.addLayer({ id: TRAFFIC_LAYER_ID, type: 'raster', source: TRAFFIC_SOURCE_ID,
      paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }, firstLabel);
  }
  map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'visible');
}
