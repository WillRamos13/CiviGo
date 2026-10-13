/* eslint-disable @typescript-eslint/no-require-imports */
// Actual desktop/mobile browser rendering, with only loopback API fixtures.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const local = path.resolve(__dirname, '../.local/announcements-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), {recursive:true});
app.setPath('userData',local); app.setPath('sessionData',path.join(local,'session'));
app.disableHardwareAcceleration(); app.on('window-all-closed',()=>{});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW9sAAAAASUVORK5CYII=','base64');
const imageId = '12345678-1234-1234-1234-123456789012';
const items = [
  {id:1,tipo:'NOVEDAD',titulo:'Promoción ilustrativa',mensaje:'',enlace:'https://example.test/promocion',negocio:null,imagen:{id:imageId,alt:'Promoción accesible de prueba'}},
  {id:2,tipo:'NOVEDAD',titulo:'Novedad de texto',mensaje:'Los anuncios anteriores siguen funcionando.',enlace:'/mapa',negocio:null},
  {id:3,tipo:'NEGOCIO',titulo:'Anuncio de negocio',mensaje:'Conoce su ficha',enlace:null,negocio:{id:10,nombre:'Negocio local ilustrativo',latitud:-14.06,longitud:-75.72},imagen:{id:imageId,alt:'Publicidad de negocio'}},
  {id:4,tipo:'NOVEDAD',titulo:'Imagen ausente',mensaje:'El texto sigue visible.',enlace:null,negocio:null,imagen:{id:imageId,alt:'Imagen ausente'}},
  {id:5,tipo:'NOVEDAD',titulo:'Enlace inválido',mensaje:'No debe abrir contenido inseguro.',enlace:'javascript:alert(1)',negocio:null},
];
const reportItems = [
  {id:101,tipo:'NOVEDAD',ubicacion:'REPORTAR',titulo:'Banner lateral ilustrativo',mensaje:'Contenido publicitario administrable en Reportar.',enlace:'https://example.test/banner',negocio:null,imagen:{id:imageId,alt:'Banner lateral accesible'}},
  {id:102,tipo:'NEGOCIO',ubicacion:'REPORTAR',titulo:'Negocio del lateral',mensaje:'Consulta la ficha del negocio',enlace:null,negocio:{id:11,nombre:'Negocio lateral ilustrativo',latitud:-14.06,longitud:-75.72},imagen:{id:imageId,alt:'Publicidad lateral de negocio'}},
  {id:103,tipo:'NOVEDAD',ubicacion:'REPORTAR',titulo:'Banner sin imagen disponible',mensaje:'El contenido permanece legible.',enlace:null,negocio:null,imagen:{id:imageId,alt:'Imagen lateral ausente'}},
  {id:104,tipo:'NOVEDAD',ubicacion:'REPORTAR',titulo:'Banner con enlace inseguro',mensaje:'El enlace debe quedar deshabilitado.',enlace:'javascript:alert(1)',negocio:null},
];
let premium = false, emptyReports = false, verified = true, phase = 'anuncios';
const requestedPlacements = [], requests = [], errors = [], blockedHosts = new Set();
const server = http.createServer(async (request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  let body=''; for await(const chunk of request) body+=chunk;
  const entry={phase,method:request.method,path:url.pathname};
  if(body&&request.headers['content-type']?.startsWith('application/json'))entry.body=JSON.parse(body);
  requests.push(entry);
  response.setHeader('Content-Type','application/json'); response.setHeader('Cache-Control','no-store');
  if(url.pathname==='/api/users/me') return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario ilustrativo',correoVerificado:verified,rol:'USUARIO',premium,ocultarAnuncios:premium}}));
  if(url.pathname==='/api/announcements') {
    requestedPlacements.push(url.searchParams.get('ubicacion') || 'CABECERA');
    return response.end(JSON.stringify(url.searchParams.get('ubicacion')==='REPORTAR' ? (emptyReports?[]:reportItems) : items));
  }
  if(/^\/api\/announcements\/(?:1|3|101|102)\/image$/.test(url.pathname)) {response.setHeader('Content-Type','image/png');return response.end(png);}
  if(/^\/api\/announcements\/(?:4|103)\/image$/.test(url.pathname)) {response.statusCode=404;return response.end('{"error":"No disponible"}');}
  if(url.pathname==='/api/catalog') return response.end(JSON.stringify({categorias:[{id:3,nombre:'Infraestructura',slug:'infraestructura',tipos:[{id:27,nombre:'Bache',slug:'bache',emergencia:false,historico:false,fotoObligatoria:true,individual:false,ubicacionRemota:false}]}],distritos:['Ica'],config:{maxVideoBytes:15728640}}));
  if(url.pathname==='/api/uploads'&&request.method==='POST') {
    assert.ok(request.headers['content-type'].startsWith('multipart/form-data; boundary='));
    assert.ok(body.includes('name="archivo"')); assert.ok(body.includes('name="privado"\r\n\r\nfalse')); assert.ok(body.includes('name="tipo"\r\n\r\nPUBLICO'));
    response.statusCode=201; return response.end(JSON.stringify({id:'report-photo-fixture',nombre:'bache.png',mimeType:'image/png',url:'/api/uploads/report-photo-fixture',privado:false,tipo:'PUBLICO'}));
  }
  if(url.pathname==='/api/reports'&&request.method==='POST') {
    response.statusCode=201; return response.end(JSON.stringify({reporte:{id:950,tipo:'Bache',descripcion:entry.body.descripcion,estado:'PENDIENTE'},incidente:{id:951,tipo:'Bache',publicado:false,evaluacion:'PENDIENTE',estado:'ACTIVO',nivelRiesgo:null,totalReportes:1}}));
  }
  response.statusCode=404; response.end('{"error":"Ruta ajena al fixture"}');
});
const windows=[],scenarios=[],layouts=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(window,expression,timeout=20000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await window.webContents.executeJavaScript(expression))return;await delay(100);}
  throw new Error('No se cumplió: '+expression+'\n'+(await window.webContents.executeJavaScript('document.body.innerText')).slice(0,4000));
}
async function settle(window) {
  await window.webContents.executeJavaScript('Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),new Promise(resolve=>setTimeout(resolve,300))])');
  await delay(150);
}
async function capture(window,name) {
  const viewport=await window.webContents.executeJavaScript('({x:0,y:0,width:innerWidth,height:innerHeight})');
  await window.webContents.capturePage(viewport);
  await settle(window);
  await fs.writeFile(path.join(local,name+'.png'),(await window.webContents.capturePage(viewport)).toPNG());
}
let clickSequence=0;
async function clickElement(window,expression) {
  const key='report-'+ ++clickSequence;
  await window.webContents.executeJavaScript(`(()=>{const target=${expression};if(!target)throw new Error('Control de Reportar no encontrado');target.dataset.reportSmoke=${JSON.stringify(key)};target.scrollIntoView({block:'center',inline:'nearest'});})()`);
  await settle(window);
  const point=await window.webContents.executeJavaScript(`(()=>{const target=document.querySelector('[data-report-smoke="${key}"]'),rect=target.getBoundingClientRect(),x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2),hit=document.elementFromPoint(x,y);return{x,y,clickable:rect.width>0&&rect.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(hit===target||target.contains(hit))&&!target.disabled};})()`);
  assert.equal(point.clickable,true,'El control debe recibir el clic sin solapamientos');
  window.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
  window.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
  await delay(100);
}
const button=text=>`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
async function chooseType(window) {
  await waitUntil(window,`!!document.querySelector('#tipo option[value="bache"]')`);
  await window.webContents.executeJavaScript(`(()=>{const select=document.getElementById('tipo');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'bache');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(window,`!!document.querySelector('.location-editor')`);
}
const mutations=()=>requests.filter(request=>request.method!=='GET');
async function layout(window,width,name){
  const height=window.getContentBounds().height;
  window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},viewSize:{width,height},deviceScaleFactor:1,scale:1});
  await waitUntil(window,`innerWidth===${width}`);
  const result=await window.webContents.executeJavaScript(`(()=>{
    const rect=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};};
    return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,banner:rect('.map-announcements'),image:rect('.announcement-image'),brand:rect('.app-header .brand'),actions:rect('.header-actions')};
  })()`);
  assert.ok(result.scrollWidth<=width,name+': sin desbordamiento horizontal');
  assert.ok(result.image.width>0&&result.image.height>0,name+': imagen visible');
  assert.ok(result.brand.right<=result.banner.left+1,name+': no invade el logo');
  assert.ok(result.banner.right<=result.actions.left+1,name+': no invade los controles');
  assert.ok(result.image.left>=result.banner.left-1&&result.image.right<=result.banner.right+1,name+': imagen dentro de barra');
  assert.ok(result.image.top>=result.banner.top-1&&result.image.bottom<=result.banner.bottom+1,name+': imagen sin cortar');
  layouts.push({name,...result});
  await settle(window);
  await capture(window,name);
}
async function run(){
  server.listen(fixturePort,'127.0.0.1'); await once(server,'listening'); await app.whenReady();
  const window=new BrowserWindow({show:false,width:1400,height:850,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'announcements-'+Date.now()}});
  windows.push(window);
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url),allowed=(url.hostname==='127.0.0.1'&&url.port===String(frontendPort)&&['http:','ws:'].includes(url.protocol))||['data:','blob:','about:'].includes(url.protocol);
    if(!allowed)blockedHosts.add(url.hostname||url.protocol);callback({cancel:!allowed});
  });
  window.webContents.on('console-message',info=>{if(info.level==='error'&&/hydration|uncaught|error boundary|react error/i.test(info.message))errors.push(info.message);});
  window.webContents.on('render-process-gone',(_event,details)=>errors.push('Renderer: '+details.reason));
  await window.loadURL('http://127.0.0.1:'+frontendPort+'/ingresar');
  await waitUntil(window,`document.querySelector('.announcement-image')?.naturalWidth>0`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.announcement-image').alt`),'Promoción accesible de prueba');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('a.announcement-content').getAttribute('rel')`),'noopener noreferrer');
  await window.webContents.executeJavaScript(`document.querySelector('.map-announcements').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  for(const [width,name] of [[1400,'desktop-light'],[850,'tablet-light'],[390,'mobile-light'],[320,'mobile-small-light']]) await layout(window,width,name);
  await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
  for(const [width,name] of [[1400,'desktop-dark'],[850,'tablet-dark'],[390,'mobile-dark'],[320,'mobile-small-dark']]) await layout(window,width,name);
  scenarios.push('Imagen accesible y enlace HTTPS seguro; 8 tamaños/temas sin desbordamiento');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncio siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('.announcement-content strong')?.textContent==='Novedad de texto'`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.announcement-image')`),false);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('a.announcement-content').getAttribute('href')`),'http://127.0.0.1:'+frontendPort+'/mapa');
  scenarios.push('Anuncios de texto e internos mantienen funcionamiento');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncio siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('.announcement-image')?.naturalWidth>0`);
  await window.webContents.executeJavaScript(`document.querySelector('button.announcement-content').click()`);
  await waitUntil(window,`document.querySelector('[role="dialog"]')?.innerText.includes('Negocio local ilustrativo')`);
  await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[aria-label="Cerrar ficha"]')?.click()`);
  scenarios.push('Publicidad de negocio abre su ficha');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncio siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('.announcement-content strong')?.textContent==='Imagen ausente'&&!document.querySelector('.announcement-image')`);
  scenarios.push('Imagen no disponible conserva título y mensaje');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncio siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('.announcement-content strong')?.textContent==='Enlace inválido'`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('a.announcement-content')`),false);
  scenarios.push('Enlaces inseguros quedan sin acción');
  window.webContents.disableDeviceEmulation();
  await window.loadURL('http://127.0.0.1:'+frontendPort+'/reportar');
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"] img')?.naturalWidth>0`);
  await chooseType(window);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncios de Reportar"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));document.querySelector('.map-announcements').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncios de Reportar"] img').alt`),'Banner lateral accesible');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncios de Reportar"] a').rel`),'noopener noreferrer');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-announcements').innerText.includes('Banner lateral ilustrativo')`),false);
  assert.ok(requestedPlacements.includes('REPORTAR'));
  for(const [width,device] of [[1400,'desktop'],[850,'tablet'],[390,'mobile'],[320,'mobile-small']]) for(const theme of ['light','dark']) {
    const name=`report-${device}-${theme}`;
    window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height:850},viewPosition:{x:0,y:0},viewSize:{width,height:850},deviceScaleFactor:1,scale:1});
    await waitUntil(window,`innerWidth===${width}`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.scrollTo(0,0)`);
    await settle(window);
    assert.equal(await window.webContents.executeJavaScript('document.documentElement.dataset.theme'),theme);
    assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()`),theme==='dark'?'#ecf3ff':'#142033');
    const bounds=await window.webContents.executeJavaScript(`(()=>{const box=document.querySelector('[aria-label="Anuncios de Reportar"]').getBoundingClientRect(),image=document.querySelector('[aria-label="Anuncios de Reportar"] img').getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,imageWidth:image.width,imageHeight:image.height};})()`);
    assert.ok(bounds.scrollWidth<=width,name+': sin desbordamiento horizontal');
    assert.ok(bounds.left>=-1&&bounds.right<=width+1,name+': banner dentro del espacio disponible');
    assert.ok(bounds.imageWidth>0&&bounds.imageHeight>0,name+': imagen no oculta');
    const geometry=await window.webContents.executeJavaScript(`(()=>{const form=document.querySelector('form'),aside=document.querySelector('aside[aria-label="Publicidad en reportar"]'),rect=element=>{const box=element.getBoundingClientRect();return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width};};return{form:rect(form),cards:[...form.querySelectorAll(':scope > div > .card')].map(rect),aside:rect(aside),position:getComputedStyle(aside).position,stickyTop:parseFloat(getComputedStyle(aside).top)};})()`);
    assert.equal(geometry.cards.length,4,name+': cuatro secciones');
    for(let i=0;i<geometry.cards.length;i++){
      assert.ok(Math.abs(geometry.cards[i].left-geometry.cards[0].left)<2,name+': secciones en una columna');
      assert.ok(Math.abs(geometry.cards[i].width-geometry.cards[0].width)<2,name+': secciones de igual ancho');
      if(i)assert.ok(geometry.cards[i].top>=geometry.cards[i-1].bottom+12,name+': separación de secciones');
    }
    if(width>1050){
      assert.equal(geometry.position,'sticky');assert.ok(geometry.aside.left>=geometry.form.right+18);
      await window.webContents.executeJavaScript('window.scrollTo(0,400)');await settle(window);
      const stickyY=await window.webContents.executeJavaScript(`document.querySelector('aside[aria-label="Publicidad en reportar"]').getBoundingClientRect().top`);
      assert.ok(Math.abs(stickyY-geometry.stickyTop)<2,name+': banner visible durante el desplazamiento');
    }else{
      assert.equal(geometry.position,'static');assert.ok(geometry.aside.top>=geometry.form.bottom+12,name+': banner debajo del formulario');
    }
    layouts.push({name,...bounds,...geometry});
    await settle(window);
    await capture(window,name);
  }
  scenarios.push('Formulario en una columna y banner separado de cabecera, fijo en PC y debajo en móvil, en 8 tamaños/temas');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Banner siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Negocio del lateral')`);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncios de Reportar"] > button').click()`);
  await waitUntil(window,`document.querySelector('[role="dialog"]')?.innerText.includes('Negocio lateral ilustrativo')`);
  await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[aria-label="Cerrar ficha"]')?.click()`);
  scenarios.push('El banner del negocio abre su ficha existente');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Banner siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Banner sin imagen disponible')&&!document.querySelector('[aria-label="Anuncios de Reportar"] img')`);
  scenarios.push('Imagen lateral ausente conserva texto');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Banner siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Banner con enlace inseguro')`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Anuncios de Reportar"] a')`),false);
  scenarios.push('Banner lateral no abre enlaces inseguros');
  premium=true;
  await window.reload();
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Banner lateral ilustrativo')`);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Anuncios de Reportar"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));document.querySelector('[aria-label="Banner siguiente"]').click()`);
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Banner sin imagen disponible')`);
  scenarios.push('Premium oculta la publicidad de negocio lateral y conserva novedades');
  emptyReports=true;
  await window.reload();
  await waitUntil(window,`document.querySelector('[aria-label="Anuncios de Reportar"]').innerText.includes('Anuncios y novedades de CiviGo')&&!document.querySelector('[aria-label="Banner siguiente"]')`);
  scenarios.push('Sin anuncios laterales se muestra un espacio discreto sin promociones inventadas');
  phase='validaciones-y-envio';premium=false;emptyReports=false;
  window.webContents.disableDeviceEmulation();
  await window.loadURL('http://127.0.0.1:'+frontendPort+'/reportar');await chooseType(window);
  await window.webContents.executeJavaScript(`Object.defineProperty(navigator.geolocation,'getCurrentPosition',{configurable:true,value:success=>success({coords:{latitude:-14.0678,longitude:-75.7286,accuracy:5},timestamp:Date.now()})});`);
  await clickElement(window,button('Enviar reporte'));await waitUntil(window,`document.body.innerText.includes('Confirma que la ubicación es correcta.')`);assert.equal(mutations().length,0);
  await clickElement(window,button('Usar mi ubicación actual'));await waitUntil(window,`!!document.querySelector('.inline-checkbox input')`);
  await clickElement(window,button('Enviar reporte'));assert.equal(mutations().length,0);
  await clickElement(window,`document.querySelector('.inline-checkbox input')`);
  await clickElement(window,button('Enviar reporte'));await waitUntil(window,`document.body.innerText.includes('requiere al menos una fotografía')`);assert.equal(mutations().length,0);
  scenarios.push('GPS, confirmación de lugar y foto obligatoria validan antes de enviar datos');
  await clickElement(window,`document.getElementById('descripcion')`);window.webContents.insertText('Bache abierto frente a la esquina; afecta el paso de bicicletas.');
  await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png.toString('base64'))}),c=>c.charCodeAt(0))],'bache.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(window,`!!document.querySelector('button[aria-label="Quitar bache.png"]')`);await clickElement(window,button('Enviar reporte'));
  await waitUntil(window,`document.body.innerText.includes('Recibimos tu reporte #950')`);
  assert.deepEqual(mutations().map(request=>request.path),['/api/uploads','/api/reports']);
  const payload=mutations()[1].body;assert.equal(payload.tipo,'bache');assert.equal(payload.latitud,-14.0678);assert.equal(payload.longitud,-75.7286);assert.equal(payload.gpsLatitud,-14.0678);assert.equal(payload.gpsLongitud,-75.7286);assert.deepEqual(payload.adjuntosIds,['report-photo-fixture']);assert.ok(payload.descripcion.includes('Bache abierto'));assert.ok(Number.isFinite(Date.parse(payload.fechaEvento)));
  await settle(window);await capture(window,'report-envio');
  scenarios.push('Descripción y fotografía pública llegan al reporte con GPS y fecha; se muestra recepción');
  verified=false;phase='gmail-no-verificado';
  window.webContents.enableDeviceEmulation({screenPosition:'mobile',screenSize:{width:390,height:850},viewPosition:{x:0,y:0},viewSize:{width:390,height:850},deviceScaleFactor:1,scale:1});
  await window.loadURL('http://127.0.0.1:'+frontendPort+'/reportar');
  await waitUntil(window,`document.body.innerText.includes('Verifica tu Gmail para participar')`);assert.equal(await window.webContents.executeJavaScript('!!document.querySelector("form")'),false);
  assert.equal(requests.filter(request=>request.phase===phase&&request.path==='/api/reports').length,0);
  await settle(window);await capture(window,'report-gmail-no-verificado');
  scenarios.push('Gmail no verificado conserva bloqueo de participación y no envía reportes');
  assert.deepEqual(errors,[]);assert.equal(blockedHosts.size,0);
  await fs.writeFile(path.join(local,'resultado.json'),JSON.stringify({passed:true,scenarios,layouts,requestedPlacements,requests,errors,blockedHosts:[...blockedHosts]},null,2));
  console.log(JSON.stringify({passed:true,scenarios,layouts:layouts.length,mutations:mutations().length,externalRequests:blockedHosts.size}));
  window.destroy();server.close();app.exit(0);
}
setTimeout(()=>{console.error('Prueba de anuncios y Reportar excedió cuatro minutos.');app.exit(1);},240000).unref();
run().catch(async error=>{
  console.error(error.stack||error);
  for(const [index,window]of windows.entries())if(!window.isDestroyed()){
    await fs.writeFile(path.join(local,`fallo-${index}.png`),(await window.webContents.capturePage()).toPNG()).catch(()=>{});window.destroy();
  }
  await fs.writeFile(path.join(local,'fallo.json'),JSON.stringify({error:String(error),phase,scenarios,layouts,requests,errors,blockedHosts:[...blockedHosts]},null,2)).catch(()=>{});
  server.close();app.exit(1);
});
