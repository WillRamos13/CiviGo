/* eslint-disable @typescript-eslint/no-require-imports */
// Run with desktop/node_modules/electron/dist/electron.exe while the frontend
// listens on the configured loopback port. No external providers or accounts.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const fixturePort=Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT||55709);
const frontendPort=Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT||55710);
const origin=`http://127.0.0.1:${frontendPort}`;
const local=path.resolve(__dirname,'../.local/place-input-live-smoke');
require('node:fs').mkdirSync(path.join(local,'session'),{recursive:true});
app.setPath('userData',local);
app.setPath('sessionData',path.join(local,'session'));
app.disableHardwareAcceleration();
const searches=[],plans=[],stages=[],blockedHosts=new Set();
const plaza={nombre:'Plaza de Armas de Ica',latitud:-14.0639,longitud:-75.7285,descripcion:'Centro de Ica, Perú',fuente:'local'};
const hospital={nombre:'Hospital Regional de Ica',latitud:-14.0877,longitud:-75.734,descripcion:'Ica, Perú',fuente:'tomtom'};
const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    response.setHeader('Content-Type','application/json');
    response.setHeader('Cache-Control','no-store');
    if(url.pathname==='/api/navigation/places'){
        const query=url.searchParams.get('q'); searches.push(query);
        if(query==='sin lugar')return response.end('[]');
        if(query==='fallo servicio'){response.statusCode=503;return response.end('{"error":"Sin proveedor disponible","code":"PLACES_SEARCH_UNAVAILABLE"}');}
        if(query==='anterior'){setTimeout(()=>response.end(JSON.stringify([{...plaza,nombre:'Respuesta obsoleta'}])),1000);return;}
        if(query==='hospital')return response.end(JSON.stringify([hospital]));
        return response.end(JSON.stringify([plaza,{...plaza,nombre:'Plaza de Armas de Pueblo Nuevo',latitud:-14.122,longitud:-75.709,descripcion:'Pueblo Nuevo, Ica, Perú'}, {...plaza,nombre:'Sin coordenadas',latitud:null}]));
    }
    if(url.pathname==='/api/navigation/plan'){
        let raw='';request.on('data',chunk=>{raw+=chunk;});
        request.on('end',()=>{plans.push(JSON.parse(raw));response.end('{"rutas":[]}');});return;
    }
    if(url.pathname==='/api/users/me')return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario prueba',correo:'fixture@example.invalid',correoVerificado:true,rol:'USUARIO',premium:false,credibilidad:100}}));
    if(url.pathname==='/api/catalog')return response.end('{"categorias":[],"config":{},"distritos":["Ica"]}');
    if(url.pathname==='/api/navigation/roads')return response.end('{"type":"FeatureCollection","features":[]}');
    if(url.pathname==='/api/navigation/traffic/status')return response.end('{"configurado":false,"habilitado":false}');
    if(url.pathname==='/api/navigation/traffic/incidents')return response.end('{"incidentes":[],"trafico":{"disponible":false}}');
    if(['/api/incidents','/api/announcements','/api/businesses','/api/navigation/favorites','/api/navigation/history'].includes(url.pathname))return response.end('[]');
    response.statusCode=404;response.end('{"error":"Ruta ajena al fixture local"}');
});
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const input=label=>`document.querySelector('input[aria-label="${label}"]')`;
const field=label=>`${input(label)}.closest('.autocomplete')`;
async function waitUntil(window,expression,timeout=20000){
    const limit=Date.now()+timeout;
    while(Date.now()<limit){if(await window.webContents.executeJavaScript(expression))return;await delay(50);}
    throw new Error(`No se cumplió: ${expression}`);
}
async function type(window,label,text){
    await window.webContents.executeJavaScript(`(()=>{
        const element=${input(label)};element.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(text)});
        element.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
}
async function key(window,label,name){
    return window.webContents.executeJavaScript(`(()=>{
        const event=new KeyboardEvent('keydown',{key:${JSON.stringify(name)},bubbles:true,cancelable:true});
        ${input(label)}.dispatchEvent(event);return event.defaultPrevented;
    })()`);
}
async function run(){
    server.listen(fixturePort,'127.0.0.1');await once(server,'listening');await app.whenReady();
    const window=new BrowserWindow({show:false,width:1400,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'place-input-fixture'}});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
        const url=new URL(details.url);
        const allowed=(url.hostname==='127.0.0.1'&&url.port===String(frontendPort)&&['http:','ws:'].includes(url.protocol))||['data:','blob:'].includes(url.protocol);
        if(!allowed)blockedHosts.add(url.hostname||url.protocol);
        callback({cancel:!allowed});
    });
    await window.loadURL(`${origin}/mapa`);
    await waitUntil(window,`${input('Origen')}?.getAttribute('role')==='combobox'`);
    assert.equal(window.isVisible(),false);
    await type(window,'Origen','   ab  ');await delay(500);
    assert.equal(searches.length,0,'Un texto con menos de tres caracteres no envía solicitudes');
    await type(window,'Origen','plaz');await delay(100);await type(window,'Origen',' plaza   de armas de ica ');
    assert.equal(await key(window,'Origen','Enter'),true,'Enter mientras busca no envía el panel');
    assert.equal(plans.length,0);
    await waitUntil(window,`${field('Origen')}.querySelectorAll('[role="option"]').length===2`);
    assert.deepEqual(searches,['plaza de armas de ica'],'Sólo se envía la última búsqueda normalizada');
    assert.equal(await window.webContents.executeJavaScript(`${field('Origen')}.textContent.includes('Centro de Ica, Perú')`),true);
    await key(window,'Origen','ArrowDown');
    await waitUntil(window,`${input('Origen')}.getAttribute('aria-activedescendant')===${field('Origen')}.querySelector('[role="option"]').id`);
    await key(window,'Origen','Enter');
    await waitUntil(window,`${input('Origen')}.value==='Plaza de Armas de Ica'&&${input('Origen')}.getAttribute('aria-expanded')==='false'`);
    stages.push('POI y dirección, debounce, selección por teclado');

    await type(window,'Destino','hospital');
    await waitUntil(window,`${field('Destino')}.querySelector('[role="option"]')?.textContent.includes('Hospital Regional de Ica')`);
    await window.webContents.executeJavaScript(`(()=>{
        const option=${field('Destino')}.querySelector('[role="option"]');
        const pointer=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse'});
        option.dispatchEvent(pointer);
        if(!pointer.defaultPrevented)throw new Error('El clic de selección puede perder el foco antes de seleccionar');
        option.click();
    })()`);
    await waitUntil(window,`${input('Destino')}.value==='Hospital Regional de Ica'`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Buscar recorridos').click()`);
    const planned=Date.now()+10000;while(!plans.length&&Date.now()<planned)await delay(20);
    assert.equal(plans.length,1);
    assert.equal(plans[0].origen.latitud,plaza.latitud);assert.equal(plans[0].origen.longitud,plaza.longitud);
    assert.equal(plans[0].destino.latitud,hospital.latitud);assert.equal(plans[0].destino.longitud,hospital.longitud);
    stages.push('Selección con clic y cálculo con coordenadas de ambos lugares');

    await type(window,'Origen','anterior');
    const limit=Date.now()+10000;while(!searches.includes('anterior')&&Date.now()<limit)await delay(20);
    assert.ok(searches.includes('anterior'));
    await type(window,'Origen','nuevo');
    await waitUntil(window,`${field('Origen')}.querySelectorAll('[role="option"]').length===2`);
    await delay(1100);
    assert.equal(await window.webContents.executeJavaScript(`${field('Origen')}.textContent.includes('Respuesta obsoleta')`),false);
    await key(window,'Origen','Escape');
    await waitUntil(window,`${input('Origen')}.getAttribute('aria-expanded')==='false'`);
    assert.equal(await window.webContents.executeJavaScript(`${input('Origen')}.value`),'nuevo');
    await key(window,'Origen','ArrowUp');
    await waitUntil(window,`${field('Origen')}.querySelectorAll('[aria-selected="true"]')[0]?.textContent.includes('Pueblo Nuevo')`);
    await key(window,'Origen','Enter');
    await waitUntil(window,`${input('Origen')}.value==='Plaza de Armas de Pueblo Nuevo'`);
    stages.push('Respuesta obsoleta ignorada y Escape/flechas reabren resultados');

    await type(window,'Origen','plaza');
    await waitUntil(window,`${field('Origen')}.querySelectorAll('[role="option"]').length===2`);
    const searchCount=searches.length;
    await type(window,'Origen',' plaza  ');await delay(600);
    assert.equal(searches.length,searchCount,'Añadir espacios no repite la misma consulta');
    assert.equal(await window.webContents.executeJavaScript(`${field('Origen')}.querySelectorAll('[role="option"]').length`),2,'Los espacios conservan los resultados sin quedarse buscando');
    await type(window,'Origen','sin lugar');
    await waitUntil(window,`${field('Origen')}.querySelector('[role="status"]')?.textContent.includes('No encontramos ese lugar')`);
    await type(window,'Origen','fallo servicio');
    await waitUntil(window,`${field('Origen')}.querySelector('[role="status"]')?.textContent.includes('No se pudo ampliar la búsqueda')`);
    assert.equal(await window.webContents.executeJavaScript(`${field('Origen')}.textContent.includes('No encontramos ese lugar')`),false);
    stages.push('Espacios, búsqueda vacía y fallo de proveedor tienen estados correctos');

    window.setContentSize(390,844);
    window.webContents.enableDeviceEmulation({screenPosition:'mobile',screenSize:{width:390,height:844},viewPosition:{x:0,y:0},viewSize:{width:390,height:844},deviceScaleFactor:1,scale:1});
    await type(window,'Origen','plaza');
    await waitUntil(window,`${field('Origen')}.querySelectorAll('[role="option"]').length===2`);
    const bounds=await window.webContents.executeJavaScript(`(()=>{const list=${field('Origen')}.querySelector('[role="listbox"]');const rect=list.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};})()`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1,'El desplegable cabe en el celular');
    assert.ok(bounds.scrollWidth<=bounds.width,'La página no se desborda en celular');
    stages.push('Desplegable accesible y sin desbordamiento a 390 px');
    const result={passed:true,scenarios:stages,searches,plans:plans.length,blockedHosts:[...blockedHosts]};
    await fs.writeFile(path.join(local,'resultado.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));window.destroy();server.close();app.exit(0);
}
run().catch(async error=>{console.error(error.stack||error);await fs.writeFile(path.join(local,'error.txt'),String(error.stack||error));server.close();app.exit(1);});
