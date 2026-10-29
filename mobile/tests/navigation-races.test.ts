import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = [process.env.CIVIGO_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

async function harness(entry: string, replacements: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
    format: 'iife', platform: 'browser', logLevel: 'error', define: { 'import.meta.env': '{}' },
    loader: { '.css': 'empty' },
    plugins: [{ name: 'isolated-navigation', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = Object.keys(replacements).find(key => args.path.endsWith(key));
        if (key) return { path: key, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: replacements[args.path], loader: 'tsx' }));
    } }],
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return { page, browser, errors };
}

const routeFixture = `const route = { id: 'route', nombre: 'Más rápida', tipo: 'rapida', distancia: 100, duracion: 50,
  geometria: { type: 'LineString', coordinates: [[-75.73, -14.06], [-75.7286, -14.0678]] },
  origen: { latitud: -14.06, longitud: -75.73 }, destino: { latitud: -14.0678, longitud: -75.7286 },
  modo: 'walking', pasos: [], advertencias: [] };`;

test('a destination or mode change with lost GPS discards late routes and cannot save a mismatched favorite', {
  skip: !executablePath && 'Requires local Chromium.', timeout: 15000,
}, async () => {
  const { page, browser, errors } = await harness(`
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { RoutePlanner } from './src/components/navigation/RoutePlanner';
    ${routeFixture}
    window.pending = []; window.plans = []; window.favorites = []; window.started = []; window.user = { id: 1, premium: true };
    window.plan = body => { window.plans.push(body); return new Promise(resolve => window.pending.push(() => resolve({ rutas: [route] }))); };
    function Test() {
      const [, refresh] = useState(0); window.refreshOwner = () => refresh(value => value + 1);
      const [fix, setFix] = useState({ latitud: -14.06, longitud: -75.73, accuracy: 5 });
      const [active, setActive] = useState(null); window.setFix = setFix;
      window.active = active;
      return <RoutePlanner currentPosition={fix} activeRoute={active} onSelectRoute={setActive}
        onStartNavigation={route => window.started.push(route)} />;
    }
    createRoot(document.getElementById('root')).render(<Test />);
  `, {
    'hooks/useAuth': 'export const useAuth = () => ({ usuario: window.user });',
    'services/native': 'export const triggerHaptic = async () => {};',
    'SpotifyNavPlayer': 'export const SpotifyNavPlayer = () => null;',
    './api': `export const api = async path => path.startsWith('/navigation/places?') ? [
        { nombre: 'Plaza de Armas de Ica', latitud: -14.0678, longitud: -75.7286, descripcion: 'Plaza pública', fuente: 'Fixture local aislada' },
        { nombre: 'Huacachina Oasis', latitud: -14.0875, longitud: -75.7633, descripcion: 'Destino turístico', fuente: 'Fixture local aislada' }
      ] : []; export const del = async () => {};
      export const distance = () => 0; export const errorMessage = e => e.message;
      export const post = async (path, body) => { if (path === '/navigation/plan') return window.plan(body);
        window.favorites.push(body); return { ...body, id: window.favorites.length }; };`,
    'services/api': 'export const post = async () => ({fotos: [], opiniones: []}); export const errorMessage = e => e.message;',
  });
  try {
    const choose = async (name: string) => {
      await page.getByRole('button', { name: 'Buscar destino en Ica', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const back = dialog.getByRole('button', { name: 'Volver a resultados', exact: true });
      if (await back.count()) await back.click();
      await dialog.getByRole('searchbox', { name: 'Buscar lugares en Ica' }).fill('Destinos de Ica');
      await dialog.getByRole('button', { name, exact: false }).filter({ hasText: name }).first().click();
      await dialog.getByRole('heading', { name, exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Ver rutas', exact: true }).click();
      await page.getByRole('button', { name: 'A pie', exact: true }).click();
    };
    await choose('Plaza de Armas de Ica');
    await page.waitForFunction(() => (window as any).pending.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).plans[0].origen), { latitud: -14.06, longitud: -75.73, accuracy: 5 }, 'the route origin comes directly from GPS');
    await page.evaluate(() => (window as any).setFix(null));
    await choose('Huacachina Oasis');
    await page.evaluate(() => (window as any).pending[0]());
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes('GPS'));
    assert.equal(await page.locator('.route-result').count(), 0);
    assert.equal(await page.evaluate(() => (window as any).active), null);
    await page.evaluate(() => (window as any).setFix({ latitud: -14.06, longitud: -75.73, accuracy: 5 }));
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.waitForFunction(() => (window as any).pending.length === 2);
    await page.evaluate(() => (window as any).pending[1]());
    await page.getByRole('button', { name: 'Guardar ruta en favoritos' }).click();
    const favorite = await page.evaluate(() => (window as any).favorites[0]);
    assert.equal(favorite.nombre, 'Huacachina Oasis');
    assert.deepEqual(favorite.destino, { latitud: -14.0875, longitud: -75.7633 });
    assert.deepEqual(favorite.origen, { latitud: -14.06, longitud: -75.73, accuracy: 5 });
    await choose('Plaza de Armas de Ica');
    await page.waitForFunction(() => (window as any).pending.length === 3);
    await page.evaluate(() => (window as any).setFix(null));
    await page.getByRole('button', { name: 'Auto', exact: true }).click();
    await page.evaluate(() => (window as any).pending[2]());
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes('GPS'));
    assert.equal(await page.locator('.route-result').count(), 0);
    await page.locator('.route-coordinate-input summary').click();
    await page.locator('#route-latitude').fill('-14.1'); await page.locator('#route-longitude').fill('-75.7');
    assert.equal(await page.locator('.gn-destination').count(), 1);
    await page.evaluate(() => { const w = window as any; w.user = { id: 2, premium: true }; w.refreshOwner(); });
    await page.waitForFunction(() => !document.querySelector('.gn-destination'));
    assert.equal(await page.locator('#route-latitude').inputValue(), '');
    assert.equal(await page.locator('#route-longitude').inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'A pie', exact: true, includeHidden: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('map records one history entry per started trip, not per reroute, and cancels on account change', {
  skip: !executablePath && 'Requires local Chromium.', timeout: 15000,
}, async () => {
  const { page, browser, errors } = await harness(`
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { MapPage } from './src/pages/MapPage';
    ${routeFixture}
    window.route = route; window.historyCalls = []; window.user = { id: 1 }; window.visible = true;
    function Test() { const [, refresh] = useState(0); window.refresh = () => refresh(n => n + 1);
      return <MapPage onGoReport={() => {}} visible={window.visible} />; }
    createRoot(document.getElementById('root')).render(<Test />);
  `, {
    'hooks/useAuth': 'export const useAuth = () => ({ usuario: window.user });',
    'hooks/useNearbyBusiness': 'export const useNearbyBusiness = () => ({ad:null,close(){},pause(){}});',
    'navigation/NearbyBusinessCard': 'export default function Card(){return null}',
    'hooks/useGeolocation': 'export const useGeolocation = () => ({ position: null, locate: async () => null });',
    'services/api': 'export const post = async () => ({fotos: [], opiniones: []}); export const errorMessage = e => e.message; export const onUnauthorized = cb => { window.unauthorize = cb; return () => {}; };',
    'services/native': 'export const triggerHaptic = async () => {}; export const onNetworkChange = () => () => {}; export const StorageService = {get:async()=>null,set:async()=>{},remove:async()=>{}};',
    'services/activeTrip': 'export class ActiveTripController {setOwner(){} async load(){return null} async save(){return true} async clear(){}}',
    'incident/NearbyIncidentCards': 'export const NearbyIncidentCards = () => null;',
    'services/mapData': 'export const DEFAULT_ICA_BOUNDS = {}; export const expandMapBounds = a => a; export const getMapIncidents = async () => []; export const getRecentIncidents = async () => [];',
    'services/navigation': `export const isUsableFix = () => false;
      export const isNavigationAccountCurrent = (id, user) => id === user?.id && !user?.bloqueado;
      export const NavigationService = { recordHistory: (...args) => { window.historyCalls.push(args); return new Promise((resolve, reject) => { window.rejectHistory = reject; }); } };`,
    'map/MapView': 'export const MapView = props => props.statusNotices;',
    'incident/IncidentDetailModal': 'export const IncidentDetailModal = () => null;',
    'chat/ChatBotModal': 'export const ChatBotModal = () => null;',
    'navigation/RoutePlanner': 'export const RoutePlanner = props => { window.planner = props; return null; };',
    'navigation/DestinationExplorer': 'export const DestinationExplorer = () => null;',
  });
  try {
    await page.waitForFunction(() => !!(window as any).planner);
    await page.evaluate(() => { const w = window as any; w.planner.onStartNavigation(w.route); w.planner.onStartNavigation(w.route); });
    await page.waitForFunction(() => (window as any).planner.isNavigating);
    assert.equal(await page.evaluate(() => (window as any).historyCalls.length), 1);
    assert.deepEqual(await page.evaluate(() => (window as any).historyCalls[0].slice(1, 4)),
      [{ latitud: -14.06, longitud: -75.73 }, { latitud: -14.0678, longitud: -75.7286 }, 'walking']);
    await page.evaluate(() => { const w = window as any; w.planner.onSelectRoute({ ...w.route, id: 'rerouted' }); w.visible = false; w.refresh(); });
    await page.waitForFunction(() => (window as any).planner.activeRoute.id === 'rerouted');
    assert.equal(await page.evaluate(() => (window as any).historyCalls.length), 1);
    await page.evaluate(() => (window as any).planner.onStopNavigation());
    await page.waitForFunction(() => !(window as any).planner.isNavigating);
    await page.evaluate(() => (window as any).planner.onStartNavigation((window as any).route));
    await page.waitForFunction(() => (window as any).historyCalls.length === 2);
    await page.evaluate(() => { (window as any).user = { id: 2 }; (window as any).refresh(); });
    await page.waitForFunction(() => !(window as any).planner.isNavigating);
    assert.equal(await page.evaluate(() => (window as any).historyCalls[1][4].aborted), true);
    assert.equal(await page.evaluate(() => (window as any).historyCalls[0][4].aborted), true);
    await page.evaluate(() => { (window as any).visible = true; (window as any).refresh(); });
    await page.evaluate(() => (window as any).planner.onStartNavigation((window as any).route));
    await page.waitForFunction(() => (window as any).historyCalls.length === 3);
    await page.evaluate(() => (window as any).rejectHistory(new Error('Sin conexión')));
    await page.getByRole('button', { name: 'Expandir opciones de navegación' }).click();
    const historyNotice = page.locator('summary').filter({ hasText: 'Historial sin guardar' });
    await historyNotice.waitFor();
    assert.equal(await historyNotice.evaluate(summary => (summary.parentElement as HTMLDetailsElement).open), false);
    await historyNotice.click();
    await page.getByRole('status').filter({ hasText: 'No se pudo guardar el recorrido' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).planner.isNavigating), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('live planner preserves a route through poor GPS, reroute cancellation, background and offline attempts', {
  skip: !executablePath && 'Requires local Chromium.', timeout: 20000,
}, async () => {
  const { page, browser, errors } = await harness(`
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { RoutePlanner } from './src/components/navigation/RoutePlanner';
    window.now = 1800000000000; Date.now = () => window.now;
    window.hidden = false; window.online = true; window.plans = []; window.voices = []; window.stops = 0;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.hidden ? 'hidden' : 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.online });
    const route = { id: 'original', nombre: 'Prueba de ruta', tipo: 'rapida', distancia: 1112, duracion: 120,
      geometria: { type: 'LineString', coordinates: [[0, 0], [.005, 0], [.01, 0]] }, advertencias: [],
      origen: { latitud: 0, longitud: 0 }, destino: { latitud: 0, longitud: .01 }, modo: 'driving',
      pasos: [{ id: 'start', tipo: 'salida', maniobra: 'recto', instruccion: 'Continúa por la vía', calle: 'Vía de prueba',
        distancia: 1112, duracion: 120, distanciaAcumulada: 0, duracionAcumulada: 0,
        coordenadas: [0, 0], indiceInicio: 0, indiceFin: 2, geometria: { type: 'LineString', coordinates: [[0,0],[.01,0]] } }] };
    function Test() {
      const [fix, setFix] = useState({ latitud: 0, longitud: .001, accuracy: 5, timestamp: window.now, speed: 10 });
      const [active, setActive] = useState(route); window.setFix = setFix; window.active = active;
      return <RoutePlanner currentPosition={fix} activeRoute={active} onSelectRoute={setActive} isNavigating compact={false} />;
    }
    createRoot(document.getElementById('root')).render(<Test />);
  `, {
    'hooks/useAuth': 'export const useAuth = () => ({ usuario: { id: 1, premium: true } });',
    'services/native': 'export const triggerHaptic = async () => {};',
    'SpotifyNavPlayer': 'export const SpotifyNavPlayer = () => null;',
    'services/navigationVoice': `export const navigationVoiceSupported = () => true;
      export const speakNavigation = async text => { window.voices.push(text); };
      export const stopNavigationVoice = async () => { window.stops++; };`,
    './api': `export const api = async () => []; export const del = async () => {};
      export const distance = () => 0; export const errorMessage = e => e.message;
      export const post = (path, body) => new Promise(resolve => { window.plans.push(body); window.resolvePlan = resolve; });`,
    'services/api': 'export const post = async () => ({fotos: [], opiniones: []}); export const errorMessage = e => e.message;',
  });
  try {
    await page.waitForFunction(() => (window as any).voices.length > 0);
    await page.evaluate(() => { const w = window as any; w.now += 1000; w.setFix({ latitud: .003, longitud: .001, accuracy: 80, timestamp: w.now }); });
    await page.getByText('GPS sin señal reciente o con poca precisión. Se conserva la ruta.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).plans.length), 0);
    assert.equal(await page.getByRole('button', { name: 'Recalcular', exact: true }).isDisabled(), true);
    for (let sample = 0; sample < 3; sample++) {
      await page.evaluate(() => { const w = window as any; w.now += 4000; w.setFix({ latitud: .003, longitud: .001, accuracy: 5, timestamp: w.now }); });
      await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => (window as any).plans.length === 1);
    assert.equal(await page.evaluate(() => (window as any).active.id), 'original', 'pending recalculation never clears the previous route');
    await page.evaluate(() => { const w = window as any; w.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.body.textContent?.includes('Esperando ubicación precisa'));
    const voiceCount = await page.evaluate(() => (window as any).voices.length);
    await page.evaluate(() => { const w = window as any; w.now += 60000; w.resolvePlan({ rutas: [{ ...w.active, id: 'stale-reroute' }] }); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => (window as any).active.id), 'original', 'a late response from suspended app cannot replace the route');
    assert.equal(await page.evaluate(() => (window as any).voices.length), voiceCount, 'no background speech');
    await page.evaluate(() => { const w = window as any; w.online = false; w.hidden = false; w.setFix({ latitud: 0, longitud: .002, accuracy: 5, timestamp: w.now, speed: 10 }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('button', { name: 'Recalcular', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Sin conexión. Se conserva el último recorrido' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).plans.length), 1, 'offline manual action performs no network request');
    assert.equal(await page.evaluate(() => (window as any).active.id), 'original');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the real place sheet previews a stop, preserves final destination and continues only from precise GPS at that stop', {
  skip: !executablePath && 'Requires local Chromium.', timeout: 20000,
}, async () => {
  const { page, browser, errors } = await harness(`
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { RoutePlanner } from './src/components/navigation/RoutePlanner';
    window.now = 1800000000000; Date.now = () => window.now; window.plans = [];
    const route = { id: 'original', nombre: 'Prueba de ruta', tipo: 'rapida', distancia: 1112, duracion: 120,
      geometria: { type: 'LineString', coordinates: [[0, 0], [.005, 0], [.01, 0]] }, advertencias: [], pasos: [],
      origen: { latitud: 0, longitud: 0 }, destino: { latitud: 0, longitud: .01 }, destinoNombre: 'Destino final', modo: 'driving' };
    window.plan = body => {
      window.plans.push(body); const n = window.plans.length;
      return { rutas: [{ ...route, id: 'leg-' + n, distancia: n === 1 ? 500 : n === 2 ? 700 : 1000, duracion: n === 1 ? 70 : n === 2 ? 80 : 100,
        modo: body.modo, geometria: { type: 'LineString', coordinates: [[body.origen.longitud, body.origen.latitud], [body.destino.longitud, body.destino.latitud]] } }] };
    };
    function Test() {
      const [fix, setFix] = useState({ latitud: 0, longitud: 0, accuracy: 5, timestamp: window.now });
      const [active, setActive] = useState(route); window.setFix = setFix; window.active = active;
      return <RoutePlanner currentPosition={fix} activeRoute={active} onSelectRoute={setActive} isNavigating compact={false} />;
    }
    createRoot(document.getElementById('root')).render(<Test />);
  `, {
    'hooks/useAuth': 'export const useAuth = () => ({ usuario: { id: 1, premium: true } });',
    'services/native': 'export const triggerHaptic = async () => {};',
    'SpotifyNavPlayer': 'export const SpotifyNavPlayer = () => null;',
    'services/navigationVoice': 'export const navigationVoiceSupported = () => false; export const speakNavigation = async () => {}; export const stopNavigationVoice = async () => {};',
    './api': `export const api = async path => path.startsWith('/navigation/places?')
      ? [{ nombre: 'Farmacia aislada', latitud: .001, longitud: .004, fuente: 'Fixture, no negocio real' }] : [];
      export const del = async () => {};
      export const distance = (a, b) => Math.hypot(a.latitud - b.latitud, a.longitud - b.longitud) * 111320;
      export const errorMessage = e => e.message; export const post = async (path, body) => window.plan(body);`,
    'services/api': 'export const post = async () => ({fotos: [], opiniones: []}); export const errorMessage = e => e.message;',
  });
  try {
    await page.getByRole('button', { name: 'Buscar en la ruta', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('searchbox', { name: 'Buscar lugares en Ica' }).fill('Farmacia');
    await dialog.getByRole('button', { name: /Farmacia aislada/ }).click();
    await dialog.getByRole('button', { name: 'Calcular parada', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Confirmar parada' });
    await preview.waitFor();
    assert.equal(await page.evaluate(() => (window as any).plans.length), 3);
    assert.equal(await page.evaluate(() => (window as any).active.id), 'original', 'planning alone never changes the trip');
    await preview.getByRole('button', { name: 'Agregar parada', exact: true }).click();
    await page.waitForFunction(() => (window as any).active.paradaIntermedia?.nombre === 'Farmacia aislada');
    assert.deepEqual(await page.evaluate(() => (window as any).active.paradaIntermedia.destinoFinal), { latitud: 0, longitud: .01 });
    assert.equal(await page.getByRole('button', { name: 'Continuar al destino final', exact: true }).count(), 0);
    await page.evaluate(() => { const w = window as any; w.now += 10000; w.setFix({ latitud: .001, longitud: .004, accuracy: 75, timestamp: w.now }); });
    await page.waitForTimeout(80);
    assert.equal(await page.getByRole('button', { name: 'Continuar al destino final', exact: true }).count(), 0, 'imprecise arrival is not a completed stop');
    await page.evaluate(() => { const w = window as any; w.now += 1000; w.setFix({ latitud: .001, longitud: .004, accuracy: 5, timestamp: w.now }); });
    await page.getByRole('button', { name: 'Continuar al destino final', exact: true }).click();
    await page.waitForFunction(() => (window as any).plans.length === 4 && !(window as any).active.paradaIntermedia);
    assert.deepEqual(await page.evaluate(() => (window as any).plans[3].origen), { latitud: .001, longitud: .004, accuracy: 5, timestamp: 1800000011000 });
    assert.deepEqual(await page.evaluate(() => (window as any).active.destino), { latitud: 0, longitud: .01 });
    assert.equal(await page.evaluate(() => (window as any).active.destinoNombre), 'Destino final');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
