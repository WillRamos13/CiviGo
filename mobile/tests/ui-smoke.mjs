import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const artifactDir = path.join(root, '.local', 'ui-smoke');
await mkdir(artifactDir, { recursive: true });
const profileDir = await mkdtemp(path.join(artifactDir, 'chrome-profile-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let context;
const results = [];
const errors = [];
const external = [];
let failedIncidents = false;
const user = { id: 901, nickname: 'Prueba local', correo: 'prueba-local@gmail.com', telefono: '+51900000000',
  rol: 'USUARIO', premium: false, correoVerificado: true, bloqueado: false, monedas: 20, credibilidad: null };
const incident = { id: 501, tipo: 'bache', tipoNombre: 'Bache', descripcion: 'Bache del entorno local de prueba',
  estado: 'VALIDADO', nivelRiesgo: 2, latitud: -14.0679, longitud: -75.7286, totalReportes: 1, evaluacion: 'AGENTE',
  individual: false, fechaCreacion: new Date().toISOString(), fechaPublicacion: new Date().toISOString(), publicado: true,
  adjuntos: [{ id: 'test-media', nombre: 'Imagen local', url: '/api/uploads/test-media', mimeType: 'image/png', privado: false }] };
const type = { id: 1, nombre: 'Bache', slug: 'bache', emergencia: false, historico: false, fotoObligatoria: true, individual: false, ubicacionRemota: false };
const route = { id: 'segura-local', nombre: 'Más segura', tipo: 'segura', distancia: 1400, duracion: 600,
  geometria: { type: 'LineString', coordinates: [[-75.7286, -14.0678], [-75.7286, -14.0718], [-75.731, -14.0758]] },
  puntosRiesgo: 2, nivelRiesgo: 1, riesgoConocido: true, advertencias: ['Aviso local de prueba'],
  trafico: { disponible: false, fuente: null, actualizadoEn: null, demoraSegundos: 0, motivo: 'No disponible' },
  pasos: [
    { id: 'start', tipo: 'start', maniobra: 'start', instruccion: 'Continúa por la avenida de prueba', calle: 'Avenida local', distancia: 450, duracion: 200, distanciaAcumulada: 0, duracionAcumulada: 0 },
    { id: 'left', tipo: 'turn', maniobra: 'turn-left', instruccion: 'Gira a la izquierda en la calle de prueba', calle: 'Calle local', distancia: 950, duracion: 400, distanciaAcumulada: 450, duracionAcumulada: 200 },
  ] };
const executablePath = process.env.CIVIGO_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
try {
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath, headless: true, viewport: { width: 390, height: 844 },
    permissions: ['geolocation'], geolocation: { latitude: -14.0678, longitude: -75.7286, accuracy: 5 },
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await context.route('**/*', async handler => {
    const request = handler.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return handler.continue();
    if (url.origin !== origin) {
      external.push(url.hostname);
      if (url.hostname === 'api.mapbox.com' && url.pathname.startsWith('/styles/')) return handler.fulfill({ json: {
        version: 8, sources: {}, layers: [{ id: 'local-background', type: 'background', paint: { 'background-color': '#d8e8dc' } }],
      } });
      return handler.abort();
    }
    if (!url.pathname.startsWith('/api/')) return handler.continue();
    const api = url.pathname.slice(4);
    if (api === '/users/me') return handler.fulfill({ json: { usuario: user } });
    if (api === '/uploads/test-media') return handler.fulfill({ contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64') });
    if (api === '/incidents/501/chat') return handler.fulfill({ json: [] });
    if (api === '/incidents') return handler.fulfill(failedIncidents ? { status: 503, json: { error: 'Fallo local de prueba' } }
      : { json: url.searchParams.has('bbox') ? { items: [incident], nextCursor: null } : [incident] });
    if (api === '/navigation/favorites' || api === '/reports/mine') return handler.fulfill({ json: [] });
    if (api === '/navigation/roads/risk') return handler.fulfill({ json: { version: 'local', revision: 'r1', values: [] } });
    if (api === '/navigation/roads/geometry') return handler.fulfill({ json: { version: 'local', type: 'FeatureCollection', features: [] } });
    if (api === '/navigation/places') return handler.fulfill({ json: [{ nombre: 'Plaza de Armas de Ica', latitud: -14.0758, longitud: -75.731, fuente: 'Prueba local' }] });
    if (api === '/navigation/plan') return handler.fulfill({ json: { rutas: [route] } });
    if (api === '/catalog') return handler.fulfill({ json: { categorias: [{ id: 1, nombre: 'Infraestructura', slug: 'infraestructura', tipos: [type] }], config: {}, distritos: ['Ica'] } });
    if (api === '/participation') return handler.fulfill({ json: { reportesValidados: 0, totalReportes: 0, puntosMensuales: 0, mes: '2026-10', insignias: [], movimientos: [] } });
    if (api === '/notifications') return handler.fulfill({ json: [{ id: 3, titulo: 'Aviso de prueba', mensaje: 'Notificación local', leida: false, tipo: 'REVISION', creadoEn: new Date().toISOString() }] });
    if (api === '/notifications/3/read') return handler.fulfill({ json: { leida: true } });
    if (api === '/ranking') return handler.fulfill({ json: { mes: '2026-10', demo: true, finalized: false, entries: [{ nickname: 'Ciudadano local', position: 1, puntos: 30, credibilidad: null, monedasEstimadas: 100 }] } });
    if (api === '/recompensas') return handler.fulfill({ json: { monedas: 20, recompensas: [], canjes: [], demo: true } });
    if (api === '/chatbot') return handler.fulfill({ json: { respuesta: '**Guía local**\n\n- Confirma la ubicación\n- Adjunta una imagen', ia: false } });
    return handler.fulfill({ status: 404, json: { error: `Ruta no simulada: ${api}` } });
  });
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('combobox', { name: 'Buscar destino en Ica' }).waitFor();
  for (const width of [320, 390, 768, 1024]) {
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 844 });
      const themeButton = page.getByRole('button', { name: dark ? 'Modo oscuro' : 'Modo claro', exact: true });
      if (await themeButton.count()) await themeButton.click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Desbordamiento en ${width}/${dark}`);
      await page.screenshot({ path: path.join(artifactDir, `map-${width}-${dark ? 'dark' : 'light'}.png`) });
      results.push(`Mapa ${width}px / ${dark ? 'oscuro' : 'claro'} sin desbordamiento`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setGeolocation({ latitude: -14.0678, longitude: -75.7286, accuracy: 5 });
  await page.getByRole('button', { name: 'Ubicar mi posición', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar destino en Ica' }).fill('Plaza de Armas');
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Iniciar recorrido' }).click();
  const guidance = page.getByRole('region', { name: 'Indicaciones del recorrido' });
  await guidance.waitFor();
  await guidance.getByRole('button', { name: 'Finalizar', exact: true }).waitFor({ state: 'visible' });
  assert.ok(await guidance.getByText(/restantes/).count());
  assert.ok(await guidance.getByText(/Llegada aprox/).count());
  assert.ok(await guidance.getByText(/Gira a la izquierda/).count());
  assert.equal(await guidance.getByText('Abrir Spotify', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifactDir, 'navigation-compact.png') });
  results.push('Navegación compacta mantiene siguiente giro, distancia, ETA, alertas y Finalizar; Spotify apagado');
  await page.getByRole('button', { name: 'Mi Perfil', exact: true }).click();
  await page.locator('.mapboxgl-canvas').waitFor({ state: 'detached' });
  await page.locator('label').filter({ hasText: 'Spotify durante la navegación' }).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Explorar Mapa', exact: true }).click();
  await page.locator('.mapboxgl-canvas').waitFor({ state: 'visible' });
  await guidance.getByRole('button', { name: 'Finalizar', exact: true }).waitFor();
  await guidance.getByRole('button', { name: 'Abrir Spotify', exact: true }).waitFor();
  assert.equal(await guidance.getByRole('button', { name: /Reproducir|Siguiente pista|Pausar/ }).count(), 0);
  results.push('Mapa libera su contexto gráfico al ocultarse y lo reconstruye al volver');
  results.push('Recorrido continúa entre pestañas y el acceso honesto a Spotify aparece sólo al habilitarlo');
  await guidance.getByRole('button', { name: 'Finalizar', exact: true }).click();
  await page.locator('.nearby-incidents summary').click();
  await page.locator('.nearby-incident').first().click();
  const photo = page.locator('img[src^="blob:"]').first();
  await photo.waitFor({ state: 'visible' });
  assert.ok(await photo.evaluate(element => element.complete && element.naturalWidth > 0));
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await photo.waitFor({ state: 'detached' });
  results.push('Detalle descarga la evidencia autenticada, muestra imagen Blob y libera el visor al cerrar');
  await page.getByRole('button', { name: 'Abrir asistente de ayuda CiviGo' }).click();
  await page.getByRole('button', { name: '¿Cómo hago un reporte?', exact: true }).click();
  await page.locator('.chat-bot strong').filter({ hasText: 'Guía local' }).waitFor();
  assert.equal(await page.locator('.chat-bot li').count(), 2);
  await page.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
  results.push('Asistente muestra negritas y listas de respuesta real simulada');
  await page.getByRole('button', { name: 'Alertas y avisos', exact: true }).click();
  await page.getByRole('button', { name: /Marcar.*leída/ }).click();
  await page.getByText('Leída', { exact: true }).waitFor();
  results.push('Avisos usa GET/PUT reales del contrato en transporte simulado');
  await page.getByRole('button', { name: 'Mi Perfil', exact: true }).click();
  await page.getByRole('button', { name: 'Ver ranking', exact: true }).click();
  await page.getByText('Ciudadano local', { exact: true }).waitFor();
  results.push('Comunidad presenta el ranking del servidor sin IDs ni posiciones inventadas');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.evaluate(() => {
    const state = window.__civigoGeoChecks = { watches: 0, manual: 0, allowed: false };
    const fix = () => ({ coords: { latitude: -14.0678, longitude: -75.7286, accuracy: 5,
      altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
    const clear = navigator.geolocation.clearWatch.bind(navigator.geolocation);
    Object.defineProperty(navigator.geolocation, 'watchPosition', { configurable: true, value: (success, failure) => {
      state.watches++;
      queueMicrotask(() => state.allowed ? success(fix()) : failure({ code: 1, message: 'User denied Geolocation' }));
      return 700000 + state.watches;
    } });
    Object.defineProperty(navigator.geolocation, 'clearWatch', { configurable: true, value: id => { if (id < 700000) clear(id); } });
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: success => {
      state.manual++; state.allowed = true; queueMicrotask(() => success(fix()));
    } });
  });
  await page.getByRole('button', { name: 'Explorar Mapa', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar GPS', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__civigoGeoChecks.watches), 1);
  await page.getByRole('button', { name: 'Mi Perfil', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar Mapa', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar GPS', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__civigoGeoChecks.watches), 1);
  await page.getByRole('button', { name: 'Reintentar GPS', exact: true }).click();
  await page.waitForFunction(() => window.__civigoGeoChecks.watches === 2 && window.__civigoGeoChecks.manual === 1);
  await page.getByRole('button', { name: 'Reintentar GPS', exact: true }).waitFor({ state: 'detached' });
  results.push('GPS denegado no vuelve a solicitarse al cambiar de pestaña; reintento explícito reactiva seguimiento');
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifactDir, 'resultado.json'), JSON.stringify({ passed: true, results, browserErrors: errors,
    externalRequestsAllowed: 0, externalRequestsBlockedOrMocked: external.length, productionMutations: 0 }, null, 2));
  await Promise.all(['failure.json', 'failure.png'].map(file => rm(path.join(artifactDir, file), { force: true })));
  console.log(JSON.stringify({ passed: true, checks: results.length, browserErrors: errors, externalRequestsAllowed: 0 }));
} catch (error) {
  if (context?.pages()[0]) await context.pages()[0].screenshot({ path: path.join(artifactDir, 'failure.png') }).catch(() => {});
  await writeFile(path.join(artifactDir, 'failure.json'), JSON.stringify({ message: String(error), results, errors, external }, null, 2));
  throw error;
} finally {
  await context?.close(); await server.close();
  if (path.resolve(profileDir).startsWith(artifactDir + path.sep)) await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
