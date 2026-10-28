import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real React map/theme/lifecycle integration. The GPU and provider transport are
// explicit adapters: this does not claim to reproduce Android renderer death.
const adapter = `
class Map {
 constructor(options){this.options=options;this.handlers={};this.sources={};this.layers={};this.camera=[];this.center=options.center;this.zoom=options.zoom;this.bearing=options.bearing;this.pitch=options.pitch;
 this.layers.background={id:'background',type:'background',paint:{'background-color':'#f8f8f8'}};
 this.layers.water={id:'water',type:'fill',paint:{'fill-color':'#c0ebf5'}};
 this.layers['road-primary']={id:'road-primary',type:'line','source-layer':'road',paint:{'line-color':'#ffffaa'}};
 this.layers['street-label']={id:'street-label',type:'symbol',layout:{'text-field':'name'},paint:{'text-color':'#112233'}};
 this.canvas=document.createElement('div');this.canvas.style.cssText='position:absolute;inset:0;background:repeating-linear-gradient(35deg,#dbe9e2 0px,#dbe9e2 39px,#abd5c6 40px,#abd5c6 44px)';this.options.container.append(this.canvas);
 window.auditMaps.push(this);window.auditMap=this;setTimeout(()=>this.fire('load'),0);}
 on(name,fn){(this.handlers[name]??=new Set()).add(fn);return this;}off(name,fn){this.handlers[name]?.delete(fn);return this;}
 fire(name,event={}){for(const fn of [...(this.handlers[name]||[])])fn({...event,target:this});}
 loaded(){return true;}isStyleLoaded(){return true;}areTilesLoaded(){return true;}getContainer(){return this.options.container;}getZoom(){return this.zoom;}
 getBearing(){return this.bearing;}getPitch(){return this.pitch;}getCenter(){return {lng:this.center[0],lat:this.center[1]};}
 getBounds(){return {getWest:()=>-75.8,getEast:()=>-75.65,getSouth:()=>-14.15,getNorth:()=>-13.95};}
 getStyle(){return {layers:Object.values(this.layers)};}getLayer(id){return this.layers[id];}getSource(id){return this.sources[id];}
 addSource(id,options){this.sources[id]={...options,setData:data=>{this.sources[id].data=data;},setTiles:tiles=>{this.sources[id].tiles=tiles;}};}
 addLayer(layer){this.layers[layer.id]={...layer,layout:{...layer.layout},paint:{...layer.paint}};}
 getPaintProperty(id,key){return this.layers[id]?.paint[key];}setPaintProperty(id,key,value){this.layers[id].paint[key]=value;}
 setConfigProperty(_import,key,value){(this.config??={})[key]=value;}
 setLayoutProperty(id,key,value){this.layers[id].layout[key]=value;}addControl(){}resize(){}triggerRepaint(){}stop(){this.stops=(this.stops||0)+1;}
 easeTo(options){this.camera.push(options);if(options.center)this.center=options.center;if(options.zoom)this.zoom=options.zoom;}
 flyTo(options){this.easeTo(options);}fitBounds(){}resetNorthPitch(){}remove(){this.removed=true;this.canvas.remove();this.handlers={};}
}
class Marker{constructor(options){this.element=options.element;}setLngLat(value){this.coordinates=value;return this;}addTo(map){this.map=map;this.element.style.cssText='position:absolute;left:50%;top:45%;transform:translate(-50%,-50%)';map.options.container.append(this.element);return this;}getElement(){return this.element;}getLngLat(){return {lng:this.coordinates[0],lat:this.coordinates[1]};}on(){return this;}remove(){this.element.remove();}}
export default {Map,Marker,AttributionControl:class{},LngLatBounds:class{extend(){return this;}}};
`;
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MapView}from'./src/components/map/MapView';import{ThemeProvider,useTheme}from'./src/hooks/useTheme';
window.auditMaps=[];window.auditForeground=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.auditForeground?'visible':'hidden'});
window.auditSetForeground=value=>{window.auditForeground=value;document.dispatchEvent(new Event('visibilitychange'));};
const route={id:'driving-test',modo:'driving',distancia:2220,duracion:400,geometria:{type:'LineString',coordinates:[[-75.75,-14.07],[-75.74,-14.07],[-75.73,-14.07]]},pasos:[],advertencias:[]};
window.auditRoute=route;
function Test(){const theme=useTheme();window.auditSetTheme=theme.setThemePreference;const[fix,setFix]=useState({latitud:-14.07,longitud:-75.745,accuracy:5,timestamp:Date.now()}),[visible,setVisible]=useState(true),[layers,setLayers]=useState(false),[focus,setFocus]=useState(null);window.auditFix=fix;window.auditSetFix=setFix;window.auditUnmount=()=>setVisible(false);window.auditOpenLayers=()=>setLayers(true);window.auditSetFocus=setFocus;
return visible?<MapView ruta={route} posicion={fix} following navigationMode focusedLocation={focus} layersOpen={layers} onLayersOpenChange={setLayers} onLocateMe={async()=>window.auditFix}/>:null;}
createRoot(document.getElementById('root')).render(<ThemeProvider><Test/></ThemeProvider>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2020', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'map-lifecycle-adapters', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const file = args.path.replaceAll('\\', '/');
      if (file === 'mapbox-gl') return { path: 'map', namespace: 'fixture' };
      if (file.endsWith('services/native')) return { path: 'native', namespace: 'fixture' };
      if (file === './api' || file.endsWith('services/api')) return { path: 'api', namespace: 'fixture' };
      if (file.endsWith('.css')) return { path: 'css', namespace: 'fixture' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'map' ? adapter : args.path === 'native' ? `
      export const triggerHaptic=async()=>{};export const onNetworkChange=()=>()=>{};
      export const StorageService={get:async()=>null,set:async()=>{},remove:async()=>{}};` : args.path === 'api' ? `
      export const api=async path=>path.endsWith('/risk')?{version:'v1',revision:'r1',values:[]}:path.endsWith('/status')?{configurado:false,habilitado:false,controlCuotaDisponible:false}:{version:'v1',type:'FeatureCollection',features:[]};
      export const post=async()=>({});export const del=async()=>{};export const errorMessage=err=>err.message;export const resolveApiUrl=path=>'https://map-test.invalid/api'+path;
      export const distance=(a,b)=>Math.hypot(a.latitud-b.latitud,a.longitud-b.longitud)*111000;` : '' }));
  } }],
});
const executablePath = process.env.CIVIGO_CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const folder = '.local/oct20-map-lifecycle'; await mkdir(folder, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', handler => handler.abort());
  await page.setContent('<div id="root" style="width:390px;height:844px"></div>');
  await page.addStyleTag({ content: (await readFile('src/index.css', 'utf8')) + '\n' + await readFile('src/components/map/map-glass.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.auditMap?.sources['route-source']?.data.geometry);
  assert.equal(await page.locator('.user-gps-marker').count(), 1);
  assert.equal(await page.locator('[aria-label="Centrar ubicación y seguir recorrido"]').count(), 1);
  const original = await page.evaluate(() => JSON.stringify(window.auditRoute.geometria));
  assert.ok(await page.evaluate(() => window.auditMap.sources['route-completed-source'].data.geometry.coordinates.length >= 2));
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.evaluate(() => { window.auditMap.fire('webglcontextlost', { originalEvent: { preventDefault() { window.auditPrevented = true; } } }); window.auditSetForeground(false); });
    await page.getByText('Recuperando mapa…', { exact: true }).waitFor();
    await page.evaluate(() => { window.auditSetForeground(true); window.auditMap.fire('webglcontextrestored'); });
    await page.waitForFunction(() => !document.body.textContent.includes('Recuperando mapa…'));
  }
  assert.equal(await page.evaluate(() => window.auditMaps.length), 1);
  assert.equal(await page.evaluate(() => window.auditPrevented), true);
  assert.equal(await page.locator('.user-gps-marker').count(), 1);
  assert.equal(await page.evaluate(() => window.auditMap.handlers.webglcontextlost.size), 1);
  await page.evaluate(() => { window.auditMap.fire('dragstart'); window.auditMap.camera=[]; });
  await page.evaluate(() => window.auditSetFix({ ...window.auditFix, longitud:-75.7448,timestamp:Date.now()+500 }));
  assert.equal(await page.evaluate(() => window.auditMap.camera.length), 0);
  await page.getByRole('button', { name: 'Centrar ubicación y seguir recorrido', exact: true }).click();
  await page.waitForFunction(() => window.auditMap.camera.length === 1);
  await page.evaluate(() => window.auditOpenLayers());
  await page.evaluate(() => window.auditSetTheme('dark'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await page.evaluate(() => window.auditMap.layers.background.paint['background-color']), '#f8f8f8');
  assert.equal(await page.evaluate(() => window.auditMap.layers['route-line'].paint['line-color']), '#1554d8');
  assert.equal(await page.evaluate(() => window.auditMaps.length), 1);
  assert.equal(await page.locator('.user-gps-marker').count(), 1);
  await page.evaluate(() => window.auditSetTheme('light'));
  await page.waitForFunction(() => window.auditMap.layers['road-primary'].paint['line-color'] === '#ffffaa');
  await page.getByRole('button', { name: 'Cerrar capas del mapa', exact: true }).click();
  await page.evaluate(() => window.auditSetFocus({ latitud:-14.071,longitud:-75.741 }));
  await page.locator('.map-focused-location').waitFor();
  await page.waitForFunction(() => window.auditMap.camera.filter(call=>call.center).at(-1)?.center?.[0]===-75.741);
  await page.getByRole('button', { name:'Centrar ubicación y seguir recorrido',exact:true }).click();
  await page.waitForFunction(() => window.auditMap.camera.filter(call=>call.center).at(-1)?.center?.[0]===window.auditFix.longitud);
  await page.evaluate(() => { window.auditSetForeground(false); window.auditMap.fire('webglcontextlost',{originalEvent:{preventDefault(){}}}); });
  await page.getByText('Recuperando mapa…',{exact:true}).waitFor();
  await page.evaluate(() => { window.auditSetForeground(true); window.auditMap.fire('webglcontextrestored'); });
  await page.waitForFunction(() => window.auditMap.camera.filter(call=>call.center).at(-1)?.center?.[0]===window.auditFix.longitud);
  assert.equal(await page.evaluate(() => window.auditMap.camera.filter(call=>call.center).at(-1).center[0]),-75.7448,'Una ubicación enfocada anteriormente no anula el recentrado al recuperar la app');
  await page.evaluate(() => window.auditSetFocus(null));
  await page.locator('.map-focused-location').waitFor({state:'detached'});
  assert.equal(await page.evaluate(() => JSON.stringify(window.auditRoute.geometria)), original);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.auditUnmount());
  await page.waitForFunction(() => window.auditMap.removed);
  assert.equal(await page.evaluate(() => Object.keys(window.auditMap.handlers).length), 0);
  const result = { passed: true, cycles: 5, mapInstances: 1, gpu: 'Mapbox adapter, not Android GPU', assertions: ['context restored in place','background pauses recovery','completed geometry retained','route immutable','manual camera honored','recenter restores following','interface dark theme preserves light map','exact light theme restored','focused place does not override later recenter after resume','focused marker clears','one marker/listener','unmount cleanup'], errors };
  await writeFile(`${folder}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
