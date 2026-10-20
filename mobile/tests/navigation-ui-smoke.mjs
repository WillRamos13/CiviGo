import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

// Exercise the real components without a server, provider calls or an account.
const mapAdapter = `
class Map {
  constructor(options) {
    this.options = options; this.handlers = {}; this.sources = {}; this.layers = {};
    this.center = options.center; this.zoom = options.zoom; this.bounds = [-75.8, -14.1, -75.7, -14]; this.flyCalls = 0;
    window.auditMap = this; setTimeout(() => this.handlers.load?.(), 0);
  }
  on(name, callback) { this.handlers[name] = callback; return this; }
  off(name, callback) { if (this.handlers[name] === callback) delete this.handlers[name]; return this; }
  getZoom() { return this.zoom; } getContainer() { return this.options.container; }
  getBearing() { return 0; }
  getCenter() { return { lng: this.center[0], lat: this.center[1] }; } getPitch() { return 0; }
  getStyle() { return { layers: [] }; }
  zoomTo(value) { this.zoom = value; this.handlers.zoom?.(); }
  loaded() { return true; } areTilesLoaded() { return true; } isStyleLoaded() { return true; }
  getBounds() { return { getWest: () => this.bounds[0], getSouth: () => this.bounds[1], getEast: () => this.bounds[2], getNorth: () => this.bounds[3] }; }
  pan(bounds) { this.bounds = bounds; this.handlers.moveend?.(); }
  addControl() {} resize() {} remove() {} triggerRepaint() {} resetNorthPitch() {} fitBounds() {} stop() {}
  addSource(name, options) { this.sources[name] = { data: options.data, setData: data => { this.sources[name].data = data; } }; }
  addLayer(layer) { this.layers[layer.id] = layer; }
  getSource(name) { return this.sources[name]; } getLayer(name) { return this.layers[name]; } setLayoutProperty() {}
  getPaintProperty(name, key) { return this.layers[name]?.paint?.[key]; } setPaintProperty(name, key, value) { if(this.layers[name]) (this.layers[name].paint??={})[key]=value; }
  flyTo(options) { this.center = options.center; this.flyCalls++; if (options.zoom) this.zoomTo(options.zoom); }
  easeTo(options) { this.center = options.center; if (options.zoom) this.zoomTo(options.zoom); }
}
class Marker {
  constructor(options) { this.element = options.element; }
  setLngLat(coordinates) { this.coordinates = coordinates; return this; }
  addTo(map) { map.options.container.append(this.element); return this; }
  getElement() { return this.element; } on() { return this; } remove() { this.element.remove(); }
  getLngLat() { return { lng: this.coordinates[0], lat: this.coordinates[1] }; }
}
export default { Map, Marker, LngLatBounds: class { extend() { return this; } }, AttributionControl: class {} };
`;
const transportAdapter = `
export const api = async path => window.auditApi(path);
export const post = async (path, body) => window.auditPost(path, body);
export const del = async path => { window.auditFavorites = window.auditFavorites.filter(item => item.id !== Number(path.split('/').at(-1))); };
export const distance = (a, b) => Math.hypot(a.latitud - b.latitud, a.longitud - b.longitud) * 111000;
export const errorMessage = error => error.message;
export const resolveApiUrl = path => 'https://civigo-production.up.railway.app/api' + path;
`;
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutePlanner } from './src/components/navigation/RoutePlanner';
import { MapView } from './src/components/map/MapView';
import { NavigationService } from './src/services/navigation';
window.auditCalls = [];
const route = { id: 'local', nombre: 'Local', tipo: 'rapida', distancia: 222, duracion: 120,
  geometria: { type: 'LineString', coordinates: [[-75.9, -14.15], [-75.7286, -14.0678]] }, pasos: [], advertencias: [] };
