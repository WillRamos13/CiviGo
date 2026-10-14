/* eslint-disable @typescript-eslint/no-require-imports */
// Uses the installed Mapbox renderer, but redirects its style to a local fixture
// and cancels provider telemetry. No external tile, API or paid provider call.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const fixturePort=Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT||55713),frontendPort=Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT||55712);
const origin=`http://127.0.0.1:${frontendPort}`,output=path.resolve(__dirname,'../.local/map-camera-live-smoke');
require('node:fs').mkdirSync(path.join(output,'session'),{recursive:true});app.setPath('userData',output);app.setPath('sessionData',path.join(output,'session'));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');app.on('window-all-closed',()=>{});
const requests=[],redirectedStyles=[],localSessions=[],cancelledProviders=[],unexpected=[],errors=[],diagnostics=[],stages=[],layouts=[],windows=[];
const gps={latitud:-14.0887,longitud:-75.73545};let failSecond=false,delayFirst=true;
let rows=Array.from({length:550},(_,index)=>({id:550-index,tipo:'Bache',tipoNombre:'Bache',tipoSlug:'bache',descripcion:`Registro local de prueba ${550-index}`,latitud:-13.8-(index%20)*.03,longitud:-75.9+(index%15)*.025,estado:'VALIDADO',publicado:true,gravedad:2,nivelRiesgo:2,evaluacion:'AGENTE',totalReportes:1,confirmaciones:1,fechaEvento:'2026-10-13T12:00:00Z',fechaCreacion:'2026-10-13T12:00:00Z',adjuntos:[]}));
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');requests.push({method:request.method,url:request.url});response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.setHeader('Access-Control-Allow-Origin','*');
  if(url.pathname==='/api/qa/map-style')return response.end(JSON.stringify({version:8,sources:{},layers:[{id:'local-background',type:'background',paint:{'background-color':'#11253b'}}]}));
  if(url.pathname==='/api/qa/map-session')return response.end('{}');
  if(url.pathname==='/api/users/me')return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario local',correo:'fixture@example.invalid',correoVerificado:true,rol:'USUARIO',premium:false}}));
  if(url.pathname==='/api/catalog')return response.end(JSON.stringify({categorias:[{id:1,nombre:'Infraestructura',slug:'infraestructura',tipos:[{id:1,nombre:'Bache',slug:'bache',emergencia:false}]}],distritos:['Ica'],config:{}}));
  if(url.pathname==='/api/incidents'){
    if(!url.searchParams.has('bbox'))return response.end('[]');
    const box=url.searchParams.get('bbox').split(',').map(Number),after=Number(url.searchParams.get('after'))||Infinity;
    if(failSecond&&Number.isFinite(after)){response.statusCode=503;return response.end('{"error":"Segunda página no disponible en el fixture"}');}
    const filtered=rows.filter(row=>row.id<after&&row.longitud>=box[0]&&row.longitud<=box[2]&&row.latitud>=box[1]&&row.latitud<=box[3]).sort((a,b)=>b.id-a.id),items=filtered.slice(0,250);
    const send=()=>response.end(JSON.stringify({items,nextCursor:filtered.length>items.length?items.at(-1).id:null}));
    if(delayFirst&&!url.searchParams.has('after')){delayFirst=false;setTimeout(send,700);}else send();return;
  }
  if(url.pathname==='/api/navigation/roads/risk')return response.end('{"version":"local","revision":"1","values":[]}');
  if(url.pathname==='/api/navigation/roads/geometry')return response.end('{"type":"FeatureCollection","version":"local","features":[]}');
  if(url.pathname==='/api/navigation/traffic/status')return response.end('{"configurado":false,"habilitado":false}');
  if(url.pathname==='/api/navigation/traffic/incidents')return response.end('{"incidentes":[],"trafico":{"disponible":false}}');
  if(['/api/announcements','/api/navigation/favorites','/api/navigation/history','/api/businesses'].includes(url.pathname))return response.end('[]');
  response.statusCode=404;response.end('{"error":"Ruta ajena a la prueba local"}');
});
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function waitUntil(window,expression,timeout=20000){const limit=Date.now()+timeout;while(Date.now()<limit){if(await window.webContents.executeJavaScript(expression))return;await delay(100);}throw new Error(`No se cumplió: ${expression}\n${await window.webContents.executeJavaScript('document.body.innerText')}`);}
async function click(window,selector){
  const point=await window.webContents.executeJavaScript(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'nearest',behavior:'instant'});const r=button.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return{x,y,allowed:!button.disabled&&(hit===button||button.contains(hit))};})()`);
  assert.equal(point.allowed,true,'Control habilitado y sin superposiciones');window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});await delay(100);
}
async function viewport(window,width,height){window.setContentSize(width,height);await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await waitUntil(window,`innerWidth===${width}`);await window.webContents.executeJavaScript('window.__qaMap?.resize();void 0');await delay(150);}
async function run(){
  server.listen(fixturePort,'127.0.0.1');await once(server,'listening');await app.whenReady();
  const window=new BrowserWindow({show:false,width:1400,height:850,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true,partition:`map-camera-${Date.now()}`}});windows.push(window);
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url);
    if(url.hostname==='api.mapbox.com'&&url.pathname.startsWith('/styles/v1/')){redirectedStyles.push(url.pathname);callback({redirectURL:`${origin}/api/qa/map-style`});return;}
    if(url.hostname==='api.mapbox.com'&&url.pathname.startsWith('/map-sessions/v1')){localSessions.push(url.pathname);callback({redirectURL:`${origin}/api/qa/map-session`});return;}
    const allowed=url.hostname==='127.0.0.1'&&url.port===String(frontendPort)&&['http:','ws:'].includes(url.protocol)||['about:','blob:','data:'].includes(url.protocol);
    if(!allowed){if(['api.mapbox.com','events.mapbox.com'].includes(url.hostname))cancelledProviders.push(url.hostname+url.pathname);else unexpected.push(url.hostname);}
    callback({cancel:!allowed});
  });
  window.webContents.on('console-message',event=>{if(event.level==='error')diagnostics.push(event.message);if(event.level==='error'&&/Hydration|React|uncaught|TypeError|ReferenceError|WebGL unsupported/i.test(event.message))errors.push(event.message);});
  await window.loadURL('about:blank');window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`window.__gpsFix=${JSON.stringify(gps)};const callbacks=new Map();let id=0;navigator.permissions.query=async()=>({state:'granted',addEventListener(){},removeEventListener(){}});navigator.geolocation.watchPosition=success=>{const key=++id;callbacks.set(key,success);setTimeout(()=>success({coords:{latitude:window.__gpsFix.latitud,longitude:window.__gpsFix.longitud,accuracy:5},timestamp:Date.now()}),0);return key;};navigator.geolocation.clearWatch=key=>callbacks.delete(key);navigator.geolocation.getCurrentPosition=success=>success({coords:{latitude:window.__gpsFix.latitud,longitude:window.__gpsFix.longitud,accuracy:5},timestamp:Date.now()});`});
  await viewport(window,1400,850);await window.loadURL(`${origin}/mapa`);
  await waitUntil(window,`(()=>{const element=document.querySelector('.map-container'),key=element&&Object.keys(element).find(key=>key.startsWith('__reactFiber$'));if(!key)return false;for(let fiber=element[key];fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook&&typeof hook==='object';hook=hook.next){const value=hook.memoizedState?.current;if(value&&typeof value.getBearing==='function'&&typeof value.easeTo==='function'){window.__qaMap=value;return value.isStyleLoaded();}}return false;})()`);
  await waitUntil(window,`document.querySelectorAll('.incident-marker[data-incident-id]').length===550`);
  assert.ok(redirectedStyles.length>0,'El SDK real obtiene exclusivamente un estilo local');
  const initialPages=requests.filter(request=>request.url.startsWith('/api/incidents?bbox='));assert.ok(initialPages.some(request=>request.url.includes('after=')));assert.ok(initialPages.every(request=>request.url.includes('bbox=-76.3%2C-15%2C-75.1%2C-13.3')));
  await window.webContents.executeJavaScript(`window.__keptMarker=document.querySelector('[data-incident-id="100"]');window.__qaMap.jumpTo({center:[-75.725,-14.07],zoom:15});void 0;`);await delay(500);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-incident-id]').length`),550);
  await window.webContents.executeJavaScript(`window.__qaMap.jumpTo({center:[-75.68,-14.4],zoom:14.5});void 0;`);await delay(500);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-incident-id]').length`),550);
  assert.equal(await window.webContents.executeJavaScript(`window.__keptMarker===document.querySelector('[data-incident-id="100"]')`),true);
  stages.push('La carga provincial termina aunque Mapbox publique primero un viewport pequeño; conserva 550 marcadores al mover y ampliar la vista');
  await window.webContents.executeJavaScript(`window.__qaMap.jumpTo({center:[-75.71,-14.02],zoom:15.5,bearing:110,pitch:40});void 0;`);
  const before=await window.webContents.executeJavaScript(`({center:window.__qaMap.getCenter().toArray(),zoom:window.__qaMap.getZoom(),gps:window.__gpsFix})`);
  await click(window,'[aria-label="Restablecer orientación"]');await waitUntil(window,`Math.abs(window.__qaMap.getBearing())<.01&&Math.abs(window.__qaMap.getPitch())<.01`);
  const north=await window.webContents.executeJavaScript(`({center:window.__qaMap.getCenter().toArray(),zoom:window.__qaMap.getZoom(),gps:window.__gpsFix})`);
  assert.ok(Math.abs(north.center[0]-before.center[0])<1e-8&&Math.abs(north.center[1]-before.center[1])<1e-8);assert.equal(north.zoom,before.zoom);assert.deepEqual(north.gps,before.gps);
  await click(window,'[aria-label="Centrar mi ubicación"]');await waitUntil(window,`Math.abs(window.__qaMap.getCenter().lat-(${gps.latitud}))<.000001&&Math.abs(window.__qaMap.getCenter().lng-(${gps.longitud}))<.000001`);
  stages.push('Orientación vuelve al norte y a vista plana sin mover el centro, zoom ni GPS; Mi ubicación sigue centrando de forma independiente');
  rows=rows.filter(row=>row.id!==549).map(row=>row.id===550?{...row,gravedad:5,nivelRiesgo:5}:row);
  await click(window,'[aria-label="Actualizar incidentes"]');await waitUntil(window,`document.querySelectorAll('[data-incident-id]').length===549&&document.querySelector('[data-incident-id="550"]')?.getAttribute('aria-label').includes('gravedad 5')`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('[data-incident-id="549"]')`),false);assert.equal(await window.webContents.executeJavaScript(`window.__keptMarker===document.querySelector('[data-incident-id="100"]')`),true);
  stages.push('La actualización retira el eliminado, muestra la gravedad nueva y conserva los marcadores sin cambios');
  failSecond=true;await click(window,'[aria-label="Actualizar incidentes"]');await waitUntil(window,`document.body.innerText.includes('El servicio de CiviGo no está disponible en este momento.')`);assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-incident-id]').length`),549);
  assert.equal(await window.webContents.executeJavaScript(`document.body.innerText.includes('Segunda página no disponible')`),false,'El fallo interno del servidor no se expone al ciudadano');
  failSecond=false;await click(window,'[aria-label="Actualizar incidentes"]');await waitUntil(window,`!document.body.innerText.includes('El servicio de CiviGo no está disponible en este momento.')`);
  stages.push('Un fallo en la segunda página mantiene el snapshot completo anterior y permite recuperar la actualización');
  for(const [width,height,name]of [[1400,850,'desktop'],[850,700,'tablet'],[390,844,'mobile'],[320,640,'mobile-small']])for(const theme of ['light','dark']){
    await viewport(window,width,height);await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};scrollTo({top:0,behavior:'instant'})`);await delay(150);
    const geometry=await window.webContents.executeJavaScript(`(()=>{const rect=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,map:rect('.map-frame'),route:rect('.map-route-panel'),gps:rect('.map-recenter'),orientation:rect('[aria-label="Restablecer orientación"]'),legend:rect('.risk-legend'),enabled:!document.querySelector('[aria-label="Restablecer orientación"]').disabled};})()`);
    const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    assert.ok(geometry.scrollWidth<=width);assert.equal(geometry.enabled,true);assert.ok(geometry.orientation.width>=44&&geometry.orientation.height>=44);assert.equal(overlaps(geometry.orientation,geometry.gps),false);assert.equal(overlaps(geometry.orientation,geometry.route),false);assert.equal(overlaps(geometry.orientation,geometry.legend),false);assert.ok(geometry.orientation.left>=geometry.map.left&&geometry.orientation.right<=geometry.map.right&&geometry.orientation.top>=geometry.map.top&&geometry.orientation.bottom<=geometry.map.bottom);
    layouts.push({name:`${name}-${theme}`,...geometry});await window.webContents.capturePage();await fs.writeFile(path.join(output,`${name}-${theme}.png`),(await window.webContents.capturePage()).toPNG());
  }
  stages.push('Orientación y ubicación accesibles juntos, sin tapar rutas ni leyenda, en 4 pantallas y ambos temas');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);const result={ok:true,stages,layouts,requests,redirectedStyles,cancelledProviders,externalNetworkRequests:0,errors};await fs.writeFile(path.join(output,'resultado.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,stages,layouts:layouts.length,externalNetworkRequests:0,errors}));window.destroy();server.close();app.exit(0);
}
setTimeout(()=>{console.error('La prueba local de cámara excedió 3 minutos');app.exit(1);},180000).unref();run().catch(async error=>{console.error(error.stack||error);for(const window of windows)if(!window.isDestroyed()){diagnostics.push(await window.webContents.executeJavaScript(`(()=>{let style=null;try{const value=window.__qaMap?.getStyle();style=value?{version:value.version,layers:value.layers.length,incidentFeatures:value.sources['civigo-incidents']?.data?.features?.length}:null;}catch{}return JSON.stringify({map:!!window.__qaMap,removed:window.__qaMap?._removed,style,loaded:window.__qaMap?.isStyleLoaded()});})()`).catch(()=>''));await fs.writeFile(path.join(output,'fallo.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});window.destroy();}await fs.writeFile(path.join(output,'fallo.json'),JSON.stringify({error:String(error),stages,requests,errors,diagnostics,redirectedStyles,localSessions,cancelledProviders,unexpected},null,2)).catch(()=>{});server.close();app.exit(1);});
