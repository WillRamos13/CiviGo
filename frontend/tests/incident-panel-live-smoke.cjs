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
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRzYAAAAASUVORK5CYII=', 'base64');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
const fixture = {
  id: 700001, tipo: 'Incendio', tipoNombre: 'Incendio', tipoSlug: 'incendio',
  descripcion: 'Detalle disponible sólo en la consulta cercana',
  latitud: -14.0678, longitud: -75.7286, estado: 'ACTIVO',
  gravedad: 2, nivelRiesgo: 2, publicado: true, totalReportes: 1,
  confirmaciones: 0, evaluacion: 'IA', distrito: 'Ica', adjuntos: [
    {id:'public-photo',mimeType:'image/png',nombre:'foto-publica.png',privado:false,url:'/api/uploads/public-photo'},
    {id:'private-proof',mimeType:'image/png',nombre:'prueba-privada.png',privado:true,url:'/api/uploads/private-proof'},
  ],
  fechaCreacion: '2026-10-08T12:00:00Z',
};
let mode = 'visible';
let modalReady = true;
const pendingModal = [];
const requests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({url: request.url, mode});
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/uploads/public-photo') { response.setHeader('Content-Type','image/png'); return response.end(image); }
  if (url.pathname === '/api/incidents') return response.end(JSON.stringify(url.searchParams.has('latitud') ? [fixture] : []));
  if (url.pathname === `/api/incidents/${fixture.id}/chat`) return response.end(JSON.stringify(mode === 'modal' ? Array.from({length: 12}, (_, index) => ({id: 800000 + index, nickname: 'Ciudadano de prueba', mensaje: `Mensaje local de contexto ${index + 1}.`, creadoEn: fixture.fechaCreacion})) : []));
  if (url.pathname === `/api/incidents/${fixture.id}`) {
    const requestedMode = mode;
    if (requestedMode === 'unavailable') { response.statusCode = 503; return response.end('{"error":"Servicio temporalmente no disponible"}'); }
    if (requestedMode === 'missing' || requestedMode === 'late-missing') {
      const removed = () => { response.statusCode = 404; response.end('{"error":"Incidente no disponible"}'); };
      if (requestedMode === 'late-missing') { setTimeout(removed, 1200); return; }
      return removed();
    }
    if (requestedMode === 'modal') {
      const reply = () => response.end(JSON.stringify({...fixture, descripcion: Array.from({length: 14}, (_, index) => `Contexto público ${index + 1}: descripción local extensa para comprobar que el usuario puede consultar el detalle completo.`).join('\n\n')}));
      if (!modalReady) { pendingModal.push(reply); return; }
      return reply();
    }
    if (requestedMode === 'initial-reference') return response.end(JSON.stringify({...fixture,fuente:'CARGA_INICIAL',adjuntos:fixture.adjuntos.map(row=>row.privado?row:{...row,nombre:'Foto de referencia · Incendio ilustrativo · Autor de prueba · CC BY-SA 4.0 · https://commons.wikimedia.org/wiki/File:Example.jpg'})}));
    return response.end(JSON.stringify(requestedMode === 'owner' ? {...fixture, publicado:false, estado:'RETIRADO', descripcion:'Autor autorizado: incidente retirado'} : fixture));
  }
  if (url.pathname === '/api/users/me') return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario prueba',correo:'fixture@example.invalid',correoVerificado:true,rol:'USUARIO',premium:false,credibilidad:100}}));
  if (url.pathname === '/api/catalog') return response.end(JSON.stringify({categorias:[],config:{confirmacionMetros:20,confirmaciones:5},distritos:['Ica']}));
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
  await window.loadURL(`${origin}/comunidad`);
  await waitUntil(window, `location.pathname==='/ranking'`);
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
  assert.ok(requests.some(request => { const url=new URL(request.url,'http://127.0.0.1'); return url.pathname==='/api/incidents'&&!url.searchParams.has('latitud'); }), 'El listado general está vacío y no conoce este incidente');
  const dialog = `document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`;
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window, `${dialog}?.textContent.includes('Detalle disponible sólo')`);
  await waitUntil(window, `${dialog}?.textContent.includes('20 metros o menos') && ${dialog}?.textContent.includes('0 / 5')`);
  await waitUntil(window, `${dialog}?.querySelector('img[alt^="Fotografía pública"]')?.naturalWidth>0`);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.getAttribute('aria-modal')`),'false');
  assert.equal(await window.webContents.executeJavaScript(`document.body.style.overflow==='hidden'`),false,'La tarjeta del mapa no bloquea el scroll de la página');
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.map-column [role="dialog"]')`),true);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.querySelectorAll('img[alt^="Fotografía pública"]').length`),1,'La tarjeta muestra únicamente la fotografía pública');
  mode = 'unavailable';
  await waitUntil(window, `${dialog}?.textContent.includes('No se pudo actualizar el detalle.')`);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.textContent.includes('Detalle disponible sólo')`),true,'Un 503 conserva el detalle anterior');
  mode = 'owner';
  await waitUntil(window, `${dialog}?.textContent.includes('No visible en el mapa') && ${dialog}?.textContent.includes('Autor autorizado: incidente retirado')`);
  assert.equal(await window.webContents.executeJavaScript(`${dialog}.textContent.includes('No se pudo actualizar el detalle.')`),false,'Una respuesta 200 actualiza el estado real y limpia el aviso transitorio');
  await window.webContents.executeJavaScript(`document.querySelector('.map-route-panel > .panel-toggle').focus()`);
  mode = 'missing';
  await waitUntil(window, `!${dialog}`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('.map-route-panel > .panel-toggle')`),true,'Un 404 no debe quitar el foco de otro control de rutas');
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
  const layouts=[];
  for(const [width,height]of [[1400,768],[850,700],[390,844],[320,640]]) {
    window.setContentSize(width,height);
    window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},viewSize:{width,height},deviceScaleFactor:1,scale:1});
    for(const theme of ['light','dark']) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.scrollTo(0,0)`);
      await waitUntil(window,`innerWidth===${width}`);
      const layout=await window.webContents.executeJavaScript(`(() => {const panel=${dialog},rect=panel.getBoundingClientRect(),body=panel.lastElementChild;return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:innerHeight,scrollable:body.scrollHeight>body.clientHeight,state:panel.textContent.includes('Descripción')&&panel.textContent.includes('Ubicación')};})()`);
      assert.ok(layout.left>=0&&layout.right<=width+1&&layout.top>=0&&layout.bottom<=height+1,'Tarjeta dentro de la pantalla');
      assert.ok(layout.scrollWidth<=width&&layout.state); assert.equal(layout.scrollable,true,'Contenido completo disponible mediante scroll interno');
      layouts.push({theme,...layout});
      await fs.writeFile(path.join(local,'tarjeta-'+width+'-'+theme+'.png'),(await window.webContents.capturePage()).toPNG());
    }
  }
  assert.equal(requests.some(request=>request.url==='/api/uploads/private-proof'),false,'No se solicita la prueba privada');
  await window.webContents.executeJavaScript(`document.querySelector('.map-route-panel > .panel-toggle').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await window.webContents.executeJavaScript(`!!${dialog}`),true,'Escape en otro control no cierra la tarjeta');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await waitUntil(window,`!${dialog}`);
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window,`!!${dialog}`);
  await window.webContents.executeJavaScript(`[...${dialog}.querySelectorAll('button')].find(button=>button.textContent.includes('Ver en el mapa')).click()`);
  await waitUntil(window,`!${dialog}`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-recenter').getAttribute('aria-label')`),'Centrar mi ubicación');
  mode = 'visible';
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').focus();document.querySelector('.incident-row').click()`);
  await waitUntil(window,`!!${dialog}`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').click()`);
  await waitUntil(window,`!${dialog}`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('.incident-row')`),true,'Cerrar una tarjeta con foco dentro debe devolverlo al reporte seleccionado');
  mode='initial-reference';
  await window.webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(window,`${dialog}?.textContent.includes('Fotografía de referencia: Incendio ilustrativo.')`);
  const credit=await window.webContents.executeJavaScript(`(() => {const link=[...${dialog}.querySelectorAll('a')].find(a=>a.textContent.includes('Autor de prueba'));return {href:link?.href,label:link?.textContent,alt:${dialog}.querySelector('img[alt^="Fotografía de referencia"]')?.alt};})()`);
  assert.deepEqual(credit,{href:'https://commons.wikimedia.org/wiki/File:Example.jpg',label:'Autor de prueba · CC BY-SA 4.0',alt:'Fotografía de referencia: Incendio ilustrativo'});
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').click()`);
  await waitUntil(window,`!${dialog}`);
  for (const [width,height] of [[1400,768],[320,640]]) {
    for (const theme of ['light','dark']) {
      mode='modal';modalReady=false;
      window.webContents.disableDeviceEmulation();window.setContentSize(Math.max(width,800),height);
      await window.loadURL(`${origin}/incidentes/${fixture.id}`);
      window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},viewSize:{width,height},deviceScaleFactor:1,scale:1});
      await waitUntil(window,`innerWidth===${width}&&!!document.querySelector('.app-header .brand')`);
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.app-header .brand').focus()`);
      modalReady=true;for(const release of pendingModal.splice(0))release();
      await waitUntil(window,`${dialog}?.textContent.includes('Contexto público 14') && !!document.querySelector('#chat-message')`);
      assert.equal(await window.webContents.executeJavaScript(`${dialog}.getAttribute('aria-modal')`),'true');
      assert.equal(await window.webContents.executeJavaScript(`document.body.style.overflow`),'hidden','El detalle completo debe bloquear el desplazamiento exterior');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('button[aria-label="Cerrar detalle"]')`),true,'El diálogo debe recibir el foco al abrirse');
      const modalLayout=await window.webContents.executeJavaScript(`(() => {const panel=${dialog},body=panel.lastElementChild,rect=panel.getBoundingClientRect();body.scrollTop=body.scrollHeight;const end=body.querySelector('button[type="submit"],form:last-child button:last-child')?.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:innerHeight,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,scrollTop:body.scrollTop,endTop:end?.top,endBottom:end?.bottom};})()`);
      assert.ok(modalLayout.scrollHeight>modalLayout.clientHeight&&modalLayout.scrollTop>0,'El cuerpo del diálogo debe poder desplazarse hasta el final');
      assert.ok(modalLayout.left>=0&&modalLayout.right<=width+1&&modalLayout.top>=0&&modalLayout.bottom<=height+1);
      assert.ok(modalLayout.endTop>=0&&modalLayout.endBottom<=height+1,'La acción final del detalle debe quedar accesible tras el scroll');
      assert.ok(modalLayout.scrollWidth<=width+1,'El detalle completo no debe producir desbordamiento horizontal');
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}))`);
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('#chat-message')`),true,'Mayús+Tab debe mantener el foco dentro del diálogo');
      await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))`);
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('button[aria-label="Cerrar detalle"]')`),true,'Tab debe cerrar el ciclo de foco dentro del diálogo');
      layouts.push({variant:'dialog',theme,...modalLayout});
      await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await delay(150);
      await fs.writeFile(path.join(local,'detalle-completo-'+width+'-'+theme+'.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar detalle"]').click()`);
      await waitUntil(window,`location.pathname==='/mapa'&&!${dialog}`);
      assert.equal(await window.webContents.executeJavaScript(`document.body.style.overflow`),'','Cerrar el detalle debe restaurar el desplazamiento exterior');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement===document.querySelector('.app-header .brand')`),true,'Cerrar el detalle debe restaurar el foco anterior');
    }
  }
  assert.equal(requests.some(request=>request.url==='/api/uploads/private-proof'),false,'Tampoco el diálogo completo debe solicitar pruebas privadas');
  const result = {passed:true,scenarios:['Incidente cercano ausente del listado general','Tarjeta no modal con imagen pública sin solicitar pruebas privadas','503 conserva detalle y muestra aviso','200 privado autorizado actualiza estado','404 cierra tarjeta sin robar foco de otro control','Respuesta tardía después de desmontar ignorada','Ocho layouts/temas con scroll interno y sin desbordamiento','Escape respeta foco y Ver en mapa cierra tarjeta conservando GPS','Cerrar tarjeta devuelve foco al reporte seleccionado','Fotografía ilustrativa conserva crédito público, licencia, fuente y texto accesible','Detalle completo PC/320 en ambos temas: scroll final accesible, bloqueo exterior, ciclo de foco y restauración'],layouts,blockedHosts:[...blockedHosts],requests:requests.length};
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
