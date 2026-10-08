/* eslint-disable @typescript-eslint/no-require-imports */
// Run with desktop/node_modules/electron/dist/electron.exe. All fixtures and
// browser requests stay on loopback; no Mapbox, account, or production API.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');

const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const origin = `http://127.0.0.1:${frontendPort}`;
const local = path.resolve(__dirname, '../.local/map-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
const windows = [];
const requests = [];
const blockedHosts = new Set();
const errors = [];
const stages = [];
let incidents = [];
let revision = 0;

const incident = {
  id: 912, tipo: 'Incendio', tipoNombre: 'Incendio', tipoSlug: 'incendio',
  descripcion: 'Incidente publicado desde el dispositivo A',
  latitud: -14.0678, longitud: -75.7286, estado: 'ACTIVO',
  nivelRiesgo: 2, gravedad: 2, totalReportes: 1, confirmaciones: 0,
  evaluacion: 'IA', publicado: true, emergencia: true, individual: false,
  fechaEvento: '2026-10-07T12:00:00Z', fechaCreacion: '2026-10-07T12:00:00Z',
  adjuntos: [],
};
const crimeFixtures = [
  { ...incident, id: 913, tipo: 'Robo', tipoNombre: 'Robo', tipoSlug: 'robo',
    descripcion: 'Robo reportado como antecedente', gravedad: 4, nivelRiesgo: 4,
    emergencia: false, historico: true, individual: true },
  { ...incident, id: 914, tipo: 'Hurto', tipoNombre: 'Hurto', tipoSlug: 'hurto',
    descripcion: 'Hurto reportado como antecedente', gravedad: 2, nivelRiesgo: 2,
    emergencia: false, historico: true, individual: true },
];
const catalog = {
  categorias: [
    { id: 1, nombre: 'Delitos y seguridad', slug: 'delitos-y-seguridad', tipos: [
      { id: 11, nombre: 'Robo', slug: 'robo', emergencia: false, historico: true, fotoObligatoria: true, individual: true, ubicacionRemota: true },
      { id: 12, nombre: 'Hurto', slug: 'hurto', emergencia: false, historico: true, fotoObligatoria: true, individual: true, ubicacionRemota: true },
    ] },
    { id: 2, nombre: 'Emergencias', slug: 'emergencias', tipos: [
      { id: 21, nombre: 'Incendio', slug: 'incendio', emergencia: true, historico: false, fotoObligatoria: false, individual: false, ubicacionRemota: false },
    ] },
  ], config: {}, distritos: ['Ica'],
};
const server = http.createServer((request, response) => {
  requests.push({ url: request.url, method: request.method, revision });
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/incidents') return response.end(JSON.stringify(incidents));
  if (/^\/api\/incidents\/\d+\/chat$/.test(request.url)) return response.end('[]');
  if (/^\/api\/incidents\/\d+$/.test(request.url)) {
    const id = Number(request.url.split('/').at(-1));
    return response.end(JSON.stringify(incidents.find(item => item.id === id) || incident));
  }
  if (request.url === '/api/navigation/roads') return response.end(JSON.stringify({ type: 'FeatureCollection', features: [] }));
  if (request.url === '/api/catalog') return response.end(JSON.stringify(catalog));
  if (request.url === '/api/users/me') {
    response.statusCode = 401;
    return response.end(JSON.stringify({ error: 'Sesión requerida' }));
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'No existe esta ruta en el fixture local' }));
});

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(window, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await window.webContents.executeJavaScript(expression)) return Date.now() - started;
    await delay(100);
  }
  const text = await window.webContents.executeJavaScript('document.body.innerText');
  throw new Error(`No se alcanzó: ${expression}\n${text.slice(0, 3000)}`);
}
async function both(expression, timeout) {
  return Promise.all(windows.map(window => waitUntil(window, expression, timeout)));
}
async function capture(window, name) {
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await delay(100);
  await fs.writeFile(path.join(local, name), (await window.webContents.capturePage()).toPNG());
}
async function panelState(window, selector, expanded) {
  await waitUntil(window, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const body = button && document.getElementById(button.getAttribute('aria-controls'));
    return button?.getAttribute('aria-expanded') === ${JSON.stringify(String(expanded))}
      && body?.hidden === ${!expanded} && (getComputedStyle(body).display !== 'none') === ${expanded};
  })()`);
}
async function togglePanel(window, selector) {
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function filterByName(window, name) {
  const value = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.map-frame .map-controls select');
    const option = Array.from(select.options).find(item => item.textContent === ${JSON.stringify(name)});
    if (!option) throw new Error('El filtro de mapa no contiene el tipo solicitado');
    select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
    return option.value;
  })()`);
  return value;
}
async function assertViewport(window, expectedWidth) {
  const geometry = await window.webContents.executeJavaScript(`(() => {
    const selectors = ['.map-frame', '.map-controls', '.risk-legend'];
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      rectangles: selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right };
      }) };
  })()`);
  assert.equal(geometry.width, expectedWidth);
  assert.ok(geometry.documentWidth <= geometry.width, 'La página no debe tener desbordamiento horizontal');
  for (const rect of geometry.rectangles) {
    assert.ok(rect.left >= 0 && rect.right <= geometry.width + 1, `Control fuera del ancho de pantalla: ${rect.selector}`);
  }
}
async function createClient(index, width, height) {
  const window = new BrowserWindow({
    show: false, width, height, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, partition: `map-live-fixture-${index}` },
  });
  windows.push(window);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      allowed = (url.origin === origin && ['http:', 'ws:'].includes(url.protocol))
        || (url.hostname === '127.0.0.1' && url.port === String(frontendPort) && url.protocol === 'ws:')
        || url.protocol === 'data:' || url.protocol === 'blob:';
      if (!allowed) blockedHosts.add(url.hostname || url.protocol);
    } catch { allowed = false; }
    callback({ cancel: !allowed });
  });
  window.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    if (mainFrame) requests.push({ client: index, navigation: url, inPlace });
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(`client ${index}: ${details.reason}`));
  await window.loadURL(`${origin}/mapa`);
  window.webContents.enableDeviceEmulation({
    screenPosition: index === 2 ? 'mobile' : 'desktop', screenSize: { width, height },
    viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 1, scale: 1,
  });
  await waitUntil(window, `innerWidth === ${width}`);
  assert.equal(window.isVisible(), false);
  // A hidden test window has a hidden document. Simulate a foreground browser
  // without showing a native window or changing the app's polling interval.
  await window.webContents.executeJavaScript(`
    window.__smokeVisible = true;
    window.__smokeOnline = true;
    window.__smokeErrors = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__smokeVisible ? 'visible' : 'hidden' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__smokeOnline });
    addEventListener('error', event => window.__smokeErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.__smokeErrors.push(String(event.reason)));
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await waitUntil(window, `document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
}
async function run() {
  await fs.mkdir(local, { recursive: true });
  server.listen(fixturePort, '127.0.0.1');
  await once(server, 'listening');
  await app.whenReady();
  await Promise.all([createClient(1, 1400, 1000), createClient(2, 390, 844)]);
  await capture(windows[1], 'mapa-vacio.png');
  stages.push({ test: 'Dos clientes independientes, inicialmente vacíos', passed: true });

  incidents = [{ ...incident }]; revision++;
  const publication = await both(`document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row')?.innerText.includes('Incidente publicado desde el dispositivo A')`);
  stages.push({ test: 'Publicación visible en ambos clientes sin recargar', passed: true, milliseconds: publication });
  const isolation = await windows[1].webContents.executeJavaScript(`({ require: typeof require, process: typeof process, rows: document.querySelectorAll('.incident-row').length })`);
  assert.equal(isolation.require, 'undefined'); assert.equal(isolation.process, 'undefined');

  incidents = [{ ...incident, gravedad: 4, nivelRiesgo: 4, descripcion: 'Gravedad actualizada desde otro dispositivo' }]; revision++;
  const update = await both(`document.querySelector('.incident-row')?.innerText.includes('Gravedad 4') && document.querySelector('.incident-row')?.innerText.includes('Gravedad actualizada desde otro dispositivo')`);
  stages.push({ test: 'Cambios de descripción y gravedad sincronizados', passed: true, milliseconds: update });
  await windows[1].webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(windows[1], `!!document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`);

  incidents = []; revision++;
  const resolution = await both(`document.querySelectorAll('.incident-row').length === 0 && document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
  await waitUntil(windows[1], `!document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`);
  stages.push({ test: 'Resolución retira el incidente y cierra su detalle', passed: true, milliseconds: resolution });

  await windows[1].webContents.executeJavaScript(`window.__smokeVisible = false; document.dispatchEvent(new Event('visibilitychange'));`);
  incidents = [{ ...incident, descripcion: 'Publicado mientras el segundo cliente estaba oculto' }]; revision++;
  await waitUntil(windows[0], `document.querySelector('.incident-row')?.innerText.includes('Publicado mientras el segundo cliente estaba oculto')`);
  await delay(1000);
  assert.equal(await windows[1].webContents.executeJavaScript(`document.querySelectorAll('.incident-row').length`), 0);
  await windows[1].webContents.executeJavaScript(`window.__smokeVisible = true; document.dispatchEvent(new Event('visibilitychange'));`);
  const foreground = await waitUntil(windows[1], `document.querySelector('.incident-row')?.innerText.includes('Publicado mientras el segundo cliente estaba oculto')`, 3000);
  stages.push({ test: 'Cliente oculto se actualiza al volver al primer plano', passed: true, milliseconds: foreground });

  await windows[1].webContents.executeJavaScript(`window.__smokeOnline = false; dispatchEvent(new Event('offline'));`);
  incidents = [{ ...incident, gravedad: 5, nivelRiesgo: 5, descripcion: 'Actualizado mientras el segundo cliente estaba sin conexión' }]; revision++;
  await waitUntil(windows[0], `document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`);
  assert.equal(await windows[1].webContents.executeJavaScript(`document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`), false);
  await windows[1].webContents.executeJavaScript(`window.__smokeOnline = true; dispatchEvent(new Event('online'));`);
  const reconnect = await waitUntil(windows[1], `document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`, 3000);
  stages.push({ test: 'Reconexión actualiza al segundo cliente inmediatamente', passed: true, milliseconds: reconnect });

  incidents = [{ ...incident }, ...crimeFixtures]; revision++;
  await both(`document.querySelectorAll('.incident-row').length === 3`);
  const controls = '.map-frame .map-controls > .panel-toggle';
  const legend = '.map-frame .risk-legend > .panel-toggle';
  for (const [index, window] of windows.entries()) {
    const viewport = index === 0 ? 'escritorio' : 'movil';
    const cleanPage = await window.webContents.executeJavaScript(`({
      largeHeading: !!document.querySelector('.map-heading'),
      pilot: /piloto|cobertura inicial/i.test(document.body.innerText),
      filterInMap: !!document.querySelector('.map-frame .map-controls select'),
      duplicateFilter: !!document.querySelector('#filter-type'),
    })`);
    assert.deepEqual(cleanPage, { largeHeading: false, pilot: false, filterInMap: true, duplicateFilter: false });
    await panelState(window, controls, false);
    await panelState(window, legend, false);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await window.webContents.executeJavaScript('window.scrollTo(0, 0)');
    await capture(window, `mapa-paneles-plegados-${viewport}.png`);

    await togglePanel(window, controls);
    await panelState(window, controls, true);
    const filter = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.map-frame .map-controls select');
      return { options: Array.from(select.options).map(option => option.textContent),
        groups: Array.from(select.querySelectorAll('optgroup')).map(group => group.label) };
    })()`);
    for (const name of ['Robo', 'Hurto', 'Incendio']) assert.ok(filter.options.includes(name), `${viewport}: falta ${name}`);
    for (const group of ['Delitos y seguridad', 'Emergencias']) assert.ok(filter.groups.includes(group));
    await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').click()`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').checked`), false);
    await togglePanel(window, controls);
    await panelState(window, controls, false);
    await togglePanel(window, controls);
    await panelState(window, controls, true);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').checked`), false);
    await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').click()`);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-filtros-${viewport}.png`);

    await togglePanel(window, legend);
    await panelState(window, legend, true);
    await panelState(window, controls, false);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-leyenda-${viewport}.png`);
    await togglePanel(window, legend);
    await panelState(window, legend, false);

    const routeSelector = '.map-route-panel > .panel-toggle';
    await panelState(window, routeSelector, true);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, false);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, true);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, false);
    const reportsSelector = '.map-reports-panel > .panel-toggle';
    await panelState(window, reportsSelector, true);
    await togglePanel(window, reportsSelector);
    await panelState(window, reportsSelector, false);
    await togglePanel(window, reportsSelector);
    await panelState(window, reportsSelector, true);
  }
  stages.push({ test: 'Paneles capas, leyenda y rutas se pliegan en escritorio y móvil; conservan controles y no desbordan', passed: true });
  stages.push({ test: 'Filtro agrupado con Robo, Hurto e Incendio dentro del mapa; cabecera grande y textos de piloto retirados', passed: true });

  const selectedValues = [];
  for (const window of windows) {
    await togglePanel(window, controls);
    await panelState(window, controls, true);
    selectedValues.push(await filterByName(window, 'Hurto'));
    await waitUntil(window, `document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Hurto'`);
    selectedValues[selectedValues.length - 1] = await filterByName(window, 'Robo');
    await waitUntil(window, `document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Robo'`);
  }
  stages.push({ test: 'Seleccionar Hurto o Robo filtra los reportes de ambos clientes', passed: true });
  incidents = [...incidents, { ...crimeFixtures[0], id: 915, descripcion: 'Segundo robo publicado mientras el filtro está activo' }]; revision++;
  await both(`document.querySelectorAll('.incident-row').length === 2 && Array.from(document.querySelectorAll('.incident-row strong')).every(item => item.textContent === 'Robo') && Array.from(document.querySelectorAll('.incident-row')).some(item => item.innerText.includes('Segundo robo publicado mientras el filtro está activo'))`);
  for (const [index, window] of windows.entries()) {
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls select').value`), selectedValues[index]);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-robo-filtrado-${index === 0 ? 'escritorio' : 'movil'}.png`);
  }
  stages.push({ test: 'Nuevos reportes respetan el filtro elegido después del refresco automático', passed: true });

  incidents = [...incidents, { ...incident, id: 916, tipo: 'Alerta vecinal', tipoNombre: 'Alerta vecinal', tipoSlug: 'alerta-vecinal', descripcion: 'Tipo observado fuera del catálogo' }]; revision++;
  await both(`Array.from(document.querySelector('.map-controls select').options).some(option => option.textContent === 'Alerta vecinal')`);
  const observedValues = [];
  for (const window of windows) observedValues.push(await filterByName(window, 'Alerta vecinal'));
  await both(`document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Alerta vecinal'`);
  incidents = incidents.filter(item => item.id !== 916); revision++;
  await both(`document.querySelectorAll('.incident-row').length === 0 && document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
  for (const [index, window] of windows.entries()) {
    const selected = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.map-controls select');
      return { value: select.value, name: select.selectedOptions[0]?.textContent };
    })()`);
    assert.deepEqual(selected, { value: observedValues[index], name: 'Alerta vecinal' });
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.map-controls button')).find(button => button.textContent.trim() === 'Quitar filtro').click()`);
    await waitUntil(window, `document.querySelector('.map-controls select').value === '' && document.querySelectorAll('.incident-row').length === 4`);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-todos-${index === 0 ? 'escritorio' : 'movil'}.png`);
  }
  stages.push({ test: 'Un tipo fuera del catálogo conserva su filtro al retirar el último reporte; Quitar filtro restaura Todos', passed: true });

  await windows[0].webContents.executeJavaScript(`document.querySelector('button[aria-label="Cambiar a modo claro"]')?.click()`);
  await waitUntil(windows[0], `!!document.querySelector('button[aria-label="Cambiar a modo oscuro"]')`);
  await windows[0].webContents.executeJavaScript(`document.querySelector('button[aria-label="Cambiar a modo oscuro"]').click()`);
  await waitUntil(windows[0], `document.documentElement.dataset.theme === 'dark' && !!document.querySelector('button[aria-label="Cambiar a modo claro"][aria-pressed="true"]')`);
  await assertViewport(windows[0], 1400);
  await windows[0].webContents.executeJavaScript('window.scrollTo(0, 0)');
  await capture(windows[0], 'mapa-filtros-oscuro-escritorio.png');
  await togglePanel(windows[0], legend);
  await panelState(windows[0], legend, true);
  await capture(windows[0], 'mapa-leyenda-oscuro-escritorio.png');
  stages.push({ test: 'Modo oscuro se activa desde ThemeToggle y mantiene controles dentro de pantalla', passed: true });

  for (const [index, window] of windows.entries()) {
    assert.deepEqual(await window.webContents.executeJavaScript(`window.__smokeErrors`), [], `Errores de React en cliente ${index + 1}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual([...blockedHosts], []);
  assert.equal(requests.filter(request => request.navigation && !request.inPlace).length, 2, 'Cada cliente debe cargar el documento una sola vez');
  assert.ok(requests.some(request => request.url === '/api/navigation/roads' && request.revision >= 4), 'La capa vial también debe actualizarse');
  await capture(windows[1], 'mapa-sincronizado.png');
  stages.push({ test: 'Sin recargas, errores de React, ni peticiones externas; capa vial actualizada', passed: true });
  const result = { passed: true, stages, incidentRequests: requests.filter(request => request.url === '/api/incidents').length,
    roadRequests: requests.filter(request => request.url === '/api/navigation/roads').length,
    limitation: 'Token de Mapbox vacío: se verifica la lista y el detalle React; no se solicita cartografía externa.' };
  await fs.writeFile(path.join(local, 'resultado.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
run().then(() => app.exit(0)).catch(async error => {
  console.error(error.stack || String(error));
  await fs.writeFile(path.join(local, 'fallo.json'), JSON.stringify({ error: String(error), stages, navigations: requests.filter(request => request.navigation) }, null, 2));
  app.exit(1);
}).finally(() => {
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
});
