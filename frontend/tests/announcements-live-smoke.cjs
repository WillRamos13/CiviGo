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
const server = http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  response.setHeader('Content-Type','application/json'); response.setHeader('Cache-Control','no-store');
  if(url.pathname==='/api/users/me') return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario ilustrativo',correoVerificado:true,rol:'USUARIO',premium:false}}));
  if(url.pathname==='/api/announcements') return response.end(JSON.stringify(items));
  if(/^\/api\/announcements\/[13]\/image$/.test(url.pathname)) {response.setHeader('Content-Type','image/png');return response.end(png);}
  if(url.pathname==='/api/announcements/4/image') {response.statusCode=404;return response.end('{"error":"No disponible"}');}
  if(url.pathname==='/api/catalog') return response.end('{"categorias":[],"distritos":["Ica"],"config":{}}');
  response.statusCode=404; response.end('{"error":"Ruta ajena al fixture"}');
});
const windows=[],scenarios=[],layouts=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(window,expression,timeout=20000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await window.webContents.executeJavaScript(expression))return;await delay(100);}
  throw new Error('No se cumplió: '+expression);
}
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
  await fs.writeFile(path.join(local,name+'.png'),(await window.webContents.capturePage()).toPNG());
}
async function run(){
  server.listen(fixturePort,'127.0.0.1'); await once(server,'listening'); await app.whenReady();
  const window=new BrowserWindow({show:false,width:1400,height:850,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'announcements-'+Date.now()}});
  windows.push(window);
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url); callback({cancel:!(url.hostname==='127.0.0.1'&&url.port===String(frontendPort)&&['http:','ws:'].includes(url.protocol))&&!['data:','blob:','about:'].includes(url.protocol)});
  });
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
  await fs.writeFile(path.join(local,'resultado.json'),JSON.stringify({passed:true,scenarios,layouts},null,2));
  console.log(JSON.stringify({passed:true,scenarios,layouts:layouts.length}));
  window.destroy();server.close();app.exit(0);
}
setTimeout(()=>{console.error('Prueba de anuncios excedió tres minutos.');app.exit(1);},180000).unref();
run().catch(error=>{console.error(error.stack||error);for(const window of windows)if(!window.isDestroyed())window.destroy();server.close();app.exit(1);});
