import type { Map, GeoJSONSource, HeatmapLayerSpecification } from 'mapbox-gl';
import type { Incidente, Ruta } from './types';
import { RISK_COLORS } from './types';

export const EMPTY_MAP_DATA: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
// Keep the same cartography in both themes; the theme changes the surrounding UI.
export const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';
export const INCIDENT_MARKER_MIN_ZOOM = 14;

// A container rule also applies to markers added by polling while zoomed out.
// It hides only incident buttons, preserving the user's location marker.
export function bindIncidentMarkerZoom(map: Pick<Map, 'getContainer' | 'getZoom' | 'on' | 'off'>) {
    const container = map.getContainer();
    let previous: boolean | undefined;
    const update = () => {
        const visible = map.getZoom() >= INCIDENT_MARKER_MIN_ZOOM;
        if (visible === previous) return;
        previous = visible;
        container.classList.toggle('incident-markers-visible', visible);
    };
    update();
    map.on('zoom', update);
    return () => {
        map.off('zoom', update);
        container.classList.remove('incident-markers-visible');
    };
}

// These are screen-space visual zones, separate from the street risk model
// and the 50 m rules for reporting and confirmation.
export const INCIDENT_AREA_PAINT: NonNullable<HeatmapLayerSpecification['paint']> = {
    'heatmap-weight': 1,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, .35, 9, .55, 12, .8, 15, 1, 18, 1.3, 22, 1.5],
    // Shrink screen-space kernels as the camera moves away. Nearby incidents
    // still merge because their projected distance shrinks faster than this radius.
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 3, 10, 6, 12, 12, 14, 24, 16, 40, 18, 50, 22, 64],
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, .78, 12, .66, 15, .5, 18, .32, 22, .25],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(250,204,21,0)', .08, 'rgba(250,204,21,0.65)',
        .2, '#facc15', .4, '#f97316', .65, '#ef4444', 1, '#dc2626'],
};

export function incidentAreaPoints(incidents: readonly Incidente[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    const seen = new Set<number>();
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const incident of incidents) {
        if (seen.has(incident.id) || !Number.isFinite(incident.latitud) || !Number.isFinite(incident.longitud)
            || Math.abs(incident.latitud) > 90 || Math.abs(incident.longitud) > 180) continue;
        seen.add(incident.id);
        features.push({ type: 'Feature', id: incident.id, properties: {},
            geometry: { type: 'Point', coordinates: [incident.longitud, incident.latitud] } });
    }
    return { type: 'FeatureCollection', features };
}

export type MapLayerState = {
    roads: GeoJSON.FeatureCollection;
    incidents: readonly Incidente[];
    route: Ruta | null;
    risk: boolean;
    events: boolean;
    zones: boolean;
    editor: boolean;
    brand: string;
    routeOutline: string;
};

type LayerMap = Pick<Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'getStyle' | 'setLayoutProperty' | 'setPaintProperty'>;

export function syncMapLayers(map: LayerMap, state: MapLayerState) {
    const source = (id: string, data: GeoJSON.GeoJSON) => {
        const current = map.getSource(id) as GeoJSONSource | undefined;
        if (current) current.setData(data);
        else map.addSource(id, { type: 'geojson', data });
    };
    source('civigo-incidents', state.editor ? EMPTY_MAP_DATA : incidentAreaPoints(state.incidents));
    source('civigo-roads', state.roads);
    source('civigo-route', state.route ? { type: 'Feature', geometry: state.route.geometria, properties: {} } : EMPTY_MAP_DATA);
    const firstTextLabel = map.getStyle()?.layers?.find(layer => layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined)?.id;
    if (!map.getLayer('civigo-incident-areas')) map.addLayer({
        id: 'civigo-incident-areas', type: 'heatmap', source: 'civigo-incidents', paint: INCIDENT_AREA_PAINT,
    }, firstTextLabel);
    if (!map.getLayer('civigo-roads-layer')) map.addLayer({
        id: 'civigo-roads-layer', type: 'line', source: 'civigo-roads', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['case', ['all', ['==', ['get', 'pendiente'], true], ['==', ['get', 'puntos'], 0]], '#64748b',
                ['match', ['get', 'nivelRiesgo'], 0, RISK_COLORS[0], 1, RISK_COLORS[1], 2, RISK_COLORS[2], 3, RISK_COLORS[3], 4, RISK_COLORS[4], 5, RISK_COLORS[5], '#94a3b8']],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, .8, 13, 1.6, 16, 2.6, 19, 4], 'line-opacity': .7,
        },
    }, firstTextLabel);
    if (!map.getLayer('civigo-route-outline')) map.addLayer({
        id: 'civigo-route-outline', type: 'line', source: 'civigo-route', paint: { 'line-color': state.routeOutline, 'line-width': 9 },
    });
    if (!map.getLayer('civigo-route-line')) map.addLayer({
        id: 'civigo-route-line', type: 'line', source: 'civigo-route', paint: { 'line-color': state.brand, 'line-width': 5 },
    });
    map.setLayoutProperty('civigo-roads-layer', 'visibility', state.risk && !state.editor ? 'visible' : 'none');
    map.setLayoutProperty('civigo-incident-areas', 'visibility', state.events && state.zones && !state.editor ? 'visible' : 'none');
    map.setPaintProperty('civigo-route-outline', 'line-color', state.routeOutline);
    map.setPaintProperty('civigo-route-line', 'line-color', state.brand);
}