window.auditUser = { id: 901, premium: false, bloqueado: false };
window.auditFavorites = [1, 2, 3].map(id => ({ id, nombre: 'Favorito ' + id, modo: 'walking',
  origen: { latitud: -14.15, longitud: -75.9 }, destino: { latitud: -14.0678, longitud: -75.7286 }, datos: route }));
window.auditDelete = id => NavigationService.removeFavorite(id);
window.auditApi = async path => {
  window.auditCalls.push(['GET', path]);
  if (path === '/navigation/favorites') return structuredClone(window.auditFavorites);
  if (path === '/navigation/traffic/status') return { configurado: true, habilitado: true, controlCuotaDisponible: true, cuotas: { tiles: { restantes: 100 } } };
  if (path === '/navigation/traffic/incidents') return { incidentes: [], trafico: { disponible: true, fuente: 'TOMTOM', actualizadoEn: '2026-10-18T12:00:00.000Z', motivo: '' } };
  if (path === '/navigation/roads/risk') return { version: 'v1', revision: 'r1', values: [] };
  return { version: 'v1', type: 'FeatureCollection', features: [] };
};
window.auditPost = async (path, body) => {
  window.auditCalls.push(['POST', path]);
  if (path === '/navigation/plan') return { rutas: [route] };
  const favorite = { id: 4, nombre: body.nombre, modo: body.modo, origen: body.origen, destino: body.destino, datos: body.ruta };
  window.auditFavorites.push(favorite); return favorite;
};
const incident = { id: 1, tipo: 'bache', descripcion: 'Inicial', latitud: -14.05, longitud: -75.75, estado: 'ACTIVO', nivelRiesgo: 1 };
function Test() {
  const [active, setActive] = useState(null), [visible, setVisible] = useState(true), [fix, setFix] = useState(null);
  const [incidents, setIncidents] = useState([incident, { ...incident, id: 2, longitud: -75.82 }, { ...incident, id: 3, latitud: -14.15, longitud: -75.9 }]);
  window.auditSetVisible = setVisible; window.auditSetIncidents = setIncidents;
  return <><MapView incidentes={incidents} posicion={fix} onSelectIncident={value => { window.auditSelected = value; }}
    onLocateMe={() => new Promise(resolve => { window.auditResolveLocate = value => { setFix(value); resolve(value); }; })} />
    <div hidden={!visible}><RoutePlanner currentPosition={{ latitud: -14.15, longitud: -75.9, accuracy: 5 }} activeRoute={active} onSelectRoute={setActive} /></div></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2020', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolated-navigation-adapters', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const file = args.path.replaceAll('\\', '/');
      if (file === 'mapbox-gl') return { path: 'map', namespace: 'audit' };
      if (file.endsWith('services/api') || (file === './api' && args.importer.replaceAll('\\', '/').includes('/services/'))) return { path: 'api', namespace: 'audit' };
      if (file.endsWith('hooks/useAuth')) return { path: 'auth', namespace: 'audit' };
      if (file.endsWith('services/native')) return { path: 'native', namespace: 'audit' };
      if (file.endsWith('SpotifyNavPlayer')) return { path: 'spotify', namespace: 'audit' };
      if (file.endsWith('.css')) return { path: 'css', namespace: 'audit' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'audit' }, args => ({ loader: 'js', contents:
      args.path === 'map' ? mapAdapter : args.path === 'api' ? transportAdapter :
      args.path === 'auth' ? 'export const useAuth = () => ({ usuario: window.auditUser });' :
      args.path === 'native' ? 'export const triggerHaptic = async () => {}; export const onNetworkChange = () => () => {}; export const StorageService={get:async()=>null,set:async()=>{},remove:async()=>{}};' :
      args.path === 'spotify' ? 'export const SpotifyNavPlayer = () => null;' : '' }));
  } }],
});
const executablePath = process.env.CIVIGO_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', handler => handler.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.auditMap?.sources['civigo-incidents']?.data.features.length === 3);
  assert.equal(await page.locator('.incident-marker').count(), 0, 'province zoom does not allocate incident markers');
  await page.evaluate(() => window.auditMap.zoomTo(14));
  await page.locator('[data-incident-id="1"]').waitFor();
  assert.equal(await page.locator('.incident-marker').count(), 2);
  assert.equal(await page.evaluate(() => window.auditMap.sources['civigo-incidents'].data.features.length), 3);
  assert.equal(await page.evaluate(() => window.auditCalls.filter(([, path]) => path === '/navigation/traffic/incidents').length), 0, 'inactive traffic never consumes external-event queries');
  await page.locator('.map-layer-panel > summary').click();
  await page.getByLabel('Tráfico · TomTom', { exact: true }).check();
  await page.waitForFunction(() => window.auditCalls.some(([, path]) => path === '/navigation/traffic/incidents'));
  assert.equal(await page.evaluate(() => window.auditCalls.filter(([, path]) => path === '/navigation/traffic/incidents').length), 1);
  assert.equal(await page.getByLabel('Riesgo por tramo', { exact: true }).isChecked(), false);
  await page.getByLabel('Tráfico · TomTom', { exact: true }).uncheck();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.auditCalls.filter(([, path]) => path === '/navigation/traffic/incidents').length), 1, 'turning traffic off stops new external-event queries');
  await page.locator('.map-layer-panel > summary').click();
  await page.getByRole('button', { name: 'Ubicar mi posición' }).click();
  await page.evaluate(() => window.auditResolveLocate({ latitud: -14.15, longitud: -75.9, accuracy: 5, timestamp: Date.now() }));
  await page.waitForFunction(() => window.auditMap.flyCalls === 1);
  assert.deepEqual(await page.evaluate(() => window.auditMap.center), [-75.9, -14.15]);
  await page.getByRole('button', { name: 'Ubicar mi posición' }).click();
  await page.evaluate(() => window.auditResolveLocate(null));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.evaluate(() => window.auditMap.flyCalls), 1, 'a failed retry cannot center on the previous fix');

  await page.evaluate(() => { window.auditOriginalMarker = document.querySelector('[data-incident-id="1"]');
    window.auditSetIncidents(values => values.map(value => value.id === 1 ? { ...value, tipo: 'robo', tipoSlug: 'robo', gravedad: 5, descripcion: 'Actualizado' } : value)); });
  await page.getByRole('button', { name: 'robo: Actualizado', exact: true }).click();
  assert.equal(await page.evaluate(() => window.auditSelected.descripcion), 'Actualizado');
  assert.equal(await page.evaluate(() => window.auditOriginalMarker === document.querySelector('[data-incident-id="1"]')), true);
  await page.evaluate(() => window.auditMap.pan([-76, -14.3, -75.85, -14.1]));
  await page.locator('[data-incident-id="3"]').waitFor();
  assert.equal(await page.locator('[data-incident-id="1"]').count(), 0);
  assert.equal(await page.evaluate(() => window.auditMap.sources['civigo-incidents'].data.features.length), 3);

  await page.getByRole('button', { name: 'Plaza de Armas de Ica', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar ruta en favoritos' }).waitFor();
  await page.evaluate(() => window.auditSetVisible(false));
  await page.evaluate(() => window.auditDelete(1));
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Destinos favoritos"] button').length === 2);
  await page.evaluate(() => window.auditSetVisible(true));
  await page.getByRole('button', { name: 'Guardar ruta en favoritos' }).click();
  await page.waitForFunction(() => window.auditCalls.some(([method, path]) => method === 'POST' && path === '/navigation/favorites'));
  assert.equal(await page.evaluate(() => window.auditFavorites.length), 3);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['fresh-location-camera', 'marker-viewport-buffer', 'marker-updates-and-selection', 'complete-heatmap', 'traffic-demand-loading', 'retained-favorites-delete-and-save'], externalRequestsAllowed: 0 }));
} finally { await browser.close(); }
