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
    window.pending = []; window.favorites = []; window.started = [];
    window.plan = () => new Promise(resolve => window.pending.push(() => resolve({ rutas: [route] })));
    function Test() {
      const [fix, setFix] = useState({ latitud: -14.06, longitud: -75.73, accuracy: 5 });
      const [active, setActive] = useState(null); window.setFix = setFix;
      window.active = active;
      return <RoutePlanner currentPosition={fix} activeRoute={active} onSelectRoute={setActive}
        onStartNavigation={route => window.started.push(route)} />;
    }
    createRoot(document.getElementById('root')).render(<Test />);
  `, {
    'hooks/useAuth': 'export const useAuth = () => ({ usuario: { id: 1, premium: true } });',
    'services/native': 'export const triggerHaptic = async () => {};',
    'SpotifyNavPlayer': 'export const SpotifyNavPlayer = () => null;',
    './api': `export const api = async () => []; export const del = async () => {};
      export const distance = () => 0; export const errorMessage = e => e.message;
      export const post = async (path, body) => { if (path === '/navigation/plan') return window.plan();
        window.favorites.push(body); return { ...body, id: window.favorites.length }; };`,
    'services/api': 'export const errorMessage = e => e.message;',
  });
  try {
    await page.getByRole('button', { name: 'Plaza de Armas de Ica', exact: true }).click();
    await page.waitForFunction(() => (window as any).pending.length === 1);
    await page.evaluate(() => (window as any).setFix(null));
    await page.getByRole('button', { name: 'Huacachina Oasis', exact: true }).click();
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
    await page.getByRole('button', { name: 'Plaza de Armas de Ica', exact: true }).click();
    await page.waitForFunction(() => (window as any).pending.length === 3);
    await page.evaluate(() => (window as any).setFix(null));
    await page.getByRole('button', { name: 'Auto', exact: true }).click();
    await page.evaluate(() => (window as any).pending[2]());
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes('GPS'));
    assert.equal(await page.locator('.route-result').count(), 0);
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
    'hooks/useGeolocation': 'export const useGeolocation = () => ({ position: null, locate: async () => null });',
    'services/api': 'export const errorMessage = e => e.message; export const onUnauthorized = cb => { window.unauthorize = cb; return () => {}; };',
    'services/native': 'export const triggerHaptic = async () => {}; export const onNetworkChange = () => () => {};',
    'services/mapData': 'export const DEFAULT_ICA_BOUNDS = {}; export const expandMapBounds = a => a; export const getMapIncidents = async () => []; export const getRecentIncidents = async () => [];',
    'services/navigation': `export const isUsableFix = () => false;
      export const isNavigationAccountCurrent = (id, user) => id === user?.id && !user?.bloqueado;
      export const NavigationService = { recordHistory: (...args) => { window.historyCalls.push(args); return new Promise((resolve, reject) => { window.rejectHistory = reject; }); } };`,
    'map/MapView': 'export const MapView = () => null;',
    'incident/IncidentDetailModal': 'export const IncidentDetailModal = () => null;',
    'chat/ChatBotModal': 'export const ChatBotModal = () => null;',
    'navigation/RoutePlanner': 'export const RoutePlanner = props => { window.planner = props; return null; };',
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
    await page.evaluate(() => (window as any).planner.onStartNavigation((window as any).route));
    await page.waitForFunction(() => (window as any).historyCalls.length === 3);
    await page.evaluate(() => (window as any).rejectHistory(new Error('Sin conexión')));
    await page.getByRole('status').filter({ hasText: 'No se pudo guardar el recorrido' }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).planner.isNavigating), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
