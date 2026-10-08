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
if (archive) assert.equal(require('../release/win-unpacked/resources/app.asar/package.json').version, require('../package.json').version);
const { bootstrap } = require(archive ? path.join(__dirname, '../release/win-unpacked/resources/app.asar/electron/main.cjs') : '../electron/main.cjs');
const token = 'b'.repeat(64);
const actor = { id: 1, nickname: 'admin-fixture', nombres: 'Administrador', apellidos: 'Local', correo: 'admin@example.test', telefono: '+51900000001', correoVerificado: true, rol: 'ADMIN', premium: false, credibilidad: 100, monedas: 0, permisos: [], bloqueado: false };
const calls = [];
const managedUsers = Array.from({ length: 24 }, (_, index) => ({ ...actor, id: 100 + index, nickname: `vecino-fixture-${index}`, correo: `vecino${index}@gmail.com`, rol: 'USUARIO', correoVerificado: false, credibilidad: null, faltas: 0 }));
const incidentFixture = { id: 15, tipo: 'Bache', tipoNombre: 'Bache', descripcion: 'Incidente de prueba local', estado: 'ACTIVO', nivelRiesgo: 2, individual: false, publicado: true, validacion: 0.5, evaluacion: 'IA', fechaCreacion: '2026-01-01T12:00:00Z', fechaEvento: '2026-01-01T12:00:00Z', totalReportes: 1, reportes: [{ id: 8, descripcion: 'Adjunto de prueba', estado: 'EN_REVISION', fechaCreacion: '2026-01-01T12:00:00Z', adjuntos: [{ id: 'private-fixture', nombre: 'prueba.pdf', mimeType: 'application/pdf', privado: true }] }] };
const incidentFixtures = [incidentFixture, ...Array.from({ length: 23 }, (_, index) => ({ ...incidentFixture, id: 150 + index }))];
const recoveryFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 9 + index, usuario: { nickname: `fixture-${index}`, correo: `fixture${index}@gmail.com` }, telefonoNuevo: '+51912345678', motivo: 'Documento de prueba local', adjuntoId: 'private-fixture', estado: 'PENDIENTE', creadoEn: '2026-01-01T12:00:00Z' }));
const appealFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 7 + index, usuario: { nickname: `fixture-${index}` }, reporte: { id: 8 + index, tipo: 'Bache', estado: 'FALSO' }, motivo: 'Solicito revisión del caso de prueba local.', estado: 'PENDIENTE', creadoEn: '2026-01-01T12:00:00Z' }));
const businessFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 10 + index, nombre: `Negocio de prueba ${index}`, descripcion: 'Comercio ficticio local', direccion: 'Dirección de prueba', horario: '', sitioWeb: '', telefono: '', latitud: -14.0678, longitud: -75.7286, activo: true, visualizaciones: 0 }));
const announcementFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 50 + index, tipo: 'NOVEDAD', titulo: `Novedad de prueba ${index}`, mensaje: 'Texto público local', enlace: null, negocioId: null, activo: true, orden: index, inicio: null, fin: null }));
const trafficFixtures = [{ id: 'tomtom:tt_fixture', externoId: 'tt_fixture', fuente: 'TOMTOM', tipo: 'Cierre', titulo: 'Cierre de prueba', descripcion: 'Aviso vial ficticio', latitud: -14.06, longitud: -75.72, inicio: null, fin: null }];
const moderationFixtures = [];
const rewardFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 20 + index, nombre: `Cupón de prueba ${index}`, descripcion: 'Recompensa de demostración local', costoMonedas: 50, stock: 1, activo: true }));
const categories = [{ id: 1, nombre: 'Infraestructura', slug: 'infraestructura', orden: 1, tipos: Array.from({ length: 24 }, (_, index) => ({ id: 30 + index, nombre: `Bache de prueba ${index}`, slug: `bache-fixture-${index}`, categoriaId: 1, emergencia: false, historico: false, fotoObligatoria: false, individual: false, ubicacionRemota: false, persistente: true, activo: true })) }];
let backendLogin = false;
const server = http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  calls.push({ path: request.url, method: request.method, cookie: !!request.headers.cookie, origin: request.headers.origin, ...(body && request.headers['content-type']?.includes('application/json') ? { body: JSON.parse(body) } : {}) });
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
  if (request.url === '/api/admin/users' && request.method === 'POST') {
    const value = JSON.parse(body);
    const created = { id: 2, ...value, password: undefined, premium: false, bloqueado: false, monedas: 0, credibilidad: null, faltas: 0 };
    managedUsers.unshift(created);
    response.statusCode = 201;
    return response.end(JSON.stringify({ usuario: created }));
  }
  if (request.url === '/api/admin/users/2' && request.method === 'PATCH') {
    Object.assign(managedUsers[0], JSON.parse(body));
    return response.end(JSON.stringify({ usuario: managedUsers[0] }));
  }
  if (request.url === '/api/admin/users') return response.end(JSON.stringify(managedUsers));
  if (request.url === '/api/admin/incidents') return response.end(JSON.stringify(incidentFixtures));
  if (request.url === '/api/admin/recoveries') return response.end(JSON.stringify(recoveryFixtures));
  if (request.url === '/api/admin/appeals') return response.end(JSON.stringify(appealFixtures));
  if (request.url === '/api/admin/businesses') return response.end(JSON.stringify(businessFixtures));
  if (request.url === '/api/announcements/manage' && request.method === 'POST') {
    const value = { ...JSON.parse(body), id: 90 }; announcementFixtures.unshift(value); response.statusCode = 201;
    return response.end(JSON.stringify(value));
  }
  if (request.url === '/api/announcements/manage/90' && request.method === 'PATCH') {
    Object.assign(announcementFixtures[0], JSON.parse(body)); return response.end(JSON.stringify(announcementFixtures[0]));
  }
  if (request.url === '/api/announcements/manage/90' && request.method === 'DELETE') {
    announcementFixtures.shift(); return response.end('{"eliminado":true}');
  }
  if (request.url === '/api/announcements/manage') return response.end(JSON.stringify(announcementFixtures));
  if (request.url === '/api/navigation/traffic/incidents') return response.end(JSON.stringify({ incidentes: trafficFixtures.filter(row => !moderationFixtures.some(saved => saved.externoId === row.externoId && saved.oculto)), trafico: { disponible: true } }));
  if (request.url === '/api/announcements/traffic-moderation' && request.method === 'POST') {
    const value = JSON.parse(body), previous = moderationFixtures.find(row => row.externoId === value.externoId);
    if (previous) Object.assign(previous, value); else moderationFixtures.push({ id: 1, proveedor: 'TOMTOM', usuarioId: 1, ...value, actualizadoEn: new Date().toISOString() });
    return response.end(JSON.stringify(previous ?? moderationFixtures[0]));
  }
  if (request.url === '/api/announcements/traffic-moderation') return response.end(JSON.stringify(moderationFixtures));
  if (request.url === '/api/admin/rewards') return response.end(JSON.stringify(rewardFixtures));
  if (request.url === '/api/admin') return response.end(JSON.stringify({ estadisticas: { usuarios: 2, incidentes: 0 }, servicios: { ia: { configurado: true }, correoGoogle: { configurado: true } } }));
  if (request.url === '/api/catalog') return response.end(JSON.stringify({ categorias: categories, config: {}, distritos: ['Ica'] }));
  if (request.url === '/api/admin/catalog') return response.end(JSON.stringify({ categorias: categories }));
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
async function openEditor(window, buttonLabel, index = 0) {
  await waitUntil(window, `Array.from(document.querySelectorAll('button')).filter(button => button.textContent === ${JSON.stringify(buttonLabel)}).length > ${index}`);
  await window.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('button')).filter(button => button.textContent === ${JSON.stringify(buttonLabel)})[${index}];
    button.scrollIntoView({ block: 'center' });
    button.focus({ preventScroll: true });
    button.click();
  })()`);
  await waitUntil(window, `(() => {
    const editor = document.activeElement;
    if (!editor?.matches('.editor-panel')) return false;
    const bounds = editor.getBoundingClientRect();
    const header = document.querySelector('.desktop-header').getBoundingClientRect();
    const title = editor.querySelector('h2')?.getBoundingClientRect();
    return bounds.top >= header.bottom && bounds.top < innerHeight - 60 && title && title.top >= header.bottom && title.bottom <= innerHeight;
  })()`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.getAttribute('role')`), 'region');
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
  await waitUntil(window, '!document.body.innerText.includes("Cargando")');
  const markup = await window.webContents.executeJavaScript('document.body.innerText');
  assert.equal(markup.includes('Categorías y tipos'), true);
  assert.equal(markup.includes('Verificar teléfonos'), false);
  assert.equal(markup.includes('Correo por código'), false);
  await capture(window, 'panel.png');
  const panels = [
    ['Incidentes', '/api/admin/incidents'], ['Apelaciones', '/api/admin/appeals'],
    ['Usuarios', '/api/admin/users'], ['Categorías y tipos', '/api/admin/catalog'],
    ['Negocios', '/api/admin/businesses'], ['Recompensas', '/api/admin/rewards'],
    ['Anuncios y novedades', '/api/announcements/manage'], ['Avisos de tráfico', '/api/navigation/traffic/incidents'],
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
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Anuncios y novedades').click()`);
  await waitUntil(window, `!document.body.innerText.includes('Cargando')`);
  await openEditor(window, 'Crear anuncio');
  await window.webContents.executeJavaScript(`(() => {
    const fields = Array.from(document.querySelectorAll('.editor-panel input'));
    const set = (field, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value); field.dispatchEvent(new Event('input',{bubbles:true})); };
    set(fields.find(field=>field.type==='text'), 'Anuncio guardado desde la prueba');
    const dates = fields.filter(field=>field.type==='datetime-local');
    set(dates[0], '2026-10-08T20:08'); set(dates[1], '2026-10-09T20:08');
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('Anuncio guardado. Se mostrará')`);
  const announcementCreation = calls.find(call => call.path === '/api/announcements/manage' && call.method === 'POST');
  assert.equal(announcementCreation.body.inicio, '2026-10-09T01:08:00.000Z');
  assert.equal(announcementCreation.body.fin, '2026-10-10T01:08:00.000Z');
  await openEditor(window, 'Editar');
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('.editor-panel input[type="number"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'2'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('Anuncio guardado. Se mostrará') && !document.querySelector('.editor-panel')`);
  assert.equal(calls.find(call => call.path === '/api/announcements/manage/90' && call.method === 'PATCH').body.orden, 2);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Eliminar').click()`);
  await waitUntil(window, `document.body.innerText.includes('Confirmar eliminación')`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Confirmar eliminación').click()`);
  await waitUntil(window, `document.body.innerText.includes('Anuncio eliminado.')`);
  assert.equal(calls.some(call => call.path === '/api/announcements/manage/90' && call.method === 'DELETE'), true);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Avisos de tráfico').click()`);
  await waitUntil(window, `!document.body.innerText.includes('Cargando')`);
  await openEditor(window, 'Ocultar aviso');
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('.editor-panel textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'La vía ya está habilitada en esta prueba local.'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('Aviso ocultado en CiviGo.')`);
  await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Restaurar aviso')`);
  await openEditor(window, 'Restaurar aviso');
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('.editor-panel textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'El aviso vuelve a estar vigente en la prueba local.'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('Aviso restaurado.')`);
  const decisions = calls.filter(call => call.path === '/api/announcements/traffic-moderation' && call.method === 'POST');
  assert.deepEqual(decisions.map(call => call.body.oculto), [true, false]);
  const blocked = await window.webContents.executeJavaScript(`window.civigoDesktop.request({route:'/users/register',method:'POST',body:'{}'})`);
  assert.equal(blocked.ok, false); assert.equal(blocked.error.status, 400);
  const savedPath = path.join(local, 'descarga-fixture.pdf');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedPath });
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Usuarios').click()`);
  await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Crear usuario')`);
  await waitUntil(window, `Array.from(document.querySelectorAll('button')).filter(button=>button.textContent==='Administrar').length === 24`);
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(button=>button.textContent==='Administrar').length`), 24);
  await openEditor(window, 'Crear usuario');
  await openEditor(window, 'Crear usuario');
  await waitUntil(window, `!!document.querySelector('input[name="password"]')`);
  await window.webContents.executeJavaScript(`(() => {
    const fields = { nombres:'Ana', apellidos:'Ejemplo', nickname:'ana_smoke', correo:'ana.smoke@gmail.com', telefono:'+51912345678', fechaNacimiento:'1990-01-01', password:'smoke-fixture-password' };
    for (const [name,value] of Object.entries(fields)) document.querySelector('input[name="'+name+'"]').value=value;
    document.querySelector('input[name="correoVerificado"]').click();
  })()`);
  await waitUntil(window, `!!document.querySelector('textarea[name="motivoVerificacion"]')`);
  await window.webContents.executeJavaScript(`(() => {
    const field=document.querySelector('textarea[name="motivoVerificacion"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Titular comprobado por el administrador de la prueba.');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await capture(window, 'crear-usuario.png');
  await window.webContents.executeJavaScript(`document.querySelector('input[name="password"]').form.requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('La cuenta se creó')`);
  const creation = calls.find(call => call.path === '/api/admin/users' && call.method === 'POST');
  assert.equal(creation.body.correoVerificado, true);
  assert.equal(creation.body.nickname, 'ana_smoke');
  assert.equal(creation.body.motivoVerificacion.length >= 10, true);
  await openEditor(window, 'Administrar');
  await openEditor(window, 'Administrar');
  await waitUntil(window, `!!document.querySelector('input[name="correoVerificado"]')`);
  await window.webContents.executeJavaScript(`document.querySelector('input[name="correoVerificado"]').click()`);
  await waitUntil(window, `!!document.querySelector('textarea[name="motivoVerificacion"]')`);
  await window.webContents.executeJavaScript(`(() => {
    const field=document.querySelector('textarea[name="motivoVerificacion"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Se revoca la comprobación para esta prueba local.');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('input[name="correoVerificado"]').form.requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('La cuenta y sus permisos se actualizaron.')`);
  assert.equal(calls.find(call => call.path === '/api/admin/users/2' && call.method === 'PATCH').body.correoVerificado, false);
  await openEditor(window, 'Administrar', 1);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.getAttribute('aria-label')`), 'Administrar usuario vecino-fixture-0');
  await openEditor(window, 'Administrar', 2);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.getAttribute('aria-label')`), 'Administrar usuario vecino-fixture-1');
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel button[type="button"]').click()`);
  await waitUntil(window, `!document.querySelector('.editor-panel')`);
  for (const [tab, button] of [['Apelaciones', 'Revisar apelación'], ['Negocios', 'Registrar negocio'], ['Recompensas', 'Crear recompensa'], ['Categorías y tipos', 'Editar reglas'], ['Recuperaciones', 'Aprobar cambio']]) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button => button.textContent === ${JSON.stringify(tab)}).click()`);
    await waitUntil(window, `!document.body.innerText.includes('Cargando')`);
    await openEditor(window, button);
    assert.deepEqual(await window.webContents.executeJavaScript('window.__smokeErrors'), [], tab + ' abre su editor sin fallar en React');
  }
  for (const panel of ['Incidentes', 'Recuperaciones']) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent===${JSON.stringify(panel)}).click()`);
    await waitUntil(window, `!document.body.innerText.includes('Cargando')`);
    if (panel === 'Incidentes') {
      await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Revisar')`);
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(button => button.textContent === 'Revisar').length`), 24);
      await openEditor(window, 'Revisar');
      await openEditor(window, 'Revisar');
    }
    await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(button=>button.textContent?.startsWith('Descargar '))`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent?.startsWith('Descargar ')).click()`);
    await waitUntil(window, `document.body.innerText.includes('Archivo guardado.')`);
    assert.equal(await fs.readFile(savedPath, 'utf8'), '%PDF-local-fixture');
    await fs.unlink(savedPath);
  }
  assert.deepEqual(await window.webContents.executeJavaScript('window.__smokeErrors'), []);
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
  await fs.writeFile(path.join(local, archive ? 'package-smoke-result.json' : 'smoke-result.json'), JSON.stringify({ passed: true, packagedArchive: archive, calls: calls.length, panels: panels.length, isolation: { node: isolation.node, process: isolation.process, cookie: isolation.cookie }, createUserFromPanel: true, auditedEmailVerificationFromPanel: true, downloadFromIncidentAndRecoveryPanels: true, authenticatedDownloads: true, logoutPreventsStaleDownload: true, revokedRoleRemovesPanel: true }, null, 2));
  window.destroy(); server.closeAllConnections(); server.close();
  console.log('Electron smoke: acceso ADMIN, interfaz local, IPC, adjuntos privados, CSP y cierre de sesión verificados.');
  app.exit(0);
}
run().catch(error => { console.error(error); server.closeAllConnections(); server.close(); app.exit(1); });
