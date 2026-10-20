import type { Map as MapboxMap } from 'mapbox-gl';

type PaintMap = Pick<MapboxMap, 'getStyle' | 'getPaintProperty' | 'setPaintProperty' | 'getLayer'>;
type PaintKey = Parameters<PaintMap['setPaintProperty']>[1];
type PaintValue = Parameters<PaintMap['setPaintProperty']>[2];
const owned = /^(?:civigo-|route-|tomtom-)/;
type OriginalPaint = Map<string, Map<PaintKey, PaintValue>>;

/** Repaint the existing Streets layers: sources, camera, incident/risk and route layers stay intact. */
export class CiviGoMapTheme {
  private original: OriginalPaint = new globalThis.Map();
  apply(map: PaintMap, dark: boolean): void {
    for (const layer of map.getStyle()?.layers ?? []) {
      if (owned.test(layer.id) || !map.getLayer(layer.id)) continue;
      const sourceLayer = 'source-layer' in layer ? String(layer['source-layer']) : '';
      const key = `${layer.id} ${sourceLayer}`.toLowerCase();
      const paint: Partial<Record<PaintKey, string>> = {};
      if (layer.type === 'background') paint['background-color'] = '#091923';
      if (layer.type === 'fill') paint['fill-color'] = /water/.test(key) ? '#07394b' :
        /building/.test(key) ? '#1a2d3b' : /park|landuse|landcover/.test(key) ? '#122c31' : '#10232f';
      if (layer.type === 'fill-extrusion') paint['fill-extrusion-color'] = '#213747';
      if (layer.type === 'line') paint['line-color'] = /water/.test(key) ? '#145268' :
        /road|bridge|tunnel/.test(key) ? /motorway|trunk/.test(key) ? '#54738a' : /case/.test(key) ? '#102531' : '#344d60' : '#29414f';
      if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
        paint['text-color'] = /road|street/.test(key) ? '#bdd4e4' : '#d9e9f3';
        paint['text-halo-color'] = '#0a1d29';
      }
      for (const [property, value] of Object.entries(paint) as [PaintKey, string][]) {
        let saved = this.original.get(layer.id);
        if (!saved) { saved = new globalThis.Map(); this.original.set(layer.id, saved); }
        if (!saved.has(property)) saved.set(property, map.getPaintProperty(layer.id, property));
        // undefined resets the property to the Mapbox style-spec default.
        map.setPaintProperty(layer.id, property, dark ? value : saved.get(property));
      }
    }
    if (map.getLayer('route-line')) map.setPaintProperty('route-line', 'line-color', dark ? '#19c9ff' : '#1554d8');
    if (map.getLayer('route-casing')) map.setPaintProperty('route-casing', 'line-color', dark ? '#082d49' : '#ffffff');
  }
}
