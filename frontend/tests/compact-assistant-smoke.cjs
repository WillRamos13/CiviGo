/* eslint-disable @typescript-eslint/no-require-imports */
const {app,server,windows,createClient,waitUntil,delay,errors}=require('./map-live-smoke.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events');
const out=path.resolve(__dirname,'../.local/compact-assistant');
app.on('window-all-closed',()=>{});
const handler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/announcements'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify([{id:4,tipo:'NOVEDAD',ubicacion:'CABECERA',titulo:'Tu aporte cuenta',mensaje:'Participa y descubre recompensas',enlace:'/registro',imagen:{id:'12345678-1234-1234-1234-123456789012',mimeType:'image/webp',url:'/api/announcements/4/image',alt:'Tu aporte cuenta. Únete a CiviGo.'}}]));}
  if(url.pathname==='/api/announcements/4/image'){res.setHeader('Content-Type','image/webp');return res.end(await fs.readFile(path.resolve(__dirname,'../public/banners/rewards-header.webp')));}
  handler(req,res);
});
(async()=>{
  await fs.mkdir(out,{recursive:true});server.listen(55709,'127.0.0.1');await once(server,'listening');await app.whenReady();
  for(const [index,[width,height]]of [[390,844],[768,1024],[1366,768],[1920,1080]].entries()){
    const win=await createClient(1100+index,width,height,{mapReady:false,mapbox:true,offscreen:true}),js=s=>win.webContents.executeJavaScript(s);
    const shot=async name=>fs.writeFile(path.join(out,`${name}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await waitUntil(win,`!!document.querySelector('.route-assistant-launch') && document.querySelector('.map-announcements img')?.naturalWidth>0`);
    await delay(350);
    const initial=await js(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{header:box('.app-header'),banner:box('.map-announcements'),robot:box('.route-assistant-launch'),inputs:document.querySelectorAll('.map-route-panel input').length,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.ok(initial.header.h<=(width<=600?64:width<=900?72:86)+1,JSON.stringify(initial));
    assert.ok(initial.banner.h<=(width<=600?42:54)+1);assert.equal(initial.inputs,0);assert.equal(initial.overflow,false);
    assert.ok(initial.robot.w<=164 && initial.robot.h<160);await shot('inicio');
    for(const theme of ['dark','light']){
      await js(`document.querySelector('button[aria-label="Cambiar a modo ${theme==='dark'?'oscuro':'claro'}"]')?.click()`);
      await waitUntil(win,`document.documentElement.dataset.theme==='${theme}'`);await delay(150);await shot('inicio-'+theme);
    }
    await js(`document.querySelector('.route-assistant-launch').click()`);
    await waitUntil(win,`document.querySelector('[data-assistant-step]')?.dataset.assistantStep==='destination'`);
    assert.equal(await js(`document.querySelectorAll('[aria-label="Modo de recorrido"],input[aria-label="Origen"]').length`),0);
    await js(`(()=>{const input=document.querySelector('input[aria-label="Dile a Civi a dónde quieres ir"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'plaza de armas de ica');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`document.querySelector('button[aria-label="Buscar con Civi"]').click()`);
    await waitUntil(win,`document.querySelector('section[aria-label="Resultados de lugares"] button')?.textContent.includes('Plaza de Armas')`);
    await js(`document.querySelector('section[aria-label="Resultados de lugares"] button').click()`);
    await waitUntil(win,`!!document.querySelector('[role="dialog"][aria-label="Información del lugar"]')`);
    await js(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Elegir destino').click()`);
    await waitUntil(win,`document.querySelector('[data-assistant-step]')?.dataset.assistantStep==='origin'`);
    await js(`window.__fix={coords:{latitude:-14.0887,longitude:-75.73545,accuracy:5,speed:2,heading:0},timestamp:Date.now()};window.__watchers=new Map();window.__watchId=0;Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){setTimeout(()=>ok({...window.__fix,timestamp:Date.now()}),0)},watchPosition(ok){const id=++window.__watchId;window.__watchers.set(id,ok);setTimeout(()=>ok({...window.__fix,timestamp:Date.now()}),0);return id},clearWatch(id){window.__watchers.delete(id)}}});Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent.includes('Usar mi ubicación')).click()`);
    await waitUntil(win,`Array.from(document.querySelectorAll('.map-route-panel button')).some(b=>b.textContent==='Continuar'&&!b.disabled)`);
    await js(`Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent==='Continuar').click()`);
    await waitUntil(win,`document.querySelector('[data-assistant-step]')?.dataset.assistantStep==='transport'`);
    assert.equal(await js(`document.querySelectorAll('[aria-label="Modo de recorrido"] button').length`),3);
    assert.equal(await js(`document.querySelectorAll('.route-assistant-search,input[aria-label="Origen"]').length`),0);await shot('transporte');
    await js(`Array.from(document.querySelectorAll('[aria-label="Modo de recorrido"] button')).find(b=>b.textContent==='Auto').click()`);
    await waitUntil(win,`document.querySelectorAll('section[aria-label="Alternativas de recorrido"]>button').length===3`);
    assert.equal(await js(`document.querySelectorAll('[aria-label="Modo de recorrido"],.route-assistant-search').length`),0);
    await js(`document.querySelector('section[aria-label="Alternativas de recorrido"]>button').click()`);
    await js(`document.querySelector('button[aria-label="Cerrar planificación"]').click()`);
    await waitUntil(win,`!!document.querySelector('.route-assistant-launch')`);
    await js(`document.querySelector('.route-assistant-launch').click()`);
    await waitUntil(win,`document.querySelectorAll('section[aria-label="Alternativas de recorrido"]>button').length===3`);
    await js(`Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent.includes('Iniciar recorrido')).click()`);
    await waitUntil(win,`!!document.querySelector('.navigation-guidance')`);
    const layer=await js(`(()=>{const b=document.querySelector('.map-controls>button'),r=b.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,label:b.textContent.trim()}})()`);
    assert.equal(layer.label,'Capas');assert.ok(Math.abs(layer.w-44)<1&&Math.abs(layer.h-44)<1);assert.ok(width-layer.x-layer.w<20);assert.equal(await js(`document.querySelectorAll('.risk-legend,.traffic-legend').length`),0);
    await js(`document.querySelector('.map-controls>button').click()`);await waitUntil(win,`document.querySelector('.map-controls>button').getAttribute('aria-expanded')==='true'`);
    const panel=await js(`(()=>{const r=document.querySelector('.map-controls>.collapsible-panel-body').getBoundingClientRect();return{y:r.y,bottom:r.bottom}})()`);assert.ok(panel.y>=0&&panel.bottom<=height);await shot('capas-en-ruta');
    await js(`document.querySelector('.map-controls>button').click()`);await shot('navegacion');
    assert.deepEqual(await js(`window.__smokeErrors`),[]);console.log(JSON.stringify({width,initial,layer,passed:true}));win.destroy();
  }
  assert.deepEqual(errors,[]);app.exit(0);
})().catch(async e=>{console.error(e.stack);for(const [i,win]of windows.entries())if(!win.isDestroyed())await fs.writeFile(path.join(out,`error-${i}.png`),(await win.webContents.capturePage()).toPNG());app.exit(1);}).finally(()=>server.close());
