// Local fixtures only: no requests to Railway, Firebase or OpenAI.
const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const local = path.join(__dirname, '../.local/electron-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
const archive = process.argv.includes('--package');
const { bootstrap } = require(archive ? path.join(__dirname, '../release/win-unpacked/resources/app.asar/electron/main.cjs') : '../electron/main.cjs');
const token = 'b'.repeat(64);
const actor = { id: 1, nickname: 'admin-fixture', nombres: 'Administrador', apellidos: 'Local', correo: 'admin@example.test', telefono: '+51900000001', correoVerificado: true, rol: 'ADMIN', premium: false, credibilidad: 100, monedas: 0, permisos: [], bloqueado: false };
const calls = [];
let backendLogin = false;
const server = http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  calls.push({ path: request.url, cookie: !!request.headers.cookie, origin: request.headers.origin });
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/users/login') {
    backendLogin = true;
    response.setHeader('Set-Cookie', `civigo_session=${token}; Path=/; HttpOnly; Expires=${new Date(Date.now() + 86400000).toUTCString()}`);
    const role = JSON.parse(body).correo.startsWith('citizen') ? 'USUARIO' : 'ADMIN';
    return response.end(JSON.stringify({ usuario: { ...actor, rol: role } }));
  }
  if (request.url === '/api/users/logout') { backendLogin = false; return response.end('{"ok":true}'); }
  if (!backendLogin || request.headers.cookie !== `civigo_session=${token}`) { response.statusCode = 401; return response.end('{"error":"Sesión requerida"}'); }
  if (request.url === '/api/users/me') return response.end(JSON.stringify({ usuario: actor }));
  if (request.url === '/api/admin') return response.end(JSON.stringify({ estadisticas: { usuarios: 2, incidentes: 0 }, servicios: { ia: { configurado: true }, correoGoogle: { configurado: true } } }));
  if (request.url === '/api/catalog') return response.end(JSON.stringify({ categorias: [], config: {}, distritos: ['Ica'] }));
  if (request.url === '/api/admin/catalog') return response.end('{"categorias":[]}');
  if (request.url === '/api/admin/integrations') return response.end(JSON.stringify({ proveedores: [], frontend: { variables: [], plataforma: 'Vercel', indicacion: 'Fixture local' }, navegacion: 'Fixture local', pagos: 'Demostración' }));
  if (request.url === '/api/admin/config') return response.end(JSON.stringify({ agrupacionMetros: 50, agrupacionHoras: 2, confirmacionMetros: 50, confirmaciones: 3, resoluciones: 5, influenciaVecina: 0.15, puntosReporte: 10, puntosConfirmacion: 5, puntosPrueba: 5, premiosRanking: [100, 75, 50, 30, 20, 10, 8, 6, 4, 2], anuncioMetros: 50, intervaloAnuncioMetros: 500, duracionAnuncioSegundos: 5, maxVideoBytes: 15 * 1024 * 1024 }));
  if (request.url === '/api/uploads/private-fixture') {
    response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Content-Disposition', 'inline; filename="identidad.pdf"');
    return response.end('%PDF-local-fixture');
  }
  return response.end('[]');
});
async function waitUntil(window, expression) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('La interfaz no alcanzó el estado esperado: ' + expression);
}
async function capture(window, name) {
  window.webContents.setBackgroundThrottling(false);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 100));
  await fs.writeFile(path.join(local, name), (await window.webContents.capturePage()).toPNG());
}
async function run() {
  await fs.mkdir(path.join(local, 'session'), { recursive: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.CIVIGO_DESKTOP_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.CIVIGO_DESKTOP_ORIGIN = 'https://civigo.online';
  const { window, client } = await bootstrap({ hidden: true });
  await waitUntil(window, 'document.body.innerText.includes("Administración de CiviGo")');
  await capture(window, 'login.png');
  assert.equal(window.isVisible(), false);
  const isolation = await window.webContents.executeJavaScript(`({ node: typeof require, process: typeof process, cookie: document.cookie, keys: Object.keys(window.civigoDesktop), url: location.href })`);
  assert.equal(isolation.node, 'undefined'); assert.equal(isolation.process, 'undefined'); assert.equal(isolation.cookie, '');
  assert.equal(isolation.url, 'civigo://app/index.html');
  assert.equal(isolation.keys.includes('ipcRenderer'), false);
  assert.equal(isolation.keys.includes('backendUrl'), false);
  await window.webContents.executeJavaScript(`window.__smokeErrors=[]; addEventListener('error',e=>window.__smokeErrors.push(e.message)); addEventListener('unhandledrejection',e=>window.__smokeErrors.push(String(e.reason)))`);
  const denied = await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'citizen@example.test', password:'fixture' })`);
  assert.equal(denied.ok, false); assert.equal(denied.error.status, 403);
  assert.equal(client.authenticated(), false);
  const logged = await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'admin@example.test', password:'fixture' })`);
  assert.equal(logged.ok, true); assert.equal(logged.data.rol, 'ADMIN');
  await waitUntil(window, 'document.body.innerText.includes("Centro de revisión")');
  const markup = await window.webContents.executeJavaScript('document.body.innerText');
  assert.equal(markup.includes('Categorías y tipos'), true);
  assert.equal(markup.includes('Verificar teléfonos'), false);
  assert.equal(markup.includes('Correo por código'), false);
  await capture(window, 'panel.png');
  const panels = [
    ['Incidentes', '/api/admin/incidents'], ['Apelaciones', '/api/admin/appeals'],
    ['Usuarios', '/api/admin/users'], ['Categorías y tipos', '/api/admin/catalog'],
    ['Negocios', '/api/admin/businesses'], ['Recompensas', '/api/admin/rewards'],
    ['Cierre de ranking', null], ['Recuperaciones', '/api/admin/recoveries'],
    ['Antecedentes', null], ['Configuración', '/api/admin/config'],
    ['Actividad y plazos', '/api/admin/audit'], ['Integraciones', '/api/admin/integrations'],
  ];
  for (const [label, endpoint] of panels) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    await waitUntil(window, `document.querySelector('nav button[aria-current="page"]')?.textContent===${JSON.stringify(label)} && !document.body.innerText.includes('Cargando')`);
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    if (endpoint) assert.equal(calls.some(call => call.path === endpoint), true, label + ' debe leer su API');
    assert.deepEqual(await window.webContents.executeJavaScript('window.__smokeErrors'), [], label + ' no debe fallar en React');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.notice-error').length`), 0, label + ' no debe mostrar un error');
  }
  assert.equal(await window.webContents.executeJavaScript(`document.cookie.includes('${token}')`), false);
  const blocked = await window.webContents.executeJavaScript(`window.civigoDesktop.request({route:'/users/register',method:'POST',body:'{}'})`);
  assert.equal(blocked.ok, false); assert.equal(blocked.error.status, 400);
  const savedPath = path.join(local, 'descarga-fixture.pdf');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedPath });
  const downloaded = await window.webContents.executeJavaScript(`window.civigoDesktop.download('private-fixture')`);
  assert.equal(downloaded.ok, true); assert.equal(downloaded.data.guardado, true);
  assert.equal(await fs.readFile(savedPath, 'utf8'), '%PDF-local-fixture');
  await fs.unlink(savedPath);
  let releaseSave; const waiting = new Promise(resolve => { releaseSave = resolve; });
  dialog.showSaveDialog = () => waiting;
  const previousDownload = window.webContents.executeJavaScript(`window.civigoDesktop.download('private-fixture')`);
  await waitUntil(window, 'true');
  await new Promise(resolve => setTimeout(resolve, 50));
  await window.webContents.executeJavaScript('window.civigoDesktop.logout()');
  await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'admin@example.test', password:'fixture' })`);
  releaseSave({ canceled: false, filePath: savedPath });
  const stale = await previousDownload;
  assert.equal(stale.ok, false); assert.equal(stale.error.status, 401);
  await assert.rejects(fs.access(savedPath));
  actor.rol = 'AGENTE';
  const demoted = await window.webContents.executeJavaScript('window.civigoDesktop.session()');
  assert.equal(demoted.ok, false); assert.equal(demoted.error.status, 403);
  await waitUntil(window, 'document.body.innerText.includes("Administración de CiviGo")');
  actor.rol = 'ADMIN';
  assert.equal(client.authenticated(), false);
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("admin-fixture")'), false);
  assert.equal(calls.filter(call => call.cookie).every(call => call.origin === 'https://civigo.online'), true);
  // CSP rejection must happen before an attempted remote network request.
  assert.equal(await window.webContents.executeJavaScript(`fetch('https://invalid.example.test').then(()=>false,()=>true)`), true);
  await fs.writeFile(path.join(local, archive ? 'package-smoke-result.json' : 'smoke-result.json'), JSON.stringify({ passed: true, packagedArchive: archive, calls: calls.length, panels: panels.length, isolation: { node: isolation.node, process: isolation.process, cookie: isolation.cookie }, authenticatedDownloads: true, logoutPreventsStaleDownload: true, revokedRoleRemovesPanel: true }, null, 2));
  window.destroy(); server.closeAllConnections(); server.close();
  console.log('Electron smoke: acceso ADMIN, interfaz local, IPC, adjuntos privados, CSP y cierre de sesión verificados.');
  app.exit(0);
}
run().catch(error => { console.error(error); server.closeAllConnections(); server.close(); app.exit(1); });
