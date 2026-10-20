/* eslint-disable @typescript-eslint/no-require-imports */
// Real Chromium/React/Mapbox. GPS, civic data and route API are local fixtures.
const {app,server,windows,requests,errors,rendererConsoleErrors,createClient,waitUntil,delay,setIncidents,incident}=require('./map-live-smoke.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{once}=require('node:events');
const out=path.resolve(__dirname,'../.local/oct20-web/screenshots');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.on('window-all-closed',()=>{});
const results=[];
async function run() {
  await fs.mkdir(out,{recursive:true});server.listen(Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT||55709),'127.0.0.1');await once(server,'listening');await app.whenReady();
  setIncidents([incident]);
  for(const [index,[width,height]] of [[390,844],[768,1024],[1366,768],[1920,1080]].entries()) {
    const win=await createClient(500+index,width,height,{mapReady:false,mapbox:true,offscreen:true});
    const js=script=>win.webContents.executeJavaScript(script);
    win.webContents.disableDeviceEmulation();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=900});
    const screenshot=async filename=>{
      const {data}=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});
      const bytes=Buffer.from(data,'base64');
      assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
      await fs.writeFile(path.join(out,filename),bytes);
    };
    const themeTo=async theme=>{
      await js(`(()=>{const b=document.querySelector('button[aria-label="Cambiar a modo ${theme==='dark'?'oscuro':'claro'}"]');if(b)b.click()})()`);
      await waitUntil(win,`document.documentElement.dataset.theme==='${theme}'`);
      await delay(2000);
    };
    await waitUntil(win,`!!document.querySelector('.mapboxgl-canvas')`,20000);
    await waitUntil(win,`!document.querySelector('[data-map-control="orientation"]').disabled`,20000);
    await delay(3500);
    await js(`window.__originalCanvas=document.querySelector('.mapboxgl-canvas');
      window.__nearbyPosition={coords:{latitude:-14.0887,longitude:-75.73545,accuracy:5,speed:2,heading:0},timestamp:Date.now()};window.__watchers=new Map();window.__watchId=0;
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){setTimeout(()=>ok({...window.__nearbyPosition,timestamp:Date.now()}),0)},watchPosition(ok){const id=++window.__watchId;window.__watchers.set(id,ok);setTimeout(()=>ok({...window.__nearbyPosition,timestamp:Date.now()}),0);return id},clearWatch(id){window.__watchers.delete(id)}}});
      document.querySelector('.map-recenter').click();`);
    await waitUntil(win,`document.querySelector('summary')?.textContent.includes('Mi ubicación')`,12000);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Plaza de Armas de Ica').click()`);
    await waitUntil(win,`document.querySelector('[role="option"]')?.textContent.includes('Plaza de Armas')`);
    await js(`document.querySelector('[role="option"]').click()`);
    await waitUntil(win,`!document.querySelector('.route-planner-search button').disabled`);
    await js(`document.querySelector('.route-planner-search button').click()`);
    await waitUntil(win,`document.querySelectorAll('section[aria-label="Alternativas de recorrido"] > button').length===3`);
    await js(`document.querySelector('section[aria-label="Alternativas de recorrido"] > button').click()`);
    await waitUntil(win,`Array.from(document.querySelectorAll('.map-route-panel button')).some(b=>b.textContent.includes('Iniciar recorrido'))`);
    for(const theme of ['light','dark']) {
      await themeTo(theme);
      await js(`document.activeElement.blur();window.scrollTo(0,0);document.querySelector('[class*="plannerBody"]').scrollTop=0`);
      await delay(700);
      const layout=await js(`(()=>{const r=s=>{const e=document.querySelector(s),b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}};return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,map:r('.map-frame'),panel:r('.map-route-panel'),center:r('.map-recenter'),orientation:r('[data-map-control="orientation"]'),canvasSame:window.__originalCanvas===document.querySelector('.mapboxgl-canvas')}})()`);
      assert.equal(layout.overflow,false);assert.equal(layout.canvasSame,true);assert.ok(layout.map.h>=300);assert.ok(layout.panel.w<=400 || width===390);assert.ok(layout.panel.y>=layout.map.y);assert.ok(layout.panel.y+layout.panel.h<=layout.map.y+layout.map.h+2);
      if(width>700) assert.ok(layout.center.x+layout.center.w<=layout.panel.x,'El panel no cubre el botón de ubicación');
      results.push({width,height,theme,mode:'planning',layout});
      await screenshot(`mapa-${width}x${height}-${theme}.png`);
      await js(`document.querySelector('section[aria-label="Alternativas de recorrido"]').scrollIntoView({block:'start'});window.scrollTo(0,0)`);
      await delay(500);
      await screenshot(`alternativas-${width}x${height}-${theme}.png`);
    }
    // Collapse and expand must keep the destination, alternatives and Mapbox.
    await js(`document.querySelector('.map-route-panel > button').click()`);
    await waitUntil(win,`document.querySelector('.map-route-panel > button').getAttribute('aria-expanded')==='false'`);
    await js(`document.querySelector('.map-route-panel > button').click()`);
    assert.equal(await js(`document.querySelectorAll('section[aria-label="Alternativas de recorrido"] > button').length`),3);
    await js(`Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent.includes('Iniciar recorrido')).click()`);
    await waitUntil(win,`!!document.querySelector('.navigation-guidance')`);
    await delay(500);
    await js(`document.querySelector('.map-controls > button').click()`);
    await waitUntil(win,`document.querySelector('.map-controls > button').getAttribute('aria-expanded')==='true'`);
    assert.equal(await js(`Array.from(document.querySelectorAll('.map-layer-options label')).some(e=>e.textContent.includes('Tráfico'))`),true);
    await js(`document.querySelector('.map-controls > button').click()`);
    for(const theme of ['light','dark']) {
      await themeTo(theme);await js(`window.scrollTo(0,0)`);await delay(700);
      const layout=await js(`(()=>{const e=document.querySelector('.map-route-panel'),r=e.getBoundingClientRect();return{height:r.height,width:r.width,overflow:document.documentElement.scrollWidth>innerWidth,canvasSame:window.__originalCanvas===document.querySelector('.mapboxgl-canvas'),text:e.innerText}})()`);
      assert.equal(layout.overflow,false);assert.equal(layout.canvasSame,true);assert.match(layout.text,/EN CAMINO/);assert.match(layout.text,/Finalizar/);
      if(width===390)assert.ok(layout.height<=230);
      results.push({width,height,theme,mode:'navigation',layout});
      await screenshot(`navegacion-${width}x${height}-${theme}.png`);
    }
    await js(`document.querySelector('.map-route-panel > button').click()`);
    await waitUntil(win,`Array.from(document.querySelectorAll('.navigation-guidance button')).some(b=>b.textContent.includes('Recalcular'))`);
    const beforeReplan=requests.filter(r=>r.planBody).length;
    await js(`Array.from(document.querySelectorAll('.navigation-guidance button')).find(b=>b.textContent.includes('Recalcular')).click()`);
    await waitUntil(win,`document.querySelector('.navigation-guidance')?.textContent.includes('Recorrido actualizado')`);
    assert.equal(requests.filter(r=>r.planBody).length,beforeReplan+1);
    const previousVoice=await js(`document.querySelector('.navigation-guidance button[aria-label*="voz"]').getAttribute('aria-label')`);
    await js(`document.querySelector('.navigation-guidance button[aria-label*="voz"]').click()`);
    await waitUntil(win,`document.querySelector('.navigation-guidance button[aria-label*="voz"]').getAttribute('aria-label')!==${JSON.stringify(previousVoice)}`);
    await js(`document.querySelector('[data-map-control="orientation"]').click()`);
    assert.equal(await js(`window.__originalCanvas===document.querySelector('.mapboxgl-canvas')`),true);
    await js(`Array.from(document.querySelectorAll('.navigation-guidance button')).find(b=>b.textContent.includes('Finalizar')).click()`);
    await waitUntil(win,`!document.querySelector('.navigation-guidance') && document.querySelectorAll('section[aria-label="Alternativas de recorrido"] > button').length===3`);
    win.destroy();
  }
  assert.deepEqual(errors,[]);
  const reactErrors=rendererConsoleErrors.filter(e=>/Uncaught|Maximum update|Hydration|React error|TypeError/.test(e.message));assert.deepEqual(reactErrors,[]);
  await fs.writeFile(path.join(out,'resultado.json'),JSON.stringify({passed:true,results,calculations:requests.filter(r=>r.planBody).length,limitation:'Datos, GPS y recorridos de prueba locales; Mapbox real con token público existente. No representa pruebas de conducción ni tráfico real.',rendererErrors:rendererConsoleErrors},null,2));
  console.log(JSON.stringify({passed:true,captures:results.length,calculations:requests.filter(r=>r.planBody).length}));
}
run().then(()=>app.exit(0)).catch(async error=>{
  console.error(error.stack);for(const [i,win] of windows.entries())if(!win.isDestroyed())await fs.writeFile(path.join(out,`fallo-${i}.png`),(await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(out,'fallo.json'),JSON.stringify({error:String(error),results,rendererConsoleErrors},null,2));app.exit(1);
}).finally(()=>server.close());
