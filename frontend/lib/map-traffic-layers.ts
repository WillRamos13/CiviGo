import type { Map } from 'mapbox-gl';

export const TRAFFIC_SOURCE_ID = 'tomtom-flow';
export const TRAFFIC_LAYER_ID = 'tomtom-flow-layer';

type TrafficLayerMap = Pick<Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'getStyle' | 'setLayoutProperty'>;

// The caller supplies the same-origin backend proxy URL. Reapply with current
// state after style.load: Mapbox discards custom sources/layers on style reset.
export function syncTrafficLayer(map: TrafficLayerMap, enabled: boolean, url: string) {
    if (!enabled) {
        if (map.getLayer(TRAFFIC_LAYER_ID)) map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'none');
        return;
    }
    if (!map.getSource(TRAFFIC_SOURCE_ID)) {
        map.addSource(TRAFFIC_SOURCE_ID, {
            type: 'raster', tiles: [url], tileSize: 256, minzoom: 5, maxzoom: 18,
            attribution: '© TomTom',
        });
    }
    if (!map.getLayer(TRAFFIC_LAYER_ID)) {
        const firstLabel = map.getStyle()?.layers?.find(layer => layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined)?.id;
        map.addLayer({
            id: TRAFFIC_LAYER_ID, type: 'raster', source: TRAFFIC_SOURCE_ID,
            paint: {'raster-opacity': .85},
        }, firstLabel);
    }
    map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'visible');
}
