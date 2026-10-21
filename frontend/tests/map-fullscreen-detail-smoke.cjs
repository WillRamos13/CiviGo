/* eslint-disable @typescript-eslint/no-require-imports */
// Real React and Mapbox; local incident/GPS fixtures. Native OS fullscreen is
// unavailable to hidden windows, so verify the fallback and DOM ancestry too.
const {app,server,windows,errors,rendererConsoleErrors,createClient,waitUntil,delay,setIncidents,incident}=require('./map-live-smoke.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{once}=require('node:events');
const out=path.resolve(__dirname,'../.local/oct20-fullscreen-detail');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.on('window-all-closed',()=>{});
const results=[];
async function run(){
  await fs.mkdir(out,{recursive:true});server.listen(55709,'127.0.0.1');await once(server,'listening');await app.whenReady();
  setIncidents([{...incident,tipo:'Extorsión',tipoNombre:'Extorsión',tipoSlug:'extorsion',descripcion:'Descripción de prueba de extorsión para comprobar el detalle en pantalla completa.'}]);
  for(const [index,[width,height]] of [[390,844],[1366,768]].entries()){
    const win=await createClient(700+index,width,height,{mapReady:false,mapbox:true,offscreen:true});
    const js=script=>win.webContents.executeJavaScript(script);
    win.webContents.disableDeviceEmulation();win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=900});
    await waitUntil(win,`!!document.querySelector('.mapboxgl-canvas') && !document.querySelector('[data-map-control="orientation"]').disabled`,20000);
    await delay(1500);
    await js(`window.__testFix=()=>({coords:{latitude:${incident.latitud},longitude:${incident.longitud-0.0004},accuracy:5},timestamp:Date.now()});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){setTimeout(()=>ok(window.__testFix()),0)},watchPosition(ok){setTimeout(()=>ok(window.__testFix()),0);return 1},clearWatch(){}}});document.querySelector('.map-recenter').click()`);
    await waitUntil(win,`document.querySelector('summary')?.textContent.includes('Mi ubicación')`);
    await js(`document.querySelector('.map-recenter').click()`);
    await delay(1400);
    await js(`if(document.querySelector('.map-route-panel > button').getAttribute('aria-expanded')==='true')document.querySelector('.map-route-panel > button').click()`);
    await js(`window.__originalCanvas=document.querySelector('.mapboxgl-canvas');Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});document.querySelector('button[aria-label="Ampliar mapa a pantalla completa"]').click()`);
    await waitUntil(win,`document.querySelector('.map-frame').dataset.mapFullscreen==='true' && !!document.querySelector('[data-incident-id="912"]')`);
    await delay(700);
    const hit=await js(`(()=>{const b=document.querySelector('[data-incident-id="912"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&getComputedStyle(b).visibility!=='hidden'&&getComputedStyle(b).display!=='none',reachable:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),image:b.querySelector('img')?.src}})()`);
    assert.equal(hit.visible,true);assert.equal(hit.reachable,true,JSON.stringify(hit));
    // Native input clicks the marker rather than calling React's callback.
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});
    await waitUntil(win,`!!document.querySelector('.map-frame [role="dialog"][aria-labelledby="incident-title"]')`);
    const detail=await js(`(()=>{const p=document.querySelector('[aria-labelledby="incident-title"]'),r=p.getBoundingClientRect(),close=p.querySelector('[aria-label="Cerrar detalle"]'),c=close.getBoundingClientRect();return{inFullscreen:p.closest('[data-map-fullscreen="true"]')!==null,title:p.querySelector('h2').textContent,description:p.textContent.includes('Descripción de prueba de extorsión'),height:r.height,top:r.top,bottom:r.bottom,closeReachable:close.contains(document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)),scrollable:p.querySelector('[class*="body"]').scrollHeight>p.querySelector('[class*="body"]').clientHeight,same:window.__originalCanvas===document.querySelector('.mapboxgl-canvas')}})()`);
    assert.equal(detail.inFullscreen,true);assert.equal(detail.title,'Extorsión');assert.equal(detail.description,true);assert.equal(detail.closeReachable,true);assert.equal(detail.same,true);assert.ok(detail.top>=0&&detail.bottom<=height);assert.ok(detail.height>200);assert.equal(detail.scrollable,true);
    const {data}=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});await fs.writeFile(path.join(out,`detalle-${width}.png`),Buffer.from(data,'base64'));
    // Escape closes the focused incident first, preserving fullscreen.
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await waitUntil(win,`!document.querySelector('[aria-labelledby="incident-title"]')`);
    assert.equal(await js(`document.querySelector('.map-frame').dataset.mapFullscreen`),'true');
    // Reopen, then exit fullscreen without losing the selected incident.
    await js(`document.querySelector('[data-incident-id="912"]').click()`);
    await waitUntil(win,`!!document.querySelector('[aria-labelledby="incident-title"]')`);
    const exit=await js(`(()=>{const b=document.querySelector('[aria-label="Salir de pantalla completa"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,reachable:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    assert.equal(exit.reachable,true);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:exit.x,y:exit.y,button:'left',clickCount:1});
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:exit.x,y:exit.y,button:'left',clickCount:1});
    await waitUntil(win,`document.querySelector('.map-frame').dataset.mapFullscreen==='false'`);
    assert.equal(await js(`document.querySelector('.map-frame [aria-labelledby="incident-title"] h2')?.textContent`),'Extorsión');
    await js(`document.querySelector('[aria-label="Cerrar detalle"]').click()`);
    results.push({width,height,detail,markerImage:hit.image});win.destroy();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(rendererConsoleErrors.filter(e=>/Uncaught|Maximum update|Hydration|React error|TypeError/.test(e.message)),[]);
  await fs.writeFile(path.join(out,'resultado.json'),JSON.stringify({passed:true,results,limitation:'GPS y datos locales. Pantalla completa CSS; se verifica que la tarjeta descienda del contenedor usado por la API nativa.'},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
}
run().then(()=>app.exit(0)).catch(async error=>{console.error(error.stack);for(const [i,win]of windows.entries())if(!win.isDestroyed())await fs.writeFile(path.join(out,`fallo-${i}.png`),(await win.webContents.capturePage()).toPNG());app.exit(1);}).finally(()=>server.close());
