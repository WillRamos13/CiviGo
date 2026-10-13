/* eslint-disable @typescript-eslint/no-require-imports */
// Run with desktop/node_modules/electron/dist/electron.exe and an existing
// Next server whose BACKEND_URL points to this loopback fixture. No real users.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const origin = `http://127.0.0.1:${frontendPort}`;
const local = path.resolve(__dirname, '../.local/agent-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), {recursive:true});
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('La prueba del agente excedió tres minutos.'); app.exit(1); }, 180000).unref();
const windows = [], requests = [], scenarios = [], errors = [], blockedHosts = new Set();
let currentCase = '', user, incident, conversation;
function reset(name, grants, options = {}) {
  currentCase = name;
  user = {id:901,nickname:'Agente de prueba',correo:'fixture@example.invalid',rol:options.role || 'AGENTE',tipoAgente:'SERENAZGO',distrito:'Ica',permisos:grants,correoVerificado:true,bloqueado:!!options.blocked,premium:false,monedas:0};
  incident = {
    id:912,tipo:'Bache',tipoNombre:'Bache',tipoSlug:'bache',tipoId:21,descripcion:'Bache de prueba local',distrito:'Ica',
    latitud:-14.0678,longitud:-75.7286,estado:'ACTIVO',nivelRiesgo:2,individual:false,publicado:true,validacion:.5,evaluacion:'IA',
    fechaCreacion:'2026-10-13T12:00:00Z',fechaEvento:'2026-10-13T12:00:00Z',totalReportes:1,
    reportes:[{id:913,descripcion:'Contexto del bache de prueba',estado:'PENDIENTE',evidenciaPrivada:false,fechaCreacion:'2026-10-13T12:00:00Z',usuario:{nickname:'Ciudadano de prueba'},adjuntos:[]}],
    flags:[{id:914,tipo:'NO_ENCONTRADO',motivo:'Aviso de prueba pendiente',estado:'PENDIENTE'}],revisiones:[],
  };
  conversation = [{id:915,mensaje:'Mensaje de prueba que requiere moderación',creadoEn:'2026-10-13T12:00:00Z',usuario:{nickname:'Ciudadano de prueba'},retirado:false}];
}
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type','application/json');
  response.setHeader('Cache-Control','no-store');
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const entry = {scenario:currentCase,method:request.method,url:pathname};
  requests.push(entry);
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  if (body) entry.body = body;
  const reply = (value, status = 200) => {response.statusCode = status;response.end(JSON.stringify(value));};
  if (pathname === '/api/users/me') return reply({usuario:user});
  if (pathname === '/api/announcements') return reply([]);
  if (pathname === '/api/catalog') return reply({categorias:[{id:2,nombre:'Infraestructura',tipos:[{id:21,nombre:'Bache',slug:'bache',individual:false,activo:true}]}],config:{},distritos:['Ica']});
  if (pathname === '/api/admin/incidents') {
    if (user.rol !== 'AGENTE' || user.bloqueado || !user.permisos.includes('consultar')) return reply({error:'No autorizado en el fixture'},403);
    return reply({items:[incident],total:1,page:1,pageSize:50,pages:1});
  }
  if (pathname === '/api/admin/incidents/912/messages' && request.method === 'GET') return reply(conversation);
  if (pathname === '/api/admin/incidents/912/review' && request.method === 'POST') {
    if (!user.permisos.includes('validar') || body.accion !== 'VALIDAR') return reply({error:'Decisión no permitida en fixture'},403);
    incident.estado='VALIDADO';incident.evaluacion='AGENTE';incident.validacion=1;
    return reply(incident);
  }
  if (pathname === '/api/admin/incidents/912/messages/915/moderate' && request.method === 'POST') {
    if (!user.permisos.includes('moderar') || typeof body.motivo !== 'string' || body.motivo.length < 5) return reply({error:'Moderación no permitida en fixture'},403);
    if (body.accion === 'RETIRAR') conversation[0]={...conversation[0],mensaje:'[Mensaje retirado por moderación]',retirado:true};
    else if (body.accion === 'RESTAURAR') conversation[0]={...conversation[0],mensaje:'Mensaje de prueba que requiere moderación',retirado:false};
    else return reply({error:'Acción desconocida en fixture'},400);
    return reply(conversation[0]);
  }
  return reply({error:'Ruta no incluida en el fixture local'},404);
});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));
async function waitUntil(window, expression, timeout = 25000) {
  const limit = Date.now()+timeout;
  while (Date.now()<limit) {if(await window.webContents.executeJavaScript(expression)) return;await delay(100);}
  const content=await window.webContents.executeJavaScript('document.body.innerText');
  throw new Error(`No se cumplió ${expression}\n${content.slice(0,3000)}`);
}
async function createWindow(name, width = 1280, height = 800) {
  const window = new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:`agent-${name}-${Date.now()}`}});
  windows.push(window);
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url), allowed=(url.hostname==='127.0.0.1'&&url.port===String(frontendPort)&&['http:','ws:'].includes(url.protocol)) || ['data:','blob:'].includes(url.protocol) || url.href==='about:blank';
    if(!allowed) blockedHosts.add(url.hostname || url.protocol);
    callback({cancel:!allowed});
  });
  window.webContents.on('console-message',(_event,info)=>{
    if(info.level==='error'&&/hydration|uncaught|error boundary|react error/i.test(info.message))errors.push(info.message);
  });
  window.webContents.on('render-process-gone',(_event,details)=>errors.push(`Renderer: ${details.reason}`));
  await window.loadURL(`${origin}/agente`);
  assert.equal(window.isVisible(),false);
  return window;
}
let sequence = 0;
async function clickElement(window, expression) {
  const key=`target-${++sequence}`;
  await window.webContents.executeJavaScript(`(() => {const target=${expression};if(!target)throw new Error('Control de prueba no encontrado');target.dataset.agentSmoke=${JSON.stringify(key)};target.scrollIntoView({block:'center',inline:'nearest'});})()`);
  await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const point=await window.webContents.executeJavaScript(`(() => {const target=document.querySelector('[data-agent-smoke="${key}"]'),rect=target.getBoundingClientRect(),x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2),hit=document.elementFromPoint(x,y);return {x,y,clickable:rect.width>0&&rect.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(hit===target||target.contains(hit))&&!target.disabled};})()`);
  assert.equal(point.clickable,true,'El control debe estar visible y recibir el clic');
  window.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
  window.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
  await delay(100);
}
const button = label => `[...document.querySelectorAll('button')].find(element=>element.textContent.trim()===${JSON.stringify(label)})`;
const field = label => `[...document.querySelectorAll('label')].find(element=>element.textContent.includes(${JSON.stringify(label)}))?.querySelector('textarea')`;
async function enterReason(window,label,value){await clickElement(window,field(label));window.webContents.insertText(value);await delay(100);}
async function openIncident(window){await waitUntil(window,`${button('Revisar')}!==undefined`);await clickElement(window,button('Revisar'));await waitUntil(window,`!!document.getElementById('review-title')`);}
async function capture(window,name){await fs.writeFile(path.join(local,`${name}.png`),(await window.webContents.capturePage()).toPNG());}
const mutations = name => requests.filter(request=>request.scenario===name&&request.method!=='GET');
async function run(){
  server.listen(fixturePort,'127.0.0.1');await once(server,'listening');await app.whenReady();
  for(const [name,width] of [['consultar-pc',1280],['consultar-movil',390]]){
    reset(name,['consultar']);const window=await createWindow(name,width,width===390?844:800);await openIncident(window);
    const access=await window.webContents.executeJavaScript(`({buttons:[...document.querySelectorAll('button')].map(button=>button.textContent.trim()),text:document.body.innerText})`);
    for(const label of ['Guardar decisión','Revisar este aporte','Confirmar moderación'])assert.equal(access.buttons.includes(label),false,`${name}: no mutation button ${label}`);
    assert.equal(access.text.includes('Moderar conversación'),false);assert.equal(access.text.includes('Registrar atención del aviso'),false);
    assert.equal(mutations(name).length,0);await capture(window,name);window.destroy();scenarios.push({test:name,passed:true});
  }
  reset('validar',['consultar','validar']);let window=await createWindow('validar');await openIncident(window);
  const decisions=await window.webContents.executeJavaScript(`(() => {const form=[...document.querySelectorAll('form')].find(form=>form.textContent.includes('Registrar decisión del incidente'));return [...form.querySelector('select').options].map(option=>option.value);})()`);
  assert.deepEqual(decisions,['VALIDAR']);
  assert.equal(await window.webContents.executeJavaScript(`document.body.innerText.includes('Declarar aporte falso')||document.body.innerText.includes('Moderar conversación')`),false);
  await enterReason(window,'Motivo de la decisión','Revisión humana de la información del fixture local.');await clickElement(window,button('Guardar decisión'));
  await waitUntil(window,`document.body.innerText.includes('La decisión quedó registrada')`);
  assert.equal(mutations('validar').length,1);assert.equal(mutations('validar')[0].url,'/api/admin/incidents/912/review');assert.equal(mutations('validar')[0].body.accion,'VALIDAR');
  assert.ok(mutations('validar')[0].body.motivo.length>=5);await capture(window,'validar');window.destroy();scenarios.push({test:'validar sin falsedad, resolución, reclasificación ni moderación',passed:true});
  reset('moderar',['consultar','moderar']);window=await createWindow('moderar');await openIncident(window);
  await waitUntil(window,`${button('Retirar mensaje')}!==undefined`);await clickElement(window,button('Retirar mensaje'));
  await waitUntil(window,`${button('Confirmar moderación')}!==undefined`);
  await clickElement(window,button('Confirmar moderación'));assert.equal(mutations('moderar').length,0,'El motivo vacío debe impedir la moderación');
  await enterReason(window,'Motivo de moderación','Contenido inapropiado según la revisión del fixture.');await clickElement(window,button('Confirmar moderación'));
  await waitUntil(window,`document.body.innerText.includes('La decisión quedó registrada')`);await openIncident(window);
  await waitUntil(window,`${button('Restaurar mensaje')}!==undefined`);assert.equal(conversation[0].retirado,true);await capture(window,'mensaje-retirado');
  await clickElement(window,button('Restaurar mensaje'));await enterReason(window,'Motivo de moderación','Revisión adicional: corresponde restaurar el mensaje.');await clickElement(window,button('Confirmar moderación'));
  await waitUntil(window,`document.body.innerText.includes('La decisión quedó registrada')`);await openIncident(window);
  await waitUntil(window,`${button('Retirar mensaje')}!==undefined`);assert.equal(conversation[0].retirado,false);
  assert.deepEqual(mutations('moderar').map(request=>request.body.accion),['RETIRAR','RESTAURAR']);assert.ok(mutations('moderar').every(request=>request.url.endsWith('/messages/915/moderate')&&request.body.motivo.length>=5));
  assert.equal(await window.webContents.executeJavaScript(`${button('Guardar decisión')}!==undefined`),false);await capture(window,'mensaje-restaurado');window.destroy();scenarios.push({test:'moderación y restauración con motivo mediante clic real',passed:true});
  for(const [name,options,expected] of [['ciudadano',{role:'USUARIO'},'Acceso restringido'],['bloqueado',{blocked:true},'Cuenta restringida']]){
    reset(name,['consultar','validar','moderar'],options);window=await createWindow(name);await waitUntil(window,`document.body.innerText.includes(${JSON.stringify(expected)})`);
    assert.equal(requests.filter(request=>request.scenario===name&&request.url.startsWith('/api/admin')).length,0,'Una cuenta sin acceso no debe consultar administración');assert.equal(mutations(name).length,0);await capture(window,name);window.destroy();scenarios.push({test:name,passed:true});
  }
  assert.deepEqual(errors,[]);assert.equal(blockedHosts.size,0);
  await fs.writeFile(path.join(local,'resultados.json'),JSON.stringify({scenarios,requests,errors,blockedHosts:[...blockedHosts]},null,2));
  console.log(JSON.stringify({passed:scenarios.length,apiRequests:requests.length,mutations:requests.filter(request=>request.method!=='GET').length,externalRequests:blockedHosts.size,artifactDirectory:local}));
}
run().then(()=>app.exit(0)).catch(async error=>{
  console.error(error.stack || String(error));
  for(const [index,window] of windows.entries())if(!window.isDestroyed())await capture(window,`fallo-${index}`).catch(()=>{});
  await fs.writeFile(path.join(local,'fallo.json'),JSON.stringify({error:String(error),scenarios,requests,errors},null,2));app.exit(1);
}).finally(()=>{for(const window of windows)if(!window.isDestroyed())window.destroy();server.close();});
