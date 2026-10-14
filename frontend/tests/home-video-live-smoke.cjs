/* eslint-disable @typescript-eslint/no-require-imports */
// The real MP4 is served by local Next; all backend traffic is an isolated fixture.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const frontendPort = Number(process.env.CIVIGO_HOME_SMOKE_FRONTEND_PORT || 55712);
const fixturePort = Number(process.env.CIVIGO_HOME_SMOKE_FIXTURE_PORT || 55713);
const origin = `http://127.0.0.1:${frontendPort}`;
const output = path.resolve(__dirname, '../.local/home-video-live-smoke');
require('node:fs').mkdirSync(path.join(output, 'session'), { recursive: true });
app.setPath('userData', output);
app.setPath('sessionData', path.join(output, 'session'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const windows = [], scenarios = [], layouts = [], externalRequests = new Set(), errors = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/users/me') {
    response.statusCode = 401;
    return response.end('{"error":"Sin sesión de prueba"}');
  }
  if (['/api/announcements', '/api/businesses'].includes(url.pathname)) return response.end('[]');
  response.statusCode = 404;
  response.end('{"error":"Ruta ajena al fixture de portada"}');
});
setTimeout(() => { console.error('El video de portada excedió el límite de tres minutos.'); app.exit(1); }, 180000).unref();
async function waitUntil(window, expression, timeout = 20000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  const state = await window.webContents.executeJavaScript(`(() => {const video=document.querySelector('[data-home-video] video');return {rejected:window.__homeAutoplayRejected,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,paused:video?.paused,time:video?.currentTime,autoplay:video?.autoplay,source:video?.getAttribute('src'),button:document.querySelector('[data-home-video] button')?.outerHTML};})()`);
  throw new Error(`No se cumplió: ${expression}\n${JSON.stringify(state)}`);
}
async function createWindow(width, height, name, options = {}) {
  const window = new BrowserWindow({ show:false, width, height, useContentSize:true,
    webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, partition:`home-video-${name}-${Date.now()}` } });
  window.setContentSize(width, height);
  windows.push(window);
  const requests = [];
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    requests.push(url.pathname);
    const allowed = (url.hostname === '127.0.0.1' && url.port === String(frontendPort) && ['http:', 'ws:'].includes(url.protocol)) || ['data:', 'blob:'].includes(url.protocol) || url.href === 'about:blank';
    if (!allowed) externalRequests.add(url.hostname || url.protocol);
    callback({ cancel: !allowed || (options.failVideo && url.pathname === '/civigo-spot.mp4') });
  });
  window.webContents.on('console-message', event => {
    if (event.level === 'error' && /Hydration|React|uncaught|TypeError|ReferenceError/i.test(event.message)) errors.push(event.message);
  });
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value: options.reducedMotion ? 'reduce' : 'no-preference' }] });
  if (options.rejectAutoplay) {
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {source:`const originalHomePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.closest?.('[data-home-video]')&&!window.__homeAutoplayRejected){window.__homeAutoplayRejected=true;this.autoplay=false;this.addEventListener('playing',()=>this.pause(),{once:true});this.pause();return Promise.reject(new DOMException('Autoplay rejected by local fixture','NotAllowedError'));}return originalHomePlay.call(this);};`});
  }
  // A fixed CSS viewport avoids Windows fractional display scaling adding two
  // pixels to Electron's mobile emulation surface.
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
  await window.loadURL(origin);
  await waitUntil(window, `!!document.querySelector('[data-home-video] video') && !!document.querySelector('.map-announcements')`);
  assert.equal(window.isVisible(), false);
  return { window, requests };
}
async function clickControl(window) {
  const position = await window.webContents.executeJavaScript(`(() => {const button=document.querySelector('[data-home-video] button');button.scrollIntoView({block:'center',behavior:'instant'});const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
  window.webContents.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, ...position });
  window.webContents.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, ...position });
}
async function inspectLayout(window, width, name) {
  await window.webContents.executeJavaScript(`scrollTo(0,0)`);
  const layout = await window.webContents.executeJavaScript(`(() => {
    const frame=document.querySelector('[data-home-video]'),video=frame.querySelector('video'),button=frame.querySelector('button'),rect=frame.getBoundingClientRect(),media=video.getBoundingClientRect(),control=button?.getBoundingClientRect();
    const content=document.querySelector('.hero > div:first-child').getBoundingClientRect();
    return {width:innerWidth,clientWidth:document.documentElement.clientWidth,visualWidth:visualViewport.width,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,
      frame:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom},
      media:{x:media.x,y:media.y,width:media.width,height:media.height},
      control:control?{x:control.x,y:control.y,width:control.width,height:control.height,right:control.right,bottom:control.bottom}:null,
      content:{right:content.right,bottom:content.bottom},fit:getComputedStyle(video).objectFit,
      heading:document.querySelector('h1').textContent,oldCards:document.querySelectorAll('.hero-visual-card').length};
  })()`);
  assert.equal(layout.width, width, JSON.stringify(layout));
  assert.ok(layout.documentWidth <= width, `${name}: no horizontal overflow`);
  assert.ok(layout.frame.x >= 0 && layout.frame.right <= width + 1, `${name}: video fits the viewport`);
  assert.ok(layout.frame.width > 200 && layout.frame.height > 100, `${name}: video has useful visible dimensions`);
  assert.ok(Math.abs(layout.frame.width / layout.frame.height - 16 / 9) < 0.03, `${name}: original 16:9 ratio preserved`);
  assert.equal(layout.fit, 'contain');
  assert.ok(Math.abs(layout.media.width - layout.frame.width) < 3 && Math.abs(layout.media.height - layout.frame.height) < 3);
  assert.equal(layout.oldCards, 0);
  assert.ok(layout.heading.includes('Tu ciudad.'));
  if (width > 980) assert.ok(layout.content.right <= layout.frame.x + 1, `${name}: desktop uses the requested right column`);
  else assert.ok(layout.content.bottom <= layout.frame.y + 1, `${name}: video stacks after the content`);
  assert.ok(layout.control.width >= 44 && layout.control.height >= 44, `${name}: touch target stays accessible`);
  assert.ok(layout.control.right <= layout.frame.right && layout.control.bottom <= layout.frame.bottom, `${name}: playback control stays inside the frame`);
  layouts.push({ name, ...layout });
  await delay(150);
  await window.webContents.capturePage();
  await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
async function run() {
  server.listen(fixturePort, '127.0.0.1');
  await once(server, 'listening');
  await app.whenReady();
  for (const [width, height, name] of [[1400,850,'desktop'],[850,900,'tablet'],[390,844,'mobile'],[320,640,'mobile-small']]) {
    const {window, requests} = await createWindow(width, height, name);
    await waitUntil(window, `(() => {const video=document.querySelector('[data-home-video] video');return video.videoWidth>0&&video.currentTime>.2&&!video.paused;})()`);
    const media = await window.webContents.executeJavaScript(`(() => {const video=document.querySelector('[data-home-video] video');return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,muted:video.muted,loop:video.loop,inline:video.playsInline,autoplay:video.autoplay,controls:video.controls,time:video.currentTime,source:video.getAttribute('src'),poster:video.getAttribute('poster')};})()`);
    assert.equal(media.width,1920); assert.equal(media.height,1080);
    assert.ok(Math.abs(media.duration - 30)<.1);
    assert.equal(media.muted,true); assert.equal(media.loop,true); assert.equal(media.inline,true); assert.equal(media.autoplay,true); assert.equal(media.controls,false);
    assert.equal(media.source,'/civigo-spot.mp4'); assert.equal(media.poster,'/civigo-spot-poster.jpg');
    assert.ok(requests.includes('/civigo-spot.mp4'));
    await delay(500);
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').currentTime>${media.time}`), `${name}: the original video advances`);
    await waitUntil(window, `!!document.querySelector('[data-home-video] button[aria-label^="Pausar"]')`);
    for (const theme of ['dark','light']) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await inspectLayout(window, width, `${name}-${theme}`);
    }
    if (name === 'desktop' || name === 'mobile-small') {
      await window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').currentTime=29.3`);
      await waitUntil(window, `document.querySelector('[data-home-video] video').currentTime>29.2`);
      await waitUntil(window, `(() => {const video=document.querySelector('[data-home-video] video');return video.currentTime<1.5&&!video.paused&&!video.ended;})()`, 5000);
      scenarios.push(`${name}: el MP4 vuelve al inicio y sigue reproduciéndose sin detenerse`);
    }
    if (name === 'desktop') {
      await clickControl(window);
      await waitUntil(window, `document.querySelector('[data-home-video] video').paused`);
      const stopped = await window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').currentTime`);
      await delay(500);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').currentTime`), stopped);
      await clickControl(window);
      await waitUntil(window, `!document.querySelector('[data-home-video] video').paused`);
      await delay(300);
      assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').currentTime>${stopped}`));
      scenarios.push('El control accesible permite pausar y continuar conservando la reproducción en bucle');
    }
    scenarios.push(`${width}px: el video original se reproduce en claro y oscuro sin recortar ni desbordar`);
    window.destroy();
  }
  const reduced = await createWindow(390,844,'reduced-motion',{reducedMotion:true});
  await waitUntil(reduced.window, `!!document.querySelector('[data-home-video] button[aria-label^="Reproducir"]:not(:disabled)')`);
  await delay(500);
  assert.equal(reduced.requests.includes('/civigo-spot.mp4'),false);
  assert.ok(reduced.requests.includes('/civigo-spot-poster.jpg'));
  assert.equal(await reduced.window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').getAttribute('src')`), null);
  await clickControl(reduced.window);
  await waitUntil(reduced.window, `(() => {const video=document.querySelector('[data-home-video] video');return video.currentTime>.2&&!video.paused;})()`);
  scenarios.push('Movimiento reducido: fotograma real sin descargar MP4; Reproducir permite iniciarlo expresamente');
  reduced.window.destroy();
  const rejected = await createWindow(390,844,'blocked-autoplay',{rejectAutoplay:true});
  await waitUntil(rejected.window, `window.__homeAutoplayRejected===true&&!!document.querySelector('[data-home-video] button[aria-label^="Reproducir"]:not(:disabled)')`);
  assert.equal(await rejected.window.webContents.executeJavaScript(`document.querySelector('[data-home-video] video').paused`), true);
  await clickControl(rejected.window);
  await waitUntil(rejected.window, `(() => {const video=document.querySelector('[data-home-video] video');return video.currentTime>.2&&!video.paused;})()`);
  scenarios.push('Autoplay bloqueado: el usuario puede iniciarlo desde el botón y conserva el bucle');
  rejected.window.destroy();
  const failed = await createWindow(390,844,'media-error',{failVideo:true});
  await waitUntil(failed.window, `document.querySelector('[data-home-video] [role="status"]')?.textContent==='El video no se pudo cargar.'`);
  assert.ok(failed.requests.includes('/civigo-spot-poster.jpg'));
  scenarios.push('Archivo no disponible: mantiene el fotograma y muestra un mensaje sin bloquear la portada');
  failed.window.destroy();
  assert.deepEqual(errors,[],'No React or browser errors');
  assert.equal(externalRequests.size,0,'No production or third party request');
  const result = {ok:true,scenarios,layouts,externalRequests:[...externalRequests],errors};
  await fs.writeFile(path.join(output,'resultado.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
run().then(() => {for(const window of windows)if(!window.isDestroyed())window.destroy();server.close();app.exit(0);})
  .catch(async error => {console.error(error.stack);try{await fs.writeFile(path.join(output,'error.json'),JSON.stringify({error:error.stack,scenarios,layouts},null,2));}catch{}for(const window of windows)if(!window.isDestroyed())window.destroy();server.close();app.exit(1);});
