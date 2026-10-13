/* eslint-disable @typescript-eslint/no-require-imports */
// Run with desktop/node_modules/electron/dist/electron.exe while Next listens
// on the frontend port. The browser and API fixtures stay entirely on loopback.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const origin = `http://127.0.0.1:${frontendPort}`;
const local = path.resolve(__dirname, '../.local/animated-brand-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
setTimeout(() => {
  console.error('La prueba local del logo excedió el límite de tres minutos.');
  app.exit(1);
},180000).unref();
const windows = [];
const scenarios = [];
const layouts = [];
const blockedHosts = new Set();
const apiRequests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  apiRequests.push(url.pathname);
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/users/me') return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario prueba',correo:'fixture@example.invalid',correoVerificado:true,rol:'USUARIO',premium:false,credibilidad:100}}));
  if (url.pathname === '/api/catalog') return response.end('{"categorias":[],"config":{},"distritos":["Ica"]}');
  if (url.pathname === '/api/navigation/roads') return response.end('{"type":"FeatureCollection","features":[]}');
  if (url.pathname === '/api/navigation/roads/geometry') return response.end('{"type":"FeatureCollection","version":"logo-fixture-v1","features":[]}');
  if (url.pathname === '/api/navigation/roads/risk') return response.end('{"version":"logo-fixture-v1","revision":"0","values":[]}');
  if (url.pathname === '/api/incidents' && url.searchParams.has('bbox')) return response.end('{"items":[],"nextCursor":null}');
  if (url.pathname === '/api/navigation/traffic/status') return response.end('{"configurado":false,"habilitado":false}');
  if (url.pathname === '/api/navigation/traffic/incidents') return response.end('{"incidentes":[],"trafico":{"disponible":false}}');
  if (['/api/incidents','/api/announcements','/api/navigation/favorites','/api/navigation/history','/api/businesses'].includes(url.pathname)) return response.end('[]');
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
async function createWindow(width, height, name, options = {}) {
  const window = new BrowserWindow({show:false,width,height,useContentSize:true,
    // Hidden native windows stop compositor frames; offscreen keeps rAF active
    // for the compatibility case without displaying a window on the laptop.
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:!!options.noFrameCallback,partition:`animated-brand-${name}-${Date.now()}`}});
  windows.push(window);
  const requests = [];
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details,callback) => {
    const url = new URL(details.url);
    requests.push(url.pathname);
    const localRequest = url.hostname === '127.0.0.1' && url.port === String(frontendPort) && ['http:','ws:'].includes(url.protocol);
    const allowed = localRequest || ['data:','blob:'].includes(url.protocol) || url.href==='about:blank';
    if (!allowed) blockedHosts.add(url.hostname || url.protocol);
    callback({cancel:!allowed || (!!options.blockVideo && url.pathname === '/civigo-logo-animado.mp4')});
  });
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:options.reducedMotion?'reduce':'no-preference'}]});
  const setup = `window.__brandFixtureApplied=true;
    ${options.noFrameCallback ? `HTMLVideoElement.prototype.requestVideoFrameCallback=undefined;HTMLVideoElement.prototype.cancelVideoFrameCallback=undefined;const originalBrandRaf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=function(callback){return originalBrandRaf(time=>{window.__brandRaf=(window.__brandRaf||0)+1;callback(time);});};const originalBrandPaint=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(...args){if(this.canvas.dataset.brandFrame==='video')window.__brandPaints=(window.__brandPaints||0)+1;return originalBrandPaint.apply(this,args);};` : ''}
    ${options.rejectAutoplay ? `HTMLMediaElement.prototype.play = function(){window.__rejectedBrandPlays = (window.__rejectedBrandPlays || 0) + 1;return Promise.reject(new DOMException('Autoplay rejected by local fixture','NotAllowedError'));};` : ''}
    ${options.blackFrames ? `const originalBrandPixels=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(x,y,width,height){return this.canvas.dataset.brandFrame==='probe'?new ImageData(width,height):originalBrandPixels.call(this,x,y,width,height);};` : ''}`;
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:setup});
  window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},viewSize:{width,height},deviceScaleFactor:1,scale:1});
  await window.loadURL(`${origin}/mapa`);
  assert.equal(await window.webContents.executeJavaScript('window.__brandFixtureApplied'),true,'The browser fixture must apply before the application loads');
  assert.equal(window.isVisible(),false);
  await waitUntil(window, `!!document.querySelector('.brand-animation') && !!document.querySelector('.map-announcements')`);
  return {window,requests};
}
async function inspectLayout(window, width, name) {
  const {height} = window.getContentBounds();
  window.webContents.enableDeviceEmulation({screenPosition:width<=900?'mobile':'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},viewSize:{width,height},deviceScaleFactor:1,scale:1});
  await waitUntil(window, `innerWidth === ${width}`);
  const layout = await window.webContents.executeJavaScript(`(() => {
    const selectors = ['.app-header .brand','.brand-animation','.map-announcements','.header-actions'];
    return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,
      rectangles:selectors.map(selector=>{const element=document.querySelector(selector),rect=element.getBoundingClientRect(),style=getComputedStyle(element);return {selector,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,visible:style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0};}),
      label:document.querySelector('.app-header .brand').getAttribute('aria-label'),href:document.querySelector('.app-header .brand').getAttribute('href')};
  })()`);
  assert.equal(layout.width,width);
  assert.ok(layout.documentWidth<=width,`${name}: no horizontal overflow`);
  assert.equal(layout.href,'/');
  assert.equal(layout.label,'CiviGo · Inicio');
  for (const rect of layout.rectangles) {
    assert.ok(rect.visible && rect.width>0 && rect.height>0,`${name}: visible ${rect.selector}`);
    assert.ok(rect.left>=-1 && rect.right<=width+1 && rect.top>=-1,`${name}: geometry ${rect.selector}`);
  }
  const brand = layout.rectangles[0], banner = layout.rectangles[2];
  assert.ok(brand.right<=banner.left+1,`${name}: logo and banner do not overlap`);
  layouts.push({name,...layout});
  await fs.writeFile(path.join(local,`${name}.png`),(await window.webContents.capturePage()).toPNG());
}
async function inspectTransparency(window, dark, fallback = false) {
  await waitUntil(window, `(() => { const canvas=document.querySelector(${JSON.stringify(fallback ? '.brand-animation-fallback' : '.brand-animation-renderer')}); if(!canvas) return false; const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let blue=0,letters=0; for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>100&&pixels[i+2]-pixels[i]>60)blue++;if(pixels[i+3]>100&&${dark ? 'pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180' : 'pixels[i]===7&&pixels[i+1]===30&&pixels[i+2]===50'})letters++;} return pixels[3]===0&&blue>10&&letters>5&&getComputedStyle(document.querySelector('.brand-animation')).backgroundColor==='rgba(0, 0, 0, 0)';})()`);
}
async function fallbackVisible(window) {
  await waitUntil(window, `(() => { const element=document.querySelector('.brand-animation-fallback');if(!element)return false;const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0; })()`);
}
async function run() {
  server.listen(fixturePort,'127.0.0.1');
  await once(server,'listening');
  await app.whenReady();
  const viewports = [[1400,768,'desktop'],[850,700,'tablet'],[390,844,'mobile'],[320,640,'mobile-small']];
  for (const [width,height,name] of viewports) {
    const {window,requests} = await createWindow(width,height,name);
    await waitUntil(window, `(() => {const video=document.querySelector('.brand-animation video');return video?.videoWidth>0&&video.currentTime>0.15&&!video.paused;})()`);
    const media = await window.webContents.executeJavaScript(`(() => {const video=document.querySelector('.brand-animation video');return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,muted:video.muted,playsInline:video.playsInline,loop:video.loop,controls:video.controls,hidden:video.getAttribute('aria-hidden'),tabIndex:video.tabIndex,currentTime:video.currentTime,src:video.getAttribute('src'),poster:video.getAttribute('poster')};})()`);
    assert.equal(media.width,1280);
    assert.equal(media.height,720);
    assert.ok(media.duration>5 && media.duration<6);
    assert.equal(media.muted,true);
    assert.equal(media.playsInline,true);
    assert.equal(media.loop,true);
    assert.equal(media.controls,false);
    assert.equal(media.hidden,'true');
    assert.equal(media.tabIndex,-1);
    assert.equal(media.src,'/civigo-logo-animado.mp4');
    assert.equal(media.poster,'/civigo-logo-animado-poster.png');
    assert.ok(requests.includes('/civigo-logo-animado.mp4'));
    await delay(250);
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.brand-animation video').currentTime>${media.currentTime}`),`${name}: decoded playback advances`);
    await waitUntil(window, `document.querySelector('.brand-animation video').currentTime>2.9`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    await inspectTransparency(window, false);
    await inspectLayout(window,width,`${name}-light`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
    await inspectTransparency(window, true);
    await inspectLayout(window,width,`${name}-dark`);
    if (name==='desktop') {
      await waitUntil(window, `(() => {const video=document.querySelector('.brand-animation video');return video.currentTime>video.duration-0.4;})()`,10000);
      await waitUntil(window, `(() => {const video=document.querySelector('.brand-animation video');return video.currentTime<1&&!video.paused&&!video.ended;})()`,4000);
      scenarios.push('MP4 real decodificado: termina un ciclo y vuelve a reproducirse automáticamente');
      await window.webContents.executeJavaScript(`document.querySelector('.chatbot-launcher').click()`);
      await waitUntil(window, `!!document.querySelector('#civigo-assistant')`);
      const help = await window.webContents.executeJavaScript(`(() => {const box=document.querySelector('#civigo-assistant');return {intro:box.querySelector('p').textContent,questions:[...box.querySelectorAll('.chat-list button')].map(button=>button.textContent)};})()`);
      assert.equal(help.intro,'Ayuda sobre reportes, rutas y reglas de CiviGo.');
      assert.ok(help.questions.includes('¿Cómo hago un reporte?'));
      await window.webContents.executeJavaScript(`document.querySelector('#civigo-assistant button[aria-label="Cerrar ayuda"]').click()`);
      scenarios.push('Ayuda visible conserva preguntas iniciales y una introducción sencilla');
    }
    if (name==='desktop' || name==='mobile' || name==='mobile-small') {
      await window.webContents.executeJavaScript(`(() => {const video=document.querySelector('.brand-animation video');video.currentTime=video.duration-0.6;})()`);
      await waitUntil(window,`(() => {const video=document.querySelector('.brand-animation video');return video.currentTime>video.duration-0.7;})()`);
      await fs.writeFile(path.join(local,`${name}-final.png`),(await window.webContents.capturePage()).toPNG());
      await waitUntil(window,`(() => {const video=document.querySelector('.brand-animation video');return video.currentTime<1&&!video.paused&&!video.ended;})()`,4000);
      scenarios.push(`${name}: repite el video sin detenerse al finalizar`);
    }
    scenarios.push(`${width}px: logo legible sin solapamiento en claro y oscuro`);
    scenarios.push(`${width}px: fondo transparente, azul original y letras legibles en ambos temas`);
    window.destroy();
  }
  const reduced = await createWindow(390,844,'reduced-motion',{reducedMotion:true});
  await fallbackVisible(reduced.window);
  await reduced.window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
  await inspectTransparency(reduced.window, false, true);
  await delay(800);
  assert.equal(reduced.requests.includes('/civigo-logo-animado.mp4'),false,'Reduced motion must not download the animation');
  assert.equal(await reduced.window.webContents.executeJavaScript(`(() => {const video=document.querySelector('.brand-animation video');return !video || (video.paused&&video.currentTime===0);})()`),true);
  scenarios.push('Movimiento reducido: identidad estática sin reproducir ni descargar MP4');
  reduced.window.destroy();
  const motionChange = await createWindow(390,844,'motion-change');
  await waitUntil(motionChange.window,`document.querySelector('.brand-animation video')?.currentTime>0.15`);
  await motionChange.window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await waitUntil(motionChange.window,`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  await waitUntil(motionChange.window,`(() => {const video=document.querySelector('.brand-animation video');return video.paused && !video.getAttribute('src');})()`);
  await fallbackVisible(motionChange.window);
  assert.equal(await motionChange.window.webContents.executeJavaScript(`(() => {const video=document.querySelector('.brand-animation video');return video.paused && !video.getAttribute('src');})()`),true);
  scenarios.push('Cambio de preferencia en vivo: detiene el video y restaura identidad estática');
  motionChange.window.destroy();
  const rejected = await createWindow(390,844,'autoplay-rejected',{rejectAutoplay:true});
  await waitUntil(rejected.window,`window.__rejectedBrandPlays>0`);
  await fallbackVisible(rejected.window);
  assert.equal(await rejected.window.webContents.executeJavaScript(`(() => {const video=document.querySelector('.brand-animation video');return !video || video.paused;})()`),true);
  scenarios.push('Autoplay rechazado: mantiene identidad estática');
  rejected.window.destroy();
  const failed = await createWindow(390,844,'video-error',{blockVideo:true});
  await waitUntil(failed.window,`(() => {const video=document.querySelector('.brand-animation video');return !video || !!video.error;})()`);
  await fallbackVisible(failed.window);
  scenarios.push('Error de video: mantiene identidad estática');
  failed.window.destroy();
  const fallbackFrames = await createWindow(390,844,'animation-frame-fallback',{noFrameCallback:true});
  await waitUntil(fallbackFrames.window,`(() => {const video=document.querySelector('.brand-animation video');return window.__brandPaints>5&&video.currentTime>2.9&&video.currentTime<4.1&&!video.paused;})()`);
  const beforePaints=await fallbackFrames.window.webContents.executeJavaScript(`({paints:window.__brandPaints,raf:window.__brandRaf,time:document.querySelector('.brand-animation video').currentTime})`);
  await delay(500);
  const afterPaints=await fallbackFrames.window.webContents.executeJavaScript(`({paints:window.__brandPaints,raf:window.__brandRaf,time:document.querySelector('.brand-animation video').currentTime,paused:document.querySelector('.brand-animation video').paused,visibility:document.visibilityState})`);
  assert.ok(afterPaints.paints-beforePaints.paints>6,'El video conserva cuadros fluidos sin requestVideoFrameCallback: '+JSON.stringify({beforePaints,afterPaints}));
  scenarios.push('Navegador sin callback de video: mantiene la animación transparente con cuadros continuos');
  fallbackFrames.window.destroy();
  const black = await createWindow(390,844,'black-frames',{blackFrames:true});
  await waitUntil(black.window,`document.querySelector('.brand-animation video')?.currentTime>0.3`);
  await fallbackVisible(black.window);
  assert.equal(await black.window.webContents.executeJavaScript(`document.querySelector('.brand-animation video').classList.contains('is-visible')`),false,'Una reproducción de cuadros negros no puede tapar el logo');
  scenarios.push('Cuadros decodificados negros: mantiene identidad estática aunque se dispare playing');
  black.window.destroy();
  const result = {passed:true,scenarios,layouts,blockedHosts:[...blockedHosts],apiRequests:apiRequests.length};
  await fs.writeFile(path.join(local,'resultado.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:true,scenarios,layouts:layouts.length,blockedHosts:[...blockedHosts]}));
  server.close();
  app.exit(0);
}
run().catch(async error => {
  console.error(error.stack || error);
  await fs.writeFile(path.join(local,'error.txt'),String(error.stack || error));
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
  app.exit(1);
});
