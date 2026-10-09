/* eslint-disable @typescript-eslint/no-require-imports */
// Run with the bundled desktop Electron while Next listens on the frontend port.
// All accounts, incidents and API responses are local fixtures; no external API.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const origin = `http://127.0.0.1:${frontendPort}`;
const local = path.resolve(__dirname, '../.local/incident-panel-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
const fixture = {
  id: 700001, tipo: 'Incendio', tipoNombre: 'Incendio', tipoSlug: 'incendio',
  descripcion: 'Detalle disponible sólo en la consulta cercana',
  latitud: -14.0678, longitud: -75.7286, estado: 'ACTIVO',
  gravedad: 2, nivelRiesgo: 2, publicado: true, totalReportes: 1,
  confirmaciones: 0, evaluacion: 'IA', adjuntos: [],
  fechaCreacion: '2026-10-08T12:00:00Z',
};
let mode = 'visible';
const requests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({url: request.url, mode});
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/incidents') return response.end(JSON.stringify(url.searchParams.has('latitud') ? [fixture] : []));
  if (url.pathname === `/api/incidents/${fixture.id}/chat`) return response.end('[]');
  if (url.pathname === `/api/incidents/${fixture.id}`) {
    const requestedMode = mode;
    if (requestedMode === 'unavailable') { response.statusCode = 503; return response.end('{"error":"Servicio temporalmente no disponible"}'); }
    if (requestedMode === 'missing' || requestedMode === 'late-missing') {
      const removed = () => { response.statusCode = 404; response.end('{"error":"Incidente no disponible"}'); };
      if (requestedMode === 'late-missing') { setTimeout(removed, 1200); return; }
      return removed();
    }
    return response.end(JSON.stringify(requestedMode === 'owner' ? {...fixture, publicado:false, estado:'RETIRADO', descripcion:'Autor autorizado: incidente retirado'} : fixture));
  }
  if (url.pathname === '/api/users/me') return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario prueba',correo:'fixture@example.invalid',correoVerificado:true,rol:'USUARIO',premium:false,credibilidad:100}}));
  if (url.pathname === '/api/catalog') return response.end(JSON.stringify({categorias:[],config:{},distritos:['Ica']}));
  if (url.pathname === '/api/navigation/roads') return response.end('{"type":"FeatureCollection","features":[]}');
  if (url.pathname === '/api/navigation/traffic/status') return response.end('{"configurado":false,"habilitado":false}');
  if (url.pathname === '/api/navigation/traffic/incidents') return response.end('{"incidentes":[],"trafico":{"disponible":false}}');
  if (['/api/announcements','/api/navigation/favorites','/api/navigation/history','/api/businesses'].includes(url.pathname)) return response.end('[]');
  response.statusCode = 404;
  response.end('{"error":"Ruta no incluida en el fixture local"}');
});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(window, expression, timeout = 20000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`No se cumplió: ${expression}`);
}
async function run() {
  server.listen(fixturePort, '127.0.0.1');
  await once(server, 'listening');
  await app.whenReady();
  const window = new BrowserWindow({show:false,width:390,height:844,useContentSize:true,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'incident-detail-fixture'}});
  const blockedHosts = new Set();
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details,callback) => {
    const url = new URL(details.url);
    const allowed = (url.hostname === '127.0.0.1' && url.port === String(frontendPort) && ['http:','ws:'].includes(url.protocol)) || ['data:','blob:'].includes(url.protocol);
    if (!allowed) blockedHosts.add(url.hostname || url.protocol);
    callback({cancel:!allowed});
  });
  await window.loadURL(`${origin}/mapa`);
  assert.equal(window.isVisible(), false);
  await waitUntil(window, `!!document.querySelector('.nearby-location-notice button')`);
  await window.webContents.executeJavaScript(`
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = (callback,milliseconds,...args) => nativeInterval(callback,milliseconds === 15000 ? 400 : milliseconds,...args);
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(ok){setTimeout(()=>ok({coords:{latitude:-14.0678,longitude:-75.7286,accuracy:10},timestamp:Date.now()}),0);return 1;},clearWatch(){},
    }});
    document.querySelector('.nearby-location-notice button').click();
  `);
  await waitUntil(window, `!!document.querySelector('.incident-row')`);
  await waitUntil(window, `Array.from(document.querySelector('.map-controls select').options).some(option=>option.textContent==='Incendio')`);
  assert.ok(requests.some(request => request.url === '/api/incidents'), 'El listado general está vacío y no conoce este incidente');
  const dialog = `document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`;
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window, `${dialog}?.textContent.includes('Detalle disponible sólo')`);
  mode = 'unavailable';
  await waitUntil(window, `${dialog}?.textContent.includes('No se pudo actualizar el detalle.')`);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.textContent.includes('Detalle disponible sólo')`),true,'Un 503 conserva el detalle anterior');
  mode = 'owner';
  await waitUntil(window, `${dialog}?.textContent.includes('No visible en el mapa') && ${dialog}?.textContent.includes('Autor autorizado: incidente retirado')`);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.textContent.includes('No se pudo actualizar el detalle.')`),false,'Una respuesta 200 actualiza el estado real y limpia el aviso transitorio');
  mode = 'missing';
  await waitUntil(window, `!${dialog}`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.incident-row')`),true,'El cierre depende del 404 del detalle y no del listado cercano');
  mode = 'late-missing';
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window, `!!${dialog}`);
  const delayedRequestLimit = Date.now() + 10000;
  while (!requests.some(request => request.url === `/api/incidents/${fixture.id}` && request.mode === 'late-missing') && Date.now() < delayedRequestLimit) await delay(20);
  assert.ok(requests.some(request => request.url === `/api/incidents/${fixture.id}` && request.mode === 'late-missing'), 'El panel inicia la lectura retrasada');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').click()`);
  mode = 'visible';
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window, `${dialog}?.textContent.includes('Detalle disponible sólo')`);
  await delay(1500);
  assert.equal(await window.webContents.executeJavaScript(`!!${dialog}`),true,'Un 404 tardío del panel desmontado no cierra el nuevo panel');
  const result = {passed:true,scenarios:['Incidente cercano ausente del listado general','503 conserva detalle y muestra aviso','200 privado autorizado actualiza estado','404 cierra modal','Respuesta tardía después de desmontar ignorada'],blockedHosts:[...blockedHosts],requests:requests.length};
  await fs.writeFile(path.join(local,'resultado.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  window.destroy();
  server.close();
  app.exit(0);
}
run().catch(async error => {
  console.error(error.stack || error);
  await fs.writeFile(path.join(local,'error.txt'),String(error.stack || error));
  server.close();
  app.exit(1);
});
