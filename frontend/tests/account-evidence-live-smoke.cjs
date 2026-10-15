/* eslint-disable @typescript-eslint/no-require-imports */
// Local Next server: BACKEND_URL=http://127.0.0.1:55729, port 55730.
// Run with desktop/node_modules/electron/dist/electron.exe. All data is synthetic.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const backendPort = Number(process.env.CIVIGO_AUDIT_FIXTURE_PORT || 55729);
const frontendPort = Number(process.env.CIVIGO_AUDIT_FRONTEND_PORT || 55730);
const origin = `http://127.0.0.1:${frontendPort}`;
const output = path.resolve(__dirname, '../.local/account-evidence-live-smoke');
require('node:fs').mkdirSync(path.join(output, 'session'), { recursive: true });
app.setPath('userData', output);
app.setPath('sessionData', path.join(output, 'session'));
app.disableHardwareAcceleration();
const account = { id: 9001, nickname: 'AuditoriaLocal', correo: 'fixture@example.invalid', correoVerificado: true, telefono: '+51987654321', rol: 'USUARIO', premium: false, monedas: 0, credibilidad: 100 };
let user = account, holdDetail = false, uploadNumber = 0;
const pendingDetails = [], pendingReviews = [], requests = [];
const incident = { id: 700001, tipo: 'Robo', tipoSlug: 'robo', descripcion: 'Contenido autorizado de la cuenta anterior', latitud: -14.0678, longitud: -75.7286, estado: 'RETIRADO', publicado: false, individual: true, chatAbierto: true, nivelRiesgo: 2, totalReportes: 1, adjuntos: [], fechaCreacion: '2026-10-15T10:00:00Z' };
const report = { id: 800001, tipo: 'Robo', descripcion: 'Reporte local de auditoría', estado: 'EN_REVISION', latitud: incident.latitud, longitud: incident.longitud, incidenteId: incident.id, incidente: { ...incident, publicado: true }, adjuntos: [1, 2].map(id => ({ id: `existing-${id}`, nombre: `existing-${id}.pdf`, privado: true, mimeType: 'application/pdf', url: `/api/uploads/existing-${id}` })), apelaciones: [] };
const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin), entry = { method: request.method, path: url.pathname };
    requests.push(entry);
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const reply = (data, status = 200) => { response.statusCode = status; response.end(JSON.stringify(data)); };
    if (url.pathname === '/api/users/me') return user ? reply({ usuario: user }) : reply({ error: 'Sesión finalizada.' }, 401);
    if (url.pathname === '/api/incidents/700001') {
        const send = () => user ? reply(incident) : reply({ error: 'Incidente no disponible.' }, 404);
        if (holdDetail) pendingDetails.push(send); else send();
        return;
    }
    if (url.pathname === '/api/incidents/700001/chat') return reply([{ id: 1, nickname: 'AutorLocal', mensaje: 'Conversación de la cuenta anterior', creadoEn: incident.fechaCreacion }]);
    if (url.pathname === '/api/reports/mine') return reply([report]);
    if (url.pathname === '/api/catalog') return reply({ categorias: [], config: {}, distritos: ['Ica'] });
    if (url.pathname === '/api/admin/incidents' && request.method === 'GET') return reply({ items: [90001, 90002].map(id => ({ ...incident, id, tipo: 'Bache', tipoSlug: 'bache', individual: false, publicado: true, estado: 'ACTIVO', descripcion: `Incidente para revisión ${id}`, validacion: 0.5, reportes: [], flags: [], revisiones: [] })), total: 2, page: 1, pages: 1, pageSize: 50 });
    if (url.pathname === '/api/admin/incidents/90001/review' && request.method === 'POST') { pendingReviews.push(() => reply({ ...incident, id: 90001, estado: 'VALIDADO' })); return; }
    if (url.pathname === '/api/uploads' && request.method === 'POST') {
        for await (const chunk of request) { void chunk; }
        const id = `new-${++uploadNumber}`;
        entry.id = id;
        return reply({ id, nombre: 'private.pdf', mimeType: 'application/pdf', privado: true, url: `/api/uploads/${id}` }, 201);
    }
    if (url.pathname.startsWith('/api/uploads/new-') && request.method === 'DELETE') return reply({ eliminado: true });
    if (url.pathname.endsWith('/evidence')) return reply({ error: 'El plazo de siete días finalizó. Solicita revisión.' }, 409);
    if (url.pathname === '/api/users/recovery') return reply({ error: 'Ya existe una solicitud de teléfono pendiente.' }, 409);
    if (url.pathname === '/api/participation') return reply({ puntosMensuales: 0, totalReportes: 1, reportesValidados: 0, mes: '2026-10', insignias: [], movimientos: [] });
    if (['/api/announcements', '/api/navigation/history', '/api/navigation/favorites'].includes(url.pathname)) return reply([]);
    return reply({ error: 'Ruta no incluida en el fixture.' }, 404);
});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(window, expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await window.webContents.executeJavaScript(expression)) return;
        await delay(75);
    }
    throw new Error(`No se cumplió: ${expression}`);
}
const clickText = text => `Array.from(document.querySelectorAll('button')).find(node=>node.textContent.includes(${JSON.stringify(text)})).click()`;
const selectFiles = count => `(() => {const input=document.querySelector('input[type=file]'), data=new DataTransfer();for(let index=0;index<${count};index++)data.items.add(new File(['local fixture'],'proof-'+index+'.pdf',{type:'application/pdf'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`;
async function run() {
    server.listen(backendPort, '127.0.0.1'); await once(server, 'listening'); await app.whenReady();
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'account-evidence-audit' } });
    const blockedHosts = new Set();
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url), allowed = url.hostname === '127.0.0.1' && url.port === String(frontendPort) && ['http:', 'ws:'].includes(url.protocol) || ['data:', 'blob:'].includes(url.protocol);
        if (!allowed) blockedHosts.add(url.hostname || url.protocol);
        callback({ cancel: !allowed });
    });
    await window.loadURL(`${origin}/incidentes/700001`);
    await waitUntil(window, `document.body.textContent.includes('Contenido autorizado de la cuenta anterior') && document.body.textContent.includes('Conversación de la cuenta anterior')`);
    user = null; holdDetail = true;
    await window.webContents.executeJavaScript(`window.dispatchEvent(new Event('online'))`);
    await waitUntil(window, `document.body.textContent.includes('Cargando incidente…') && !document.querySelector('[aria-labelledby="incident-title"]')`);
    assert.equal(await window.webContents.executeJavaScript(`document.body.textContent.includes('Contenido autorizado de la cuenta anterior') || document.body.textContent.includes('Conversación de la cuenta anterior')`), false, 'El cambio de sesión debe retirar el detalle y la conversación inmediatamente.');
    holdDetail = false; for (const finish of pendingDetails.splice(0)) finish();
    await waitUntil(window, `document.body.textContent.includes('Incidente no disponible.')`);

    user = account;
    await window.loadURL(`${origin}/mis-reportes`);
    await waitUntil(window, `document.body.textContent.includes('Reporte local de auditoría')`);
    await window.webContents.executeJavaScript(clickText('Aportar pruebas privadas'));
    await window.webContents.executeJavaScript(selectFiles(1));
    await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(node=>node.textContent.includes('Enviar pruebas')&&!node.disabled)`);
    await window.webContents.executeJavaScript(selectFiles(2));
    await waitUntil(window, `document.querySelector('[role="alert"]')?.textContent.includes('Espacios disponibles: 1')`);
    assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(node=>node.textContent.includes('Enviar pruebas')).disabled`), true, 'Una selección que excede el espacio debe borrar también los archivos previos del estado.');
    assert.equal(uploadNumber, 0, 'Los archivos rechazados en la interfaz no deben cargarse.');
    await window.webContents.executeJavaScript(selectFiles(1));
    await window.webContents.executeJavaScript(clickText('Enviar pruebas'));
    await waitUntil(window, `document.body.textContent.includes('El plazo de siete días finalizó.')`);
    assert.ok(requests.some(request => request.path === '/api/uploads/new-1' && request.method === 'DELETE'), 'La evidencia rechazada debe limpiar el archivo huérfano.');

    report.adjuntos.push({ id: 'existing-3', nombre: 'existing-3.pdf', privado: true, mimeType: 'application/pdf' });
    await window.loadURL(`${origin}/mis-reportes`);
    await waitUntil(window, `Array.from(document.querySelectorAll('button')).some(node=>node.textContent.includes('Aportar pruebas privadas')&&node.disabled)`);

    await window.loadURL(`${origin}/perfil`);
    await waitUntil(window, `document.body.textContent.includes('Solicitar cambio de teléfono')`);
    await window.webContents.executeJavaScript(clickText('Solicitar cambio de teléfono'));
    await window.webContents.executeJavaScript(`(() => {for(const [id,value]of [['phone-new','+51987654322'],['phone-reason','Motivo local de prueba suficientemente largo']]){const element=document.getElementById(id),proto=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await window.webContents.executeJavaScript(selectFiles(1));
    await window.webContents.executeJavaScript(clickText('Enviar solicitud'));
    await waitUntil(window, `document.body.textContent.includes('Ya existe una solicitud de teléfono pendiente.')`);
    assert.ok(requests.some(request => request.path === '/api/uploads/new-2' && request.method === 'DELETE'), 'El documento de identidad rechazado debe limpiarse.');
    user = { ...account, rol: 'AGENTE', permisos: ['consultar', 'validar'] };
    await window.loadURL(`${origin}/agente`);
    await waitUntil(window, `Array.from(document.querySelectorAll('button')).filter(node=>node.textContent.trim()==='Revisar').length===2`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(node=>node.textContent.trim()==='Revisar')[0].click()`);
    await waitUntil(window, `document.getElementById('review-title')?.textContent.includes('#90001')`);
    await window.webContents.executeJavaScript(`(() => {const element=Array.from(document.querySelectorAll('label')).find(node=>node.textContent.includes('Motivo de la decisión')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,'Decisión local demorada para comprobar selección independiente.');element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await window.webContents.executeJavaScript(clickText('Guardar decisión'));
    const reviewDeadline = Date.now() + 10000;
    while (!pendingReviews.length && Date.now() < reviewDeadline) await delay(50);
    assert.equal(pendingReviews.length, 1);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(node=>node.textContent.trim()==='Revisar')[1].click()`);
    await waitUntil(window, `document.getElementById('review-title')?.textContent.includes('#90002')`);
    for (const finish of pendingReviews.splice(0)) finish();
    await waitUntil(window, `document.body.textContent.includes('La decisión quedó registrada')`);
    assert.equal(await window.webContents.executeJavaScript(`document.getElementById('review-title')?.textContent.includes('#90002')`), true, 'La respuesta del primer incidente no debe cerrar la revisión del segundo.');
    user = { ...account, bloqueado: true };
    await window.loadURL(`${origin}/perfil`);
    await waitUntil(window, `document.getElementById('nickname')?.disabled`);
    assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(node=>node.textContent.includes('Actualizar nickname'))?.disabled`), true, 'La cuenta restringida puede consultar el perfil, pero no editar su nickname.');
    const result = { passed: true, scenarios: ['Cambio de cuenta retira detalle y conversación antes de la nueva respuesta', 'Rechazo por capacidad borra selección anterior y no carga archivos', 'Evidencia rechazada limpia huérfano', 'Tres adjuntos deshabilitan nuevas pruebas', 'Recuperación rechazada limpia documento de identidad', 'Una decisión demorada no cierra otro incidente abierto', 'Cuenta restringida conserva consulta del perfil sin edición del nickname'], requests, blockedHosts: [...blockedHosts] };
    await fs.writeFile(path.join(output, 'resultado.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    window.destroy(); server.close(); app.exit(0);
}
run().catch(async error => {
    console.error(error.stack || error);
    await fs.writeFile(path.join(output, 'error.txt'), String(error.stack || error));
    server.close(); app.exit(1);
});
