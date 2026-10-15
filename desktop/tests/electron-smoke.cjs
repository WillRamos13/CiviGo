// Local fixtures only: no requests to Railway, Firebase or OpenAI.
const { app, dialog, shell } = require('electron');
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
const packageRoot = path.resolve(__dirname, '..', process.env.CIVIGO_DESKTOP_PACKAGE_DIR || 'release/win-unpacked');
const packageArchive = path.join(packageRoot, 'resources/app.asar');
if (archive) assert.equal(require(path.join(packageArchive, 'package.json')).version, require('../package.json').version);
const { bootstrap } = require(archive ? path.join(packageArchive, 'electron/main.cjs') : '../electron/main.cjs');
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
const advertisingImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW9sAAAAASUVORK5CYII=', 'base64');
const advertisingFiles = new Map();
let advertisingUploadSequence = 0;
const trafficFixtures = [{ id: 'tomtom:tt_fixture', externoId: 'tt_fixture', fuente: 'TOMTOM', tipo: 'Cierre', titulo: 'Cierre de prueba', descripcion: 'Aviso vial ficticio', latitud: -14.06, longitud: -75.72, inicio: null, fin: null }];
const moderationFixtures = [];
const rewardFixtures = Array.from({ length: 24 }, (_, index) => ({ id: 20 + index, nombre: `Cupón de prueba ${index}`, descripcion: 'Recompensa de demostración local', costoMonedas: 50, stock: 1, activo: true }));
const categories = [{ id: 1, nombre: 'Infraestructura', slug: 'infraestructura', orden: 1, tipos: Array.from({ length: 24 }, (_, index) => ({ id: 30 + index, nombre: `Bache de prueba ${index}`, slug: `bache-fixture-${index}`, categoriaId: 1, emergencia: false, historico: false, fotoObligatoria: false, individual: false, ubicacionRemota: false, persistente: true, activo: true })) }];
const notificationFixtures = [{ id: 1, titulo: 'Emergencia pendiente', mensaje: 'Revisar incidente #15.', tipo: 'REVISION', incidenteId: 15, leida: false, creadoEn: '2026-01-01T12:00:00Z' }];
const auditFixtures = Array.from({ length: 61 }, (_, index) => ({ id: index + 1, usuarioId: 1, accion: 'VALIDAR', entidad: 'INCIDENTE', entidadId: String(index + 1), creadoEn: '2026-01-01T12:00:00Z' }));
auditFixtures[0] = { ...auditFixtures[0], accion: 'EVALUACION_IA_REPORTE', entidad: 'REPORTE', datos: { origenImagenes: { habilitado: true, requiereRevision: true, evidencias: [{ adjuntoId: 'photo-fixture', resultado: 'COINCIDENCIA_WEB', motivo: 'Coincidencia de prueba local pendiente de revisión.', coincidencias: [{ tipo: 'PARCIAL', url: 'https://photos.example.com/image.jpg' }, { tipo: 'COMPLETA', url: 'https://localhost/private.jpg' }], paginas: ['https://news.example.com/article'] }] } } };
let groupingMeters = 50;
let backendLogin = false;
let statisticsUnavailable = false;
let denySessionWithoutJson = false;
function statisticsFixture(url) {
  const selectedType = url.searchParams.get('type');
  const selectedDistrict = url.searchParams.get('district');
  const bache = selectedType?.startsWith('bache');
  const amount = selectedDistrict ? selectedType ? 150 : 300 : selectedType ? bache ? 300 : 250 : 550;
  const security = bache ? 0 : selectedDistrict ? 150 : 250;
  return { generatedAt: '2026-10-13T18:00:00.000Z', timeZone: 'America/Lima', filters: {}, totals: {incidents:amount,reports:amount,accounts:5,published:amount,active:amount,validated:amount,resolved:0,verifiedAccounts:5,securityIncidents:security}, incidentComparison:{current:50,previousSameDays:25,previousFullMonth:40,deltaPercent:100}, crimeComparison:{current:bache?0:50,previousSameDays:bache?0:25,previousFullMonth:bache?0:40,deltaPercent:bache?null:100}, datasets:{types:selectedType?[{key:selectedType,label:'Bache',count:amount}]:[{key:'bache',label:'Bache',count:300},{key:'robo',label:'Robo',count:250}],districts:[{key:'Ica',label:'Ica',count:amount}],statuses:[{key:'VALIDADO',label:'VALIDADO',count:amount}],severities:[{key:'2',label:'Nivel 2',count:amount}],timeline:Array.from({length:6},(_,index)=>({month:`2026-${String(index+5).padStart(2,'0')}`,label:['may.','jun.','jul.','ago.','set.','oct.'][index],incidents:index===5?50:100,reports:index===5?50:100,crimes:index===5?50:40})),accounts:[{role:'ADMIN',count:4,verified:4,unverified:0},{role:'AGENTE',count:1,verified:1,unverified:0}]} };
}
function exportFixture(url) {
  const table = url.searchParams.get('table'), offset=Number(url.searchParams.get('cursor')||0);
  const count=table==='usuarios'?5:table==='catalogo'?24:table==='estadisticas'?9:550;
  const columns=table==='estadisticas'?[{key:'grupo',label:'Grupo',type:'string'},{key:'cantidad',label:'Cantidad',type:'number'}]:[{key:'id',label:'ID',type:'number'},{key:table==='usuarios'?'correo':table==='catalogo'?'nombre':'descripcion',label:'Descripción',type:'string'}];
  const rows=Array.from({length:count},(_,index)=>table==='estadisticas'?{grupo:'grupo-'+index,cantidad:index}:{id:index+1,[columns[1].key]:index===0?'=HYPERLINK("https://invalid.example.test","texto literal")':'Registro '+(index+1)});
  return {columns,rows:rows.slice(offset,offset+250),nextCursor:offset+250<count?String(offset+250):null,snapshot:{id:'fixture-export-'+table,table,totalRows:count,createdAt:'2026-10-13T18:00:00.000Z'}};
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const requestPath = url.pathname;
  const list = rows => { const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('limit') || 50); return JSON.stringify(url.searchParams.has('page') ? {items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages: Math.max(1, Math.ceil(rows.length / pageSize))} : rows); };
  let body = ''; for await (const chunk of request) body += chunk;
  calls.push({ path: requestPath, query: url.search, method: request.method, cookie: !!request.headers.cookie, origin: request.headers.origin, ...(body && request.headers['content-type']?.includes('application/json') ? { body: JSON.parse(body) } : {}) });
  response.setHeader('Content-Type', 'application/json');
  if (requestPath === '/api/users/login') {
    backendLogin = true;
    response.setHeader('Set-Cookie', `civigo_session=${token}; Path=/; HttpOnly; Expires=${new Date(Date.now() + 86400000).toUTCString()}`);
    const role = JSON.parse(body).correo.startsWith('citizen') ? 'USUARIO' : 'ADMIN';
    return response.end(JSON.stringify({ usuario: { ...actor, rol: role } }));
  }
  if (requestPath === '/api/users/logout') { backendLogin = false; return response.end('{"ok":true}'); }
  if (!backendLogin || request.headers.cookie !== `civigo_session=${token}`) { response.statusCode = 401; return response.end('{"error":"Sesión requerida"}'); }
  if (requestPath === '/api/users/me') {
    if (denySessionWithoutJson) { response.statusCode = 401; response.setHeader('Content-Type', 'text/html'); return response.end('<html>Session expired</html>'); }
    return response.end(JSON.stringify({ usuario: actor }));
  }
  if (requestPath === '/api/admin/statistics') {
    if (statisticsUnavailable) { response.statusCode=503; return response.end('{"error":"Fixture indisponible"}'); }
    return response.end(JSON.stringify(statisticsFixture(url)));
  }
  if (requestPath === '/api/admin/exports') return response.end(JSON.stringify(exportFixture(url)));
  if (requestPath === '/api/admin/users' && request.method === 'POST') {
    const value = JSON.parse(body);
    const created = { id: 2, ...value, password: undefined, premium: false, bloqueado: false, monedas: 0, credibilidad: null, faltas: 0 };
    managedUsers.unshift(created);
    response.statusCode = 201;
    return response.end(JSON.stringify({ usuario: created }));
  }
  if (requestPath === '/api/admin/users/2' && request.method === 'PATCH') {
    Object.assign(managedUsers[0], JSON.parse(body));
    return response.end(JSON.stringify({ usuario: managedUsers[0] }));
  }
  if (requestPath === '/api/admin/users') return response.end(list(managedUsers));
  if (requestPath === '/api/admin/incidents') return response.end(list(incidentFixtures));
  if (/^\/api\/admin\/incidents\/\d+\/messages$/.test(requestPath)) return response.end('[]');
  if (requestPath === '/api/admin/recoveries') return response.end(JSON.stringify(recoveryFixtures));
  if (requestPath === '/api/admin/appeals') return response.end(list(appealFixtures));
  if (requestPath === '/api/admin/audit') return response.end(list(auditFixtures));
  if (requestPath === '/api/notifications') return response.end(JSON.stringify(notificationFixtures));
  if (requestPath === '/api/notifications/1/read' && request.method === 'PUT') { notificationFixtures[0].leida = true; return response.end('{"leida":true}'); }
  if (requestPath === '/api/admin/businesses') return response.end(JSON.stringify(businessFixtures));
  if (requestPath === '/api/uploads' && request.method === 'POST') {
    assert.match(body, /name="tipo"\r\n\r\nANUNCIO/);
    const id = '12345678-1234-1234-1234-' + String(++advertisingUploadSequence).padStart(12, '0');
    const image = {id, nombre:'publicidad.png', mimeType:'image/png', size:advertisingImage.length, privado:false, tipo:'ANUNCIO'};
    advertisingFiles.set(id, image); response.statusCode = 201;
    return response.end(JSON.stringify(image));
  }
  if (/^\/api\/uploads\/[a-f0-9-]{36}$/.test(requestPath)) {
    const id = requestPath.split('/').pop();
    if (request.method === 'DELETE') { advertisingFiles.delete(id); return response.end('{"eliminado":true}'); }
    if (!advertisingFiles.has(id)) { response.statusCode = 404; return response.end('{"error":"No existe"}'); }
    response.setHeader('Content-Type', 'image/png'); response.setHeader('Content-Disposition', 'inline; filename="publicidad.png"');
    return response.end(advertisingImage);
  }
  if (requestPath === '/api/announcements/manage' && request.method === 'POST') {
    const value = { ...JSON.parse(body), id: 90 }; announcementFixtures.unshift(value); response.statusCode = 201;
    return response.end(JSON.stringify(value));
  }
  if (requestPath === '/api/announcements/manage/90' && request.method === 'PATCH') {
    Object.assign(announcementFixtures[0], JSON.parse(body)); return response.end(JSON.stringify(announcementFixtures[0]));
  }
  if (requestPath === '/api/announcements/manage/90' && request.method === 'DELETE') {
    announcementFixtures.shift(); return response.end('{"eliminado":true}');
  }
  if (requestPath === '/api/announcements/manage') return response.end(JSON.stringify(announcementFixtures.filter(row => !url.searchParams.has('ubicacion') || (row.ubicacion ?? 'CABECERA') === url.searchParams.get('ubicacion')).map(row => ({...row, imagen:advertisingFiles.get(row.imagenId) ?? null}))));
  if (requestPath === '/api/navigation/traffic/incidents') return response.end(JSON.stringify({ incidentes: trafficFixtures.filter(row => !moderationFixtures.some(saved => saved.externoId === row.externoId && saved.oculto)), trafico: { disponible: true } }));
  if (requestPath === '/api/announcements/traffic-moderation' && request.method === 'POST') {
    const value = JSON.parse(body), previous = moderationFixtures.find(row => row.externoId === value.externoId);
    if (previous) Object.assign(previous, value); else moderationFixtures.push({ id: 1, proveedor: 'TOMTOM', usuarioId: 1, ...value, actualizadoEn: new Date().toISOString() });
    return response.end(JSON.stringify(previous ?? moderationFixtures[0]));
  }
  if (requestPath === '/api/announcements/traffic-moderation') return response.end(JSON.stringify(moderationFixtures));
  if (requestPath === '/api/admin/rewards') return response.end(JSON.stringify(rewardFixtures));
  if (requestPath === '/api/admin') return response.end(JSON.stringify({ estadisticas: { usuarios: 2, incidentes: 0 }, servicios: { ia: { configurado: true }, correoGoogle: { configurado: true } } }));
  if (requestPath === '/api/catalog') return response.end(JSON.stringify({ categorias: categories, config: {}, distritos: ['Ica'] }));
  if (requestPath === '/api/admin/catalog') return response.end(JSON.stringify({ categorias: categories }));
  if (requestPath === '/api/admin/permissions') return response.end(JSON.stringify(require('../../backend/src/lib/agent-permissions').agentPermissions));
  if (requestPath === '/api/admin/integrations') return response.end(JSON.stringify({ proveedores: [], frontend: { variables: [], plataforma: 'Vercel', indicacion: 'Fixture local' }, navegacion: 'Fixture local', pagos: 'Demostración' }));
  if (requestPath === '/api/admin/config') return response.end(JSON.stringify({ agrupacionMetros: groupingMeters, agrupacionHoras: 2, confirmacionMetros: 50, confirmaciones: 3, resoluciones: 5, influenciaVecina: 0.15, puntosReporte: 10, puntosConfirmacion: 5, puntosPrueba: 5, premiosRanking: [100, 75, 50, 30, 20, 10, 8, 6, 4, 2], anuncioMetros: 50, intervaloAnuncioMetros: 500, duracionAnuncioSegundos: 5, maxVideoBytes: 15 * 1024 * 1024 }));
  if (requestPath === '/api/uploads/private-fixture') {
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
  const openedImageReferences = [];
  shell.openExternal = async url => { openedImageReferences.push(url); };
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
  const unauthenticatedReference = await window.webContents.executeJavaScript(`window.civigoDesktop.openImageReference('https://photos.example.com/image.jpg')`);
  assert.equal(unauthenticatedReference.ok, false); assert.equal(unauthenticatedReference.error.status, 401);
  assert.equal(openedImageReferences.length, 0);
  const logged = await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'admin@example.test', password:'fixture' })`);
  assert.equal(logged.ok, true); assert.equal(logged.data.rol, 'ADMIN');
  await waitUntil(window, 'document.body.innerText.includes("Centro de revisión")');
  await waitUntil(window, '!document.body.innerText.includes("Cargando")');
  const markup = await window.webContents.executeJavaScript('document.body.innerText');
  assert.equal(markup.includes('Categorías y tipos'), true);
  assert.equal(markup.includes('Verificar teléfonos'), false);
  assert.equal(markup.includes('Correo por código'), false);
  await capture(window, 'panel.png');
  await waitUntil(window, '!!document.querySelector(".desktop-notifications strong")');
  await window.webContents.executeJavaScript('document.querySelector(".desktop-notifications button").click()');
  await waitUntil(window, 'document.body.innerText.includes("Emergencia pendiente")');
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#desktop-notices button')).find(button => button.textContent === 'Marcar como leída').click()`);
  await waitUntil(window, '!document.querySelector(".desktop-notifications > button strong")');
  assert.equal(calls.some(call => call.path === '/api/notifications/1/read' && call.cookie), true);
  await window.webContents.executeJavaScript('document.querySelector(".desktop-notifications button").click()');
  const panels = [
    ['Estadísticas', '/api/admin/statistics'],
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
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Estadísticas').click()`);
  await waitUntil(window, `document.querySelectorAll('.statistics-chart svg[role="img"]').length===6`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.statistics-totals strong').textContent`),'550');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('select[aria-label="Comparar registros de"]').value`),'all');
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.statistics-comparison').textContent.includes('+100')`));
  await window.webContents.executeJavaScript(`document.querySelector('.statistics-panel').scrollIntoView({block:'start'})`);
  await capture(window,'estadisticas-claro.png');
  await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
  await capture(window,'estadisticas-oscuro.png');
  const buttonContrast=await window.webContents.executeJavaScript(`(()=>{const rgb=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number);const luminance=value=>rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);return Array.from(document.querySelectorAll('.desktop-header .btn-secondary,.statistics-filters .btn-secondary')).map(button=>{const style=getComputedStyle(button),a=luminance(style.color),b=luminance(style.backgroundColor);return{label:button.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});})()`);
  assert.ok(buttonContrast.every(value=>value.ratio>=4.5),JSON.stringify(buttonContrast));
  await window.webContents.executeJavaScript(`document.querySelector('.statistics-grid').scrollIntoView({block:'start'})`);
  await capture(window,'estadisticas-graficas-oscuro.png');
  await window.webContents.executeJavaScript(`document.querySelectorAll('.statistics-chart')[4].scrollIntoView({block:'center'})`);
  await capture(window,'estadisticas-evolucion-oscuro.png');
  for (const width of [1000,1400]) {
    window.setContentSize(width,900);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth<=innerWidth+1`),true);
    assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.statistics-chart')).every(card=>card.getBoundingClientRect().right<=innerWidth+1)`),true);
  }
  await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
  window.setContentSize(1320,920);
  const changeStatisticsSelect=(label,value)=>window.webContents.executeJavaScript(`(()=>{const field=document.querySelector('select[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await changeStatisticsSelect('Distrito de estadísticas','Ica');
  await waitUntil(window,`document.querySelector('.statistics-totals strong')?.textContent==='300'`);
  await changeStatisticsSelect('Tipo de estadísticas','bache-fixture-0');
  await waitUntil(window,`document.querySelector('.statistics-totals strong')?.textContent==='150'`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.statistics-comparison').textContent.includes('+100')`));
  await changeStatisticsSelect('Comparar registros de','security');
  await waitUntil(window,`document.querySelector('.statistics-delta').textContent.includes('Sin base')`);
  assert.ok(calls.some(call=>call.path==='/api/admin/statistics'&&call.query.includes('district=Ica')&&call.query.includes('type=bache-fixture-0')));
  statisticsUnavailable=true;
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.statistics-panel button')).find(button=>button.textContent==='Actualizar estadísticas').click()`);
  await waitUntil(window,`document.querySelector('.statistics-panel [role="status"]')?.textContent.includes('Se conservan')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.statistics-totals strong').textContent`),'150');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.statistics-chart svg[role="img"]').length`),6);
  statisticsUnavailable=false;
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.statistics-panel button')).find(button=>button.textContent==='Ver panorama general').click()`);
  await waitUntil(window,`document.querySelector('.statistics-totals strong')?.textContent==='550'`);
  const ExcelJS=require('exceljs'), exportDialogCalls=[];
  dialog.showSaveDialog=async(_window,options)=>{exportDialogCalls.push(options);const table=path.basename(options.defaultPath).split('-')[1];return{canceled:false,filePath:path.join(local,table+'.xlsx')};};
  for (const [label,table,expectedRows] of [['Usuarios','usuarios',5],['Reportes','reportes',550],['Incidentes','incidentes',550],['Catálogo','catalogo',24],['Estadísticas','estadisticas',9]]) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.excel-export-toolbar button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    await waitUntil(window,`Array.from(document.querySelectorAll('.excel-export-toolbar .excel-export-action')).find(action=>action.querySelector('button').textContent===${JSON.stringify(label)})?.querySelector('[role="status"]')?.textContent.includes('${expectedRows} filas')`);
    const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(local,table+'.xlsx'));
    assert.equal(book.worksheets[0].rowCount,expectedRows+1);
    if(table!=='estadisticas') {assert.equal(book.worksheets[0].getCell('B2').type,ExcelJS.ValueType.String);assert.equal(book.worksheets[0].getCell('B2').formula,undefined);}
    assert.equal(book.worksheets[0].views[0].ySplit,1);
  }
  assert.equal(exportDialogCalls.length,5);
  for(const table of ['reportes','incidentes'])assert.equal(calls.filter(call=>call.path==='/api/admin/exports'&&call.query.includes('table='+table)).length,3);
  const invalidExport=await window.webContents.executeJavaScript(`window.civigoDesktop.exportExcel({table:'usuarios',filePath:'C:/arbitrary.xlsx'})`);
  assert.equal(invalidExport.ok,false);assert.equal(exportDialogCalls.length,5);
  let releaseExcelDialog;const excelDialogWaiting=new Promise(resolve=>{releaseExcelDialog=resolve;});let excelDialogOpened=false;
  dialog.showSaveDialog=async()=>{excelDialogOpened=true;return excelDialogWaiting;};
  const pendingExcel=window.webContents.executeJavaScript(`window.civigoDesktop.exportExcel({table:'incidentes'})`);
  while(!excelDialogOpened)await new Promise(resolve=>setTimeout(resolve,25));
  await window.webContents.executeJavaScript(`window.civigoDesktop.logout()`);
  await window.webContents.executeJavaScript(`window.civigoDesktop.login({correo:'admin@example.test',password:'fixture'})`);
  const staleExcelPath=path.join(local,'stale.xlsx');await fs.unlink(staleExcelPath).catch(()=>{});
  releaseExcelDialog({canceled:false,filePath:staleExcelPath});
  const staleExcel=await pendingExcel;assert.equal(staleExcel.ok,false);assert.equal(staleExcel.error.status,401);await assert.rejects(fs.access(staleExcelPath));
  await waitUntil(window,`document.body.innerText.includes('Centro de revisión')`);
  assert.equal(await window.webContents.executeJavaScript(`document.cookie.includes('${token}')`), false);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Configuración').click()`);
  await waitUntil(window, `!!document.querySelector('form input[type="number"]')`);
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('form input[type="number"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'75'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  groupingMeters = 60;
  const configReads = calls.filter(call => call.path === '/api/admin/config').length;
  await window.webContents.executeJavaScript('window.dispatchEvent(new Event("civigo:management-refresh"))');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(calls.filter(call => call.path === '/api/admin/config').length > configReads);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('form input[type="number"]').value`), '75', 'external configuration refresh must preserve the draft');
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('form button')).find(button=>button.textContent==='Guardar configuración').disabled`), true);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('form button')).find(button=>button.textContent==='Descartar borrador y cargar configuración actual').click()`);
  await waitUntil(window, `document.querySelector('form input[type="number"]').value==='60'`);
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('form button')).find(button=>button.textContent==='Guardar configuración').disabled`), false);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Actividad y plazos').click()`);
  await waitUntil(window, `document.body.innerText.includes('Página 1 de 2') && !document.body.innerText.includes('Cargando')`);
  await waitUntil(window, `document.body.innerText.includes('Coincidencia encontrada en Internet')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('section[aria-label="Búsqueda de imágenes en Internet"] img').length`), 0);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('section[aria-label="Búsqueda de imágenes en Internet"] a').length`), 2);
  await window.webContents.executeJavaScript(`document.querySelector('section[aria-label="Búsqueda de imágenes en Internet"] a').click()`);
  await waitUntil(window, 'true');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(openedImageReferences, ['https://photos.example.com/image.jpg']);
  const blockedReference = await window.webContents.executeJavaScript(`window.civigoDesktop.openImageReference('https://127.0.0.1/private.jpg')`);
  assert.equal(blockedReference.ok, false); assert.equal(blockedReference.error.status, 400);
  assert.equal(openedImageReferences.length, 1);
  assert.equal(await window.webContents.executeJavaScript('location.href'), 'civigo://app/index.html');
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Paginación de resultados"] button')).find(button=>button.textContent==='Siguiente').click()`);
  await waitUntil(window, `document.body.innerText.includes('Página 2 de 2') && document.body.innerText.includes('Registro #61')`);
  assert.ok(calls.some(call => call.path === '/api/admin/audit' && call.query.includes('page=2')));
  auditFixtures.splice(10);
  await window.webContents.executeJavaScript('window.dispatchEvent(new Event("civigo:management-refresh"))');
  await waitUntil(window, `document.body.innerText.includes('Página 1 de 1') && document.body.innerText.includes('Registro #10') && !document.body.innerText.includes('Cargando')`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav[aria-label="Herramientas de administración"] button')).find(button=>button.textContent==='Anuncios y novedades').click()`);
  await waitUntil(window, `!document.body.innerText.includes('Cargando')`);
  await openEditor(window, 'Crear anuncio');
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.editor-panel label')).find(label=>label.textContent.startsWith('Ubicación del anuncio')).querySelector('select').value`), 'CABECERA');
  await window.webContents.executeJavaScript(`(() => {const select=Array.from(document.querySelectorAll('.editor-panel label')).find(label=>label.textContent.startsWith('Ubicación del anuncio')).querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'REPORTAR'); select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const pickAdvertisingImage = async () => {
    await window.webContents.executeJavaScript(`(() => {
      const bytes=Uint8Array.from(atob('${advertisingImage.toString('base64')}'), c=>c.charCodeAt(0));
      const selection=new DataTransfer(); selection.items.add(new File([bytes], 'publicidad.png', {type:'image/png'}));
      const input=document.querySelector('.editor-panel input[type="file"]'); input.files=selection.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitUntil(window, `(() => {const image=document.querySelector('.announcement-image-preview img'); return image?.complete && image.naturalWidth > 0 && !document.querySelector('.editor-panel input[type="file"]').disabled;})()`);
    assert.match(await window.webContents.executeJavaScript(`document.querySelector('.announcement-image-preview img').src`), /^data:image\/png;base64,/);
  };
  const uploadsBeforeInvalid = advertisingUploadSequence;
  await window.webContents.executeJavaScript(`(() => {const selection=new DataTransfer(); selection.items.add(new File(['<svg/>'], 'invalido.svg', {type:'image/svg+xml'})); const input=document.querySelector('.editor-panel input[type="file"]'); input.files=selection.files; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(window, `document.body.innerText.includes('Selecciona una imagen JPEG')`);
  assert.equal(advertisingUploadSequence, uploadsBeforeInvalid);
  await pickAdvertisingImage();
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
  assert.equal(announcementCreation.body.imagenId, '12345678-1234-1234-1234-000000000001');
  assert.equal(announcementCreation.body.ubicacion, 'REPORTAR');
  await openEditor(window, 'Editar');
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.editor-panel label')).find(label=>label.textContent.startsWith('Ubicación del anuncio')).querySelector('select').value`), 'REPORTAR');
  await waitUntil(window, `document.querySelector('.announcement-image-preview img')?.naturalWidth > 0`);
  await pickAdvertisingImage();
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('.editor-panel input[type="number"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'2'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `document.body.innerText.includes('Anuncio guardado. Se mostrará') && !document.querySelector('.editor-panel')`);
  assert.equal(calls.find(call => call.path === '/api/announcements/manage/90' && call.method === 'PATCH').body.orden, 2);
  assert.equal(calls.find(call => call.path === '/api/announcements/manage/90' && call.method === 'PATCH').body.imagenId, '12345678-1234-1234-1234-000000000002');
  assert.equal(calls.find(call => call.path === '/api/announcements/manage/90' && call.method === 'PATCH').body.ubicacion, 'REPORTAR');
  await openEditor(window, 'Editar');
  await waitUntil(window, `document.querySelector('.announcement-image-preview img')?.naturalWidth > 0`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.editor-panel button')).find(button=>button.textContent==='Quitar imagen').click()`);
  await waitUntil(window, `!document.querySelector('.announcement-image-preview')`);
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `!document.querySelector('.editor-panel')`);
  assert.equal(calls.filter(call => call.path === '/api/announcements/manage/90' && call.method === 'PATCH').at(-1).body.imagenId, null);
  const selectPlacementFilter = value => window.webContents.executeJavaScript(`(() => {const select=Array.from(document.querySelectorAll('label')).find(label=>label.textContent.startsWith('Filtrar por ubicación')).querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'${value}'); select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await selectPlacementFilter('REPORTAR');
  await waitUntil(window, `document.body.innerText.includes('Anuncio guardado desde la prueba') && !document.body.innerText.includes('Novedad de prueba 0') && !document.body.innerText.includes('Cargando')`);
  assert.ok(calls.some(call=>call.path==='/api/announcements/manage' && call.query==='?ubicacion=REPORTAR'));
  await selectPlacementFilter('CABECERA');
  await waitUntil(window, `document.body.innerText.includes('Novedad de prueba 0') && !document.body.innerText.includes('Anuncio guardado desde la prueba') && !document.body.innerText.includes('Cargando')`);
  await selectPlacementFilter('');
  await waitUntil(window, `document.body.innerText.includes('Anuncio guardado desde la prueba') && document.body.innerText.includes('Novedad de prueba 0') && !document.body.innerText.includes('Cargando')`);
  await openEditor(window, 'Crear anuncio');
  await pickAdvertisingImage();
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.editor-panel button')).find(button=>button.textContent==='Cancelar').click()`);
  await waitUntil(window, `!document.querySelector('.editor-panel')`);
  assert.equal(calls.some(call => call.path === '/api/uploads/12345678-1234-1234-1234-000000000003' && call.method === 'DELETE'), true, 'cancelar elimina la imagen cargada sin usar');
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
  const readsBeforeRefresh = calls.filter(call => call.path === '/api/admin/users' && call.method === 'GET').length;
  await window.webContents.executeJavaScript('window.dispatchEvent(new Event("civigo:management-refresh"))');
  await waitUntil(window, `!!document.querySelector('input[name="password"]')`);
  // An automatic refresh must preserve an open editor and the user's draft.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(calls.filter(call => call.path === '/api/admin/users' && call.method === 'GET').length > readsBeforeRefresh, true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[name="nickname"]').value`), 'ana_smoke');
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
  await openEditor(window, 'Administrar');
  await window.webContents.executeJavaScript(`(() => {
    const role = Array.from(document.querySelectorAll('.editor-panel select')).find(field => Array.from(field.options).some(option => option.value === 'AGENTE'));
    role.value = 'AGENTE'; role.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitUntil(window, `document.querySelectorAll('input[name^="permiso_"]').length === 10`);
  await window.webContents.executeJavaScript(`(() => {
    const district = Array.from(document.querySelectorAll('.editor-panel select')).find(field => Array.from(field.options).some(option => option.value === 'Ica'));
    district.value = 'Ica'; district.dispatchEvent(new Event('change', {bubbles:true}));
    document.querySelector('input[name="permiso_gravedad"]').click();
    document.querySelector('input[name="permiso_moderar"]').click();
  })()`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[name="permiso_consultar"]').checked && document.querySelector('input[name="permiso_consultar"]').disabled`), true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[name="permiso_evidencia"]').checked`), false);
  await capture(window, 'funciones-agente.png');
  await window.webContents.executeJavaScript(`document.querySelector('.editor-panel form').requestSubmit()`);
  await waitUntil(window, `!document.querySelector('.editor-panel')`);
  const assignedFunctions = calls.filter(call => call.path === '/api/admin/users/2' && call.method === 'PATCH').at(-1);
  assert.deepEqual(assignedFunctions.body.permisos, ['consultar', 'gravedad', 'moderar']);
  assert.equal(assignedFunctions.body.distrito, 'Ica');
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
  let approveRevokedSave;
  const waitingRevokedSave = new Promise(resolve => { approveRevokedSave = resolve; });
  let saveOpened = false;
  dialog.showSaveDialog = () => { saveOpened = true; return waitingRevokedSave; };
  const revokedDownload = window.webContents.executeJavaScript(`window.civigoDesktop.download('private-fixture')`);
  const saveDeadline = Date.now() + 10000;
  while (!saveOpened && Date.now() < saveDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(saveOpened, true);
  actor.rol = 'AGENTE';
  approveRevokedSave({ canceled: false, filePath: savedPath });
  const revokedFile = await revokedDownload;
  assert.equal(revokedFile.ok, false); assert.equal(revokedFile.error.status, 403);
  await assert.rejects(fs.access(savedPath));
  actor.rol = 'ADMIN';
  await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'admin@example.test', password:'fixture' })`);
  actor.rol = 'AGENTE';
  const demoted = await window.webContents.executeJavaScript('window.civigoDesktop.session()');
  assert.equal(demoted.ok, false); assert.equal(demoted.error.status, 403);
  await waitUntil(window, 'document.body.innerText.includes("Administración de CiviGo")');
  actor.rol = 'ADMIN';
  assert.equal(client.authenticated(), false);
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("admin-fixture")'), false);
  await window.webContents.executeJavaScript(`window.civigoDesktop.login({ correo:'admin@example.test', password:'fixture' })`);
  await waitUntil(window, 'document.body.innerText.includes("admin-fixture")');
  denySessionWithoutJson = true;
  const deniedSession = await window.webContents.executeJavaScript('window.civigoDesktop.session()');
  assert.equal(deniedSession.ok, false); assert.equal(deniedSession.error.status, 401);
  await waitUntil(window, 'document.body.innerText.includes("Administración de CiviGo") && !document.body.innerText.includes("admin-fixture")');
  assert.equal(client.authenticated(), false);
  assert.equal(calls.filter(call => call.cookie).every(call => call.origin === 'https://civigo.online'), true);
  // CSP rejection must happen before an attempted remote network request.
  assert.equal(await window.webContents.executeJavaScript(`fetch('https://invalid.example.test').then(()=>false,()=>true)`), true);
  await fs.writeFile(path.join(local, archive ? 'package-smoke-result.json' : 'smoke-result.json'), JSON.stringify({ passed: true, completedAt: new Date().toISOString(), packagedArchive: archive, calls: calls.length, panels: panels.length, isolation: { node: isolation.node, process: isolation.process, cookie: isolation.cookie }, statisticsSixCharts:true,statisticsFilters:true,statisticsGeneralAndSecurityComparison:true,statisticsRefreshFailurePreservesData:true,excelExportsFiveTables:true,excelAll550Rows:true,excelNoFormulaExecution:true,logoutPreventsStaleExcel:true,createUserFromPanel: true, notificationsFromPanel: true, backgroundRefreshPreservesDraft: true, externalConfigRefreshPreservesDraft: true, paginationAndShrinkRecovery: true, auditedEmailVerificationFromPanel: true, downloadFromIncidentAndRecoveryPanels: true, authenticatedDownloads: true, logoutPreventsStaleDownload: true, revokedRoleRemovesPanel: true }, null, 2));
  window.destroy(); server.closeAllConnections(); server.close();
  console.log('Electron smoke: acceso ADMIN, interfaz local, IPC, adjuntos privados, CSP y cierre de sesión verificados.');
  app.exit(0);
}
run().catch(error => { console.error(error); server.closeAllConnections(); server.close(); app.exit(1); });
