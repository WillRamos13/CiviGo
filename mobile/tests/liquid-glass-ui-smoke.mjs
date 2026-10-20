import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Render real React, MapPage, MapView, route planner, dialogs and production CSS.
// Mapbox, GPS, speech and HTTP are explicit local fixtures. No provider, real
// account, network map tiles or native speech engine is contacted by this test.
const root = process.cwd();
const artifacts = path.join(root, '.local', 'liquid-glass-ui-smoke');
const fixtureOrigin = 'https://liquid-glass.civigo.invalid';
await mkdir(artifacts, { recursive: true });

const mapAdapter = `
const bounds = [-75.80, -14.14, -75.65, -13.98];
class Map {
  constructor(options) {
    this.options=options; this.container=options.container; this.sources={}; this.layers={};
    this.handlers={}; this.markers=new Set(); this.center=options.center; this.zoom=options.zoom;
    this.bearing=0; this.pitch=0; this.bounds=[...bounds]; this.camera=[];
    this.layers['fixture-background']={id:'fixture-background',type:'background',paint:{'background-color':'#dbe9e2'}};
    this.layers['fixture-road']={id:'fixture-road',type:'line','source-layer':'road',paint:{'line-color':'#a9d5c6'}};
    this.layers['fixture-street-label']={id:'fixture-street-label',type:'symbol',layout:{'text-field':'nombre'},paint:{'text-color':'#345a5d'}};
    this.container.classList.add('mapboxgl-map');
    this.canvas=document.createElement('canvas'); this.canvas.className='mapboxgl-canvas';
    this.canvas.setAttribute('aria-label','Mapa base simulado sin servicios externos');
    this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
    this.container.append(this.canvas); window.auditMap=this; (window.auditMapInstances??=[]).push(this);
    this.dragPan={enable(){},disable(){}}; this.touchZoomRotate={enable(){},disable(){},disableRotation(){}};
    this.scrollZoom={enable(){},disable(){}}; this.resize();
    setTimeout(()=>this.fire('load'),0);
  }
  on(name,...values){const callback=values.at(-1);(this.handlers[name]??=new Set()).add(callback);return this;}
  off(name,...values){this.handlers[name]?.delete(values.at(-1));return this;}
  fire(name,data={}){for(const callback of [...(this.handlers[name]||[])])callback({target:this,...data});return this;}
  loaded(){return true;} areTilesLoaded(){return true;} isStyleLoaded(){return true;}
  getContainer(){return this.container;} getCanvas(){return this.canvas;}
  getStyle(){return {version:8,layers:Object.values(this.layers)};}
  getZoom(){return this.zoom;} getBearing(){return this.bearing;} getPitch(){return this.pitch;}
  getCenter(){return {lng:this.center[0],lat:this.center[1]};}
  getBounds(){return {getWest:()=>this.bounds[0],getSouth:()=>this.bounds[1],getEast:()=>this.bounds[2],getNorth:()=>this.bounds[3]};}
  setZoom(value){this.zoom=value;this.fire('zoom');this.fire('zoomend');return this;}
  zoomIn(){return this.setZoom(this.zoom+1);} zoomOut(){return this.setZoom(this.zoom-1);}
  pan(next){this.bounds=[...next];this.fire('dragstart');this.fire('moveend');this.resize();}
  project(point){const c=Array.isArray(point)?point:[point.lng,point.lat];return {x:(c[0]-this.bounds[0])/(this.bounds[2]-this.bounds[0])*this.container.clientWidth,y:(this.bounds[3]-c[1])/(this.bounds[3]-this.bounds[1])*this.container.clientHeight};}
  unproject(point){return {lng:this.bounds[0]+point.x/this.container.clientWidth*(this.bounds[2]-this.bounds[0]),lat:this.bounds[3]-point.y/this.container.clientHeight*(this.bounds[3]-this.bounds[1])};}
  addControl(){} triggerRepaint(){} stop(){} fitBounds(_bounds,options){this.camera.push({kind:'fit',...options});}
  easeTo(options){this.camera.push({kind:'ease',...options});if(options.center)this.center=options.center;if(options.zoom!==undefined)this.zoom=options.zoom;if(options.bearing!==undefined)this.bearing=options.bearing;if(options.pitch!==undefined)this.pitch=options.pitch;this.fire('zoom');this.fire('moveend');return this;}
  flyTo(options){this.camera.push({kind:'fly',...options});if(options.center)this.center=options.center;if(options.zoom!==undefined)this.zoom=options.zoom;this.fire('zoom');this.fire('moveend');return this;}
  resetNorthPitch(options){this.camera.push({kind:'north',...options});this.bearing=0;this.pitch=0;return this;}
  addSource(name,options){
    const deliver=()=>setTimeout(()=>{if(name!=='tomtom-flow'||!window.auditHoldTrafficTiles)this.fire('sourcedata',{sourceId:name,sourceDataType:'content',tile:{},isSourceLoaded:true});},0);
    this.sources[name]={...options,setData:data=>{this.sources[name].data=data;this.resize();},setTiles:tiles=>{this.sources[name].tiles=tiles;deliver();}};
    deliver();
  }
  addLayer(layer){this.layers[layer.id]={...layer,layout:{...layer.layout},paint:{...layer.paint}};}
  getSource(name){return this.sources[name];} getLayer(name){return this.layers[name];}
  removeLayer(name){delete this.layers[name];} removeSource(name){delete this.sources[name];}
  setLayoutProperty(name,key,value){if(this.layers[name])this.layers[name].layout[key]=value;}
  setPaintProperty(name,key,value){if(this.layers[name])this.layers[name].paint[key]=value;}
  getPaintProperty(name,key){return this.layers[name]?.paint[key];}
  setFilter(name,filter){if(this.layers[name])this.layers[name].filter=filter;}
  queryRenderedFeatures(){return [];}
  resize(){
    const width=this.container.clientWidth||390,height=this.container.clientHeight||720;
    this.canvas.width=width;this.canvas.height=height;
    const ctx=this.canvas.getContext('2d');const dark=false;
    ctx.fillStyle=dark?'#153143':'#dbe9e2';ctx.fillRect(0,0,width,height);
    ctx.save();ctx.translate(width*.48,height*.46);ctx.rotate(-.17);
    for(let index=-12;index<13;index++){
      ctx.lineWidth=index%4===0?8:3;ctx.strokeStyle=dark?'#366677':'#a9d5c6';
      ctx.beginPath();ctx.moveTo(-width*2,index*46);ctx.lineTo(width*2,index*46);ctx.stroke();
      ctx.beginPath();ctx.moveTo(index*52,-height*2);ctx.lineTo(index*52,height*2);ctx.stroke();
    }
    ctx.restore();ctx.font='600 13px sans-serif';ctx.fillStyle=dark?'#c8e5e9':'#345a5d';
    for(const [label,x,y]of [['ICA',.32,.25],['Av. San Martín',.5,.48],['Plaza de Armas',.12,.65],['Av. Ayabaca',.4,.8]])ctx.fillText(label,width*x,height*y);
    for(const marker of this.markers)marker.position();
  }
  remove(){for(const marker of [...this.markers])marker.remove();this.canvas.remove();this.removed=true;this.handlers={};}
}
class Marker {
  constructor(options={}){this.element=options.element||document.createElement('div');this.element.classList.add('mapboxgl-marker');this.coordinates=[0,0];}
  setLngLat(point){this.coordinates=Array.isArray(point)?point:[point.lng,point.lat];this.position();return this;}
  addTo(map){this.map=map;map.markers.add(this);this.element.style.position='absolute';map.container.append(this.element);this.position();return this;}
  position(){if(!this.map)return;const {x,y}=this.map.project(this.coordinates);this.element.style.left=x+'px';this.element.style.top=y+'px';this.element.style.transform='translate(-50%,-50%)';}
  getElement(){return this.element;} getLngLat(){return {lng:this.coordinates[0],lat:this.coordinates[1]};}
  on(){return this;} setRotation(){return this;} setPopup(popup){this.popup=popup;return this;}
  remove(){this.map?.markers.delete(this);this.element.remove();return this;}
}
class Popup {
  constructor(){this.element=document.createElement('aside');this.element.className='mapboxgl-popup';this.element.style.cssText='position:absolute;left:12px;top:120px;z-index:60;max-width:280px;padding:12px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;';}
  setLngLat(){return this;} setDOMContent(element){this.content=element;return this;} setHTML(value){const body=document.createElement('div');body.innerHTML=value;return this.setDOMContent(body);}
  addTo(map){const close=document.createElement('button');close.setAttribute('aria-label','Cerrar aviso vial');close.textContent='×';close.onclick=()=>this.remove();this.element.append(close,this.content);map.container.append(this.element);return this;}
  getElement(){return this.element;} on(){return this;} remove(){this.element.remove();return this;}
}
export default {Map,Marker,Popup,AttributionControl:class{},NavigationControl:class{},LngLatBounds:class{extend(){return this;}}};
`;

const apiAdapter = `
export const isNative=false;
export const BASE_API_URL='${fixtureOrigin}/api';
export const API_URL=BASE_API_URL;
export class ApiError extends Error{constructor(message,status=0,code){super(message);this.status=status;this.code=code;}}
export function resolveApiUrl(path){return path.startsWith(BASE_API_URL)?path:BASE_API_URL+(path.startsWith('/')?path:'/'+path);}
export const api=(path,options={})=>window.auditApi(path,options);
export const post=(path,body,options={})=>window.auditPost(path,body,options);
export const put=(path,body,options={})=>window.auditPost(path,body,{...options,method:'PUT'});
export const patch=(path,body,options={})=>window.auditPost(path,body,{...options,method:'PATCH'});
export const del=(path,options={})=>window.auditApi(path,{...options,method:'DELETE'});
export const crearReporte=(data,options={})=>window.auditPost('/reports',data,options);
export const upload=async()=>{throw new Error('Este fixture no permite cargar archivos.');};
export const errorMessage=error=>error.message;
export const formatDate=value=>value?new Intl.DateTimeFormat('es-PE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value)):'Sin fecha';
export function distance(a,b){const r=v=>v*Math.PI/180,p=r(b.latitud-a.latitud),q=r(b.longitud-a.longitud);return 6371000*2*Math.asin(Math.sqrt(Math.sin(p/2)**2+Math.cos(r(a.latitud))*Math.cos(r(b.latitud))*Math.sin(q/2)**2));}
const unauthorized=new Set();export const onUnauthorized=listener=>{unauthorized.add(listener);window.auditRevoke=()=>{for(const fn of unauthorized)fn();};return()=>unauthorized.delete(listener);};
export const advanceApiSession=()=>{};
`;
const nativeAdapter = `
const listeners=new Set();export const isNative=false;
export const triggerHaptic=async()=>{};
export const getCurrentPosition=async()=>window.auditFix;
export const getCurrentDevicePosition=getCurrentPosition;
export const watchDevicePosition=()=>()=>{};
export const onNetworkChange=callback=>{listeners.add(callback);window.auditNetwork=connected=>{for(const fn of listeners)fn({connected,connectionType:connected?'wifi':'none'});};return()=>listeners.delete(callback);};
export const getNetworkStatus=async()=>({connected:true,connectionType:'wifi'});
export const StorageService={get:async key=>localStorage.getItem(key),set:async(key,value)=>{localStorage.setItem(key,value);},remove:async key=>{localStorage.removeItem(key);},getJSON:async key=>localStorage.getItem(key)?JSON.parse(localStorage.getItem(key)):null,setJSON:async(key,value)=>{localStorage.setItem(key,JSON.stringify(value));}};
export const onHardwareBackButton=()=>()=>{};export const minimizeAndroidApp=async()=>{};
export const capturePhotoOrVideo=async()=>null;export const getRecoveredReportPhoto=async()=>null;export const loadRecoveredReportPhoto=async()=>null;export const consumeRecoveredReportPhoto=async()=>{};export const discardRecoveredReportPhotos=async()=>{};
`;
const voiceAdapter = `
export const navigationVoiceSupported=()=>true;
export const speakNavigation=async text=>{window.auditSpeech.push(text);};
export const stopNavigationVoice=async()=>{window.auditSpeechStops++;};
`;
const spotifyCoreAdapter = `
const listeners=new Set();
const record=(method,body)=>{(window.auditSpotifyCalls??=[]).push({method,body});};
window.auditSpotifyPublish=value=>{window.auditSpotifyPlayback=value;for(const listener of listeners)listener(value);};
window.auditSpotifyListenerCount=()=>listeners.size;
export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:name=>name==='SpotifyRemote'};
export const registerPlugin=name=>({
 capabilities:async()=>{record('capabilities');return{platform:'android',configured:true,installed:true,connected:!!window.auditSpotifyPlayback?.connected};},
 setEnabled:async body=>{record('setEnabled',body);if(!body.enabled){listeners.clear();window.auditSpotifyPlayback=null;}},
 connect:async body=>{record('connect',body);return window.auditSpotifyPlayback={connected:true,paused:false,positionMs:2000,updatedAt:Date.now(),canSkipNext:true,canSkipPrevious:true,track:{name:'Fixture SDK',artist:'Fixture Artist',uri:'spotify:track:abc123',durationMs:180000}};},
 getState:async()=>window.auditSpotifyPlayback,
 disconnect:async()=>{record('disconnect');window.auditSpotifyPlayback=null;},
 command:async body=>{record('command',body);},
 addListener:async(_name,listener)=>{record('addListener');listeners.add(listener);return{remove:async()=>{record('removeListener');listeners.delete(listener);}};},
});
`;

const entry = String.raw`
import React,{useState,useCallback}from'react';
import{createRoot}from'react-dom/client';
import{AppContent}from'./src/App';
import{ThemeProvider,useTheme}from'./src/hooks/useTheme';
import'./src/index.css';
window.auditCalls=[];window.auditSpeech=[];window.auditSpeechStops=0;
window.auditSpotifyCalls=[];
window.auditForeground=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.auditForeground?'visible':'hidden'});
window.auditSetForeground=value=>{window.auditForeground=value;document.dispatchEvent(new Event('visibilitychange'));};
window.auditUser={id:901,nickname:'Vecina de prueba',correo:'prueba@example.invalid',rol:'USUARIO',premium:false,bloqueado:false,correoVerificado:true,permisos:[]};
window.auditFix={latitud:-14.0678,longitud:-75.7286,accuracy:5,heading:175,speed:1.3,timestamp:Date.now()};
const when=new Date().toISOString();
window.auditIncidents=[
 {id:501,tipo:'bache',tipoSlug:'bache',tipoNombre:'Bache',fechaEvento:'2024-06-01T05:00:00Z',descripcion:'Bache frente al acceso peatonal de la avenida de prueba.',latitud:-14.0679,longitud:-75.7286,nivelRiesgo:2},
 {id:502,tipo:'robo',tipoSlug:'robo',tipoNombre:'Robo',fechaEvento:'2023-06-01T05:00:00Z',descripcion:'Reporte ciudadano de prueba: revisar el entorno antes de continuar.',latitud:-14.075,longitud:-75.734,nivelRiesgo:4,individual:true},
 {id:503,tipo:'incendio',tipoSlug:'incendio',tipoNombre:'Incendio',descripcion:'Humo visible en un inmueble de la calle de prueba.',latitud:-14.045,longitud:-75.75,nivelRiesgo:3},
 {id:504,tipo:'bache',tipoSlug:'bache',tipoNombre:'Bache',descripcion:'Incidente fuera del viewport, parte del snapshot provincial.',latitud:-14.8,longitud:-75.2,nivelRiesgo:1},
].map(value=>({estado:'VALIDADO',publicado:true,totalReportes:1,evaluacion:'AGENTE',fechaCreacion:when,fechaPublicacion:when,adjuntos:[],...value}));
window.auditIncidents.push(...Array.from({length:547},(_,index)=>({...window.auditIncidents[3],id:1000+index,latitud:-14.5-(index%20)*.01,longitud:-75.3+(index%10)*.005})));
window.auditIncidents.sort((a,b)=>b.id-a.id);
const roads={version:'fixture-v1',type:'FeatureCollection',features:[{type:'Feature',id:1,properties:{id:1,nombre:'Calle de prueba',puntos:20,nivelRiesgo:2,pendiente:false},geometry:{type:'LineString',coordinates:[[-75.7286,-14.0678],[-75.7286,-14.0718]]}}]};
const coordinates=[[-75.7286,-14.0678],[-75.7286,-14.0718],[-75.731,-14.0758]];
window.auditRoutes=['segura','rapida','equilibrada'].map((tipo,index)=>({id:tipo+'-fixture',tipo,nombre:['Más segura','Más rápida','Equilibrada'][index],distancia:[1400,1000,1200][index],duracion:[720,480,600][index],geometria:{type:'LineString',coordinates},nivelRiesgo:[1,4,2][index],puntosRiesgo:[8,48,20][index],riesgoConocido:true,advertencias:tipo==='segura'?['Compara también las condiciones visibles al llegar.']:[],trafico:{disponible:true,fuente:'TomTom',actualizadoEn:when,demoraSegundos:[45,90,60][index],motivo:''},pasos:[
 {id:'start',tipo:'salida',maniobra:'recto',instruccion:'Continúa por la avenida de prueba',calle:'Avenida local',distancia:450,duracion:200,distanciaAcumulada:0,duracionAcumulada:0,coordenadas:coordinates[0],indiceInicio:0,indiceFin:1,geometria:{type:'LineString',coordinates:coordinates.slice(0,2)}},
 {id:'left',tipo:'giro',maniobra:'izquierda',instruccion:'Gira a la izquierda en la calle de prueba',calle:'Calle local',distancia:950,duracion:400,distanciaAcumulada:450,duracionAcumulada:200,coordenadas:coordinates[1],indiceInicio:1,indiceFin:2,geometria:{type:'LineString',coordinates:coordinates.slice(1)}},
]}));
window.auditTrafficUnavailable=false;
window.auditApi=async(path,options={})=>{
 if(options.signal?.aborted)throw new DOMException('Cancelada','AbortError');
 window.auditCalls.push({method:options.method||'GET',path});
 await new Promise(resolve=>setTimeout(resolve,5));
 if(options.signal?.aborted)throw new DOMException('Cancelada','AbortError');
 const url=new URL(path,'${fixtureOrigin}');
 let data;
 if(url.pathname==='/incidents'){
   if(url.searchParams.has('bbox')){const start=url.searchParams.has('after')?window.auditIncidents.findIndex(item=>item.id===Number(url.searchParams.get('after')))+1:0;const items=window.auditIncidents.slice(start,start+300);data={items,nextCursor:start+items.length<window.auditIncidents.length?items.at(-1).id:null};}
   else data=window.auditIncidents.filter(item=>item.id<504);
 }
 else if(/^\/incidents\/\d+\/chat$/.test(url.pathname))data=[];
 else if(/^\/incidents\/\d+$/.test(url.pathname))data=window.auditIncidents.find(item=>item.id===Number(url.pathname.split('/').at(-1)));
 else if(url.pathname==='/navigation/roads/risk')data={version:'fixture-v1',revision:'r1',values:[[1,20,2,false]]};
 else if(url.pathname==='/navigation/roads/geometry')data=roads;
 else if(url.pathname==='/navigation/favorites')data=[];
 else if(url.pathname==='/navigation/places')data=[{nombre:'Plaza de Armas de Ica',descripcion:'Destino local del smoke',fuente:'Fixture local',latitud:-14.0758,longitud:-75.731}];
 else if(url.pathname==='/navigation/traffic/status')data={configurado:true,habilitado:true,controlCuotaDisponible:true,cuotas:{tiles:{restantes:100}},cobertura:[-76.3,-15,-75.1,-13.3]};
 else if(url.pathname==='/navigation/traffic/incidents')data={incidentes:window.auditTrafficUnavailable?[]:[{id:'tomtom:fixture-cierre',externoId:'fixture-cierre',fuente:'TOMTOM',tipo:'ROAD_CLOSED',titulo:'Cierre vial de prueba',descripcion:'<img src=x onerror="window.auditInjected=true"> Texto externo visible sin ejecutar HTML.',latitud:-14.061,longitud:-75.743,inicio:when,fin:null,actualizadoEn:when,sentido:null,demoraSegundos:120,temporal:true,afectaRiesgo:false,geometria:{type:'Point',coordinates:[-75.743,-14.061]}}],trafico:{disponible:!window.auditTrafficUnavailable,fuente:'TomTom',actualizadoEn:when,motivo:window.auditTrafficUnavailable?'No disponible en el fixture':''}};
 else if(url.pathname==='/catalog')data={categorias:[{id:1,nombre:'Entorno',tipos:[{id:1,nombre:'Bache',slug:'bache'},{id:2,nombre:'Robo',slug:'robo'},{id:3,nombre:'Incendio',slug:'incendio'}]}],config:{confirmaciones:3,confirmacionMetros:50},distritos:['Ica']};
 else throw new Error('El fixture no permite esta lectura: '+path);
 return structuredClone(data);
};
window.auditPost=async(path,body,options={})=>{
 if(options.signal?.aborted)throw new DOMException('Cancelada','AbortError');
 window.auditCalls.push({method:'POST',path,body});
 await new Promise(resolve=>setTimeout(resolve,10));
 if(options.signal?.aborted)throw new DOMException('Cancelada','AbortError');
 if(path==='/navigation/plan')return{rutas:structuredClone(window.auditRoutes).map(route=>body.modo==='driving'?route:{...route,trafico:{disponible:false,fuente:null,actualizadoEn:null,demoraSegundos:0,motivo:'El modo seleccionado no utiliza tráfico en vivo.'}})};
 if(path==='/navigation/history')return{guardado:true};
 if(path==='/navigation/favorites')return{id:1,nombre:body.nombre,modo:body.modo,origen:body.origen,destino:body.destino,datos:body.ruta};
 throw new Error('El fixture no permite esta escritura: '+path);
};
function ThemeProbe(){window.auditSetTheme=useTheme().setThemePreference;return null;}
function Test(){const[revision,setRevision]=useState(0);window.auditSetUser=value=>{window.auditUser=value;setRevision(value=>value+1);};
 return <ThemeProvider><ThemeProbe/><div data-audit-revision={revision} style={{height:'100%'}}><AppContent/></div></ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<Test/>);
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
  outdir: path.join(artifacts, 'bundle'), format: 'iife', platform: 'browser', target: 'es2020',
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', BASE_URL: '/', VITE_API_URL: fixtureOrigin + '/api' }) },
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'isolated-liquid-glass-ports', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const specifier = args.path.replaceAll('\\', '/'), importer = args.importer.replaceAll('\\', '/');
      if (specifier === 'mapbox-gl') return { path: 'map', namespace: 'audit' };
      if (specifier === '@capacitor/core' && importer.endsWith('/services/spotifyRemote.ts')) return { path: 'spotify-core', namespace: 'audit' };
      if (specifier === 'mapbox-gl/dist/mapbox-gl.css') return { path: 'empty-css', namespace: 'audit' };
      if (specifier.endsWith('/services/api') || specifier === './api' && importer.includes('/services/')) return { path: 'api', namespace: 'audit' };
      if (specifier.endsWith('/hooks/useAuth')) return { path: 'auth', namespace: 'audit' };
      if (specifier.endsWith('/services/auth') || specifier === './auth' && importer.includes('/services/')) return { path: 'auth-service', namespace: 'audit' };
      if (specifier.endsWith('/hooks/useGeolocation')) return { path: 'gps', namespace: 'audit' };
      if (specifier.endsWith('/services/native') || specifier === './native' && importer.includes('/services/')) return { path: 'native', namespace: 'audit' };
      if (specifier.endsWith('/services/navigationVoice') || specifier === './navigationVoice') return { path: 'voice', namespace: 'audit' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'audit' }, args => ({ loader: 'js', resolveDir: root, contents:
      args.path === 'map' ? mapAdapter : args.path === 'api' ? apiAdapter : args.path === 'native' ? nativeAdapter : args.path === 'voice' ? voiceAdapter : args.path === 'spotify-core' ? spotifyCoreAdapter :
      args.path === 'auth' ? 'export const AuthProvider=({children})=>children;export const useAuth=()=>({usuario:window.auditUser,loading:false,offline:false,refresh:async()=>{},logout:async()=>window.auditSetUser(null)});' :
      args.path === 'auth-service' ? 'export const canParticipate=user=>user?.correoVerificado===true&&user?.bloqueado!==true;export const AuthService=new Proxy({}, {get:()=>async()=>{throw new Error("El fixture no permite mutaciones de cuenta.");}});' :
      args.path === 'gps' ? `import{useState,useCallback}from'react';export function useGeolocation(){const[position,setPosition]=useState(window.auditFix);window.auditSetFix=value=>{window.auditFix=value&&{...value,timestamp:Date.now()};setPosition(window.auditFix);};const locate=useCallback(async()=>{if(window.auditDenyGPS)return null;const fix={...window.auditFix,timestamp:Date.now()};window.auditFix=fix;setPosition(fix);return fix;},[]);return{position,loading:false,error:'',locate,setPosition};}` : '' }));
  } }],
});

const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
if (process.argv.includes('--build-only')) {
  console.log(JSON.stringify({ compiled: true, javascriptBytes: Buffer.byteLength(js), cssBytes: Buffer.byteLength(css) }));
  process.exit(0);
}
const executablePath = process.env.CIVIGO_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
assert.ok(executablePath, 'Se requiere un navegador Chromium instalado para el smoke local.');
const browser = await chromium.launch({ executablePath, headless: true });
const results = [], errors = [], blocked = [];

async function openFixture(viewport, dark = false, preferences = {}) {
  const context = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light' });
  await context.route('**/*', async handler => {
    const url = new URL(handler.request().url());
    if (['data:', 'blob:'].includes(url.protocol)) return handler.continue();
    if (url.origin === fixtureOrigin && url.pathname === '/') return handler.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.origin === fixtureOrigin && (url.pathname.startsWith('/iconos/') || url.pathname === '/civigo-logo.jpeg')) {
      const target = path.resolve(root, 'public', '.' + decodeURIComponent(url.pathname));
      if (target.startsWith(path.resolve(root, 'public') + path.sep)) {
        try { return handler.fulfill({ contentType: target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.png') ? 'image/png' : 'image/jpeg', body: await readFile(target) }); } catch { /* Missing bundled assets remain visible test failures. */ }
      }
    }
    blocked.push(url.href); return handler.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixtureOrigin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(values => { for(const [key,value]of Object.entries(values))localStorage.setItem(key,value); }, preferences);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => !!window.auditMap?.getSource('civigo-incidents')?.data?.features?.length);
  await page.evaluate(() => window.auditMap.resize());
  return { context, page };
}

async function screenshot(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(artifacts, name + '.png') });
}

function visibleMarkers(page) { return page.locator('.incident-marker[data-incident-id]:visible'); }

async function expectReachable(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const state = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { reachable: !!target && (target === element || element.contains(target)), target: target?.className, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } };
  });
  assert.ok(state.reachable, `${label} debe estar libre de paneles superpuestos: ${JSON.stringify(state)}`);
  return state.rect;
}

async function setSheetExpanded(page, expanded) {
  for (const name of expanded ? ['Expandir opciones de navegación', 'Ampliar rutas y condiciones'] : ['Contraer opciones de navegación', 'Mostrar navegación compacta']) {
    const action = page.getByRole('button', { name, exact: true });
    if (await action.count()) { await action.click(); break; }
  }
}

async function searchDestination(page, query = 'Plaza de Armas') {
  await page.getByRole('button', { name: 'Buscar destino en Ica', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Buscar lugares en Ica', exact: true });
  await search.fill(query);
  await page.getByRole('region', { name: 'Resultados de lugares', exact: true }).getByRole('button', { name: /Plaza de Armas de Ica/ }).first().waitFor();
  if (page.viewportSize().width === 390) await screenshot(page, 'destination-search-390');
  await page.getByRole('region', { name: 'Resultados de lugares', exact: true }).getByRole('button', { name: /Plaza de Armas de Ica/ }).first().click();
  const place = page.getByRole('dialog', { name: 'Información del lugar', exact: true });
  assert.equal(await place.getByText(/Calificación|Horario|Reseñas/).count(), 0, 'No se inventan detalles ausentes del proveedor');
  if (page.viewportSize().width === 390) await screenshot(page, 'place-detail-390');
  await place.getByRole('button', { name: 'Ver rutas', exact: true }).click();
  await place.waitFor({ state: 'detached' });
}

async function expectFullscreenNavigation(page, viewport) {
  await page.locator('.app-navigation-fullscreen').waitFor();
  const geometry = await page.locator('.map-mobile-screen').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
  });
  assert.ok(geometry.top <= 1 && geometry.left <= 1 && geometry.right >= viewport.width - 1 && geometry.bottom >= viewport.height - 1, `El mapa ocupa toda la pantalla durante navegación: ${JSON.stringify(geometry)}`);
  assert.equal(await page.locator('.mobile-header:visible').count(), 0);
  assert.equal(await page.locator('.bottom-nav:visible').count(), 0);
  return geometry;
}

try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 768, height: 1024 }, { width: 640, height: 360 }]) {
    for (const dark of [false, true]) {
      const { context, page } = await openFixture(viewport, dark);
      try {
        const theme = dark ? 'dark' : 'light';
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        await page.evaluate(() => window.auditMap.setZoom(13.99));
        assert.equal(await visibleMarkers(page).count(), 0, 'Iconos de incidentes ocultos por debajo de zoom 14');
        assert.equal(await page.evaluate(() => window.auditMap.sources['civigo-incidents'].data.features.length), 551, 'El snapshot mantiene también los incidentes fuera del viewport y sus dos páginas');
        await page.evaluate(() => window.auditMap.setZoom(14));
        await page.waitForFunction(() => [...document.querySelectorAll('.incident-marker[data-incident-id]')].filter(element => element.checkVisibility()).length === 3);
        const layout = await page.evaluate(() => {
          const main = document.querySelector('.app-main').getBoundingClientRect();
          const controls = [...document.querySelectorAll('.map-floating-controls button')].map(button => {
            const box = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label'), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
          });
          const sheet = document.querySelector('.map-bottom-sheet').getBoundingClientRect();
          const legend = document.querySelector('.map-fixed-legend').getBoundingClientRect();
          return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, main: { top: main.top, bottom: main.bottom, height: main.height, width: main.width }, sheet: { height: sheet.height, width: sheet.width, top: sheet.top, bottom: sheet.bottom, left: sheet.left, right: sheet.right }, legend: {width:legend.width,height:legend.height}, controls };
        });
        assert.ok(layout.scrollWidth <= viewport.width + 1, `Sin desbordamiento horizontal en ${viewport.width}/${theme}`);
        assert.equal(layout.controls.length, 2, 'Sólo Ubicación y orientación en los FAB del mapa');
        for (const control of layout.controls) {
          assert.ok(control.left >= 0 && control.right <= viewport.width + 1 && control.top >= layout.main.top - 1 && control.bottom <= layout.main.bottom + 1, `FAB accesible: ${control.label}`);
          assert.ok(control.width >= 40 && control.height >= 40, `Área táctil suficiente: ${control.label}`);
        }
        assert.ok(layout.sheet.height * layout.sheet.width < layout.main.height * layout.main.width * .72, 'El panel deja visible una parte sustancial del mapa, también en el lateral de tablet');
        assert.ok(layout.sheet.left <= 1 && layout.sheet.right >= viewport.width - 1, 'Planificador de borde a borde');
        assert.ok(layout.sheet.bottom >= layout.main.bottom - 1, 'Sin hueco debajo del planificador');
        assert.ok(layout.legend.width <= 130 && layout.legend.height <= 46, 'Leyenda fija pequeña');
        assert.equal(await page.locator('.gn-origin').count(), 0, 'El planificador no repite el origen GPS');
        await screenshot(page, `map-${viewport.width}-${theme}`);
        assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path.startsWith('/navigation/traffic/incidents')).length), 0, 'Sin consultas de incidentes externos mientras tráfico está apagado');
        await page.locator('.map-layer-panel > summary').click();
        await page.locator('.map-layer-panel .map-risk-legend').waitFor({ state: 'visible' });
        await expectReachable(page.getByLabel('Filtrar por tipo', { exact: true }), 'El filtro de tipos');
        await expectReachable(page.locator('.map-layer-panel .map-risk-legend'), 'La leyenda de riesgo');
        const riskRange = await page.locator('.map-layer-panel .map-risk-legend').innerText();
        assert.match(riskRange, /0/); assert.match(riskRange, /5/);
        assert.equal(await page.getByRole('button', { name: 'Leyenda de riesgo', exact: true }).count(), 0, 'No hay FAB de leyenda aislado');
        await screenshot(page, `filters-${viewport.width}-${theme}`);
        await page.getByLabel('Tráfico · TomTom', { exact: true }).check();
        await page.locator('.map-layer-panel .map-traffic-legend').waitFor({ state: 'visible' });
        await page.locator('.map-layer-panel .map-traffic-legend').getByText(/Última recepción/).waitFor();
        await expectReachable(page.locator('.map-layer-panel .map-traffic-legend'), 'La leyenda de tráfico');
        assert.equal(await page.getByLabel('Riesgo por tramo', { exact: true }).isChecked(), false, 'Riesgo y tráfico alternan sin mezclar sus colores');
        await screenshot(page, `traffic-${viewport.width}-${theme}`);
        await page.locator('.map-layer-panel > summary').click();
        await setSheetExpanded(page, true);
        await searchDestination(page);
        await page.locator('.route-result').nth(2).waitFor();
        await page.locator('.route-result').filter({ hasText: 'Equilibrada' }).locator('.route-select').click();
        assert.equal(await page.evaluate(() => window.auditSpeech.length), 0);
        await screenshot(page, `route-cards-${viewport.width}-${theme}`);
        await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).click();
        const guidance = page.getByRole('region', { name: 'Indicaciones del recorrido', exact: true });
        await guidance.waitFor();
        assert.equal(await page.evaluate(() => window.auditSpotifyCalls.length), 0, 'Spotify desactivado no inicializa el SDK ni consulta capacidades');
        await expectFullscreenNavigation(page, viewport);
        assert.equal(await guidance.locator('.gn-turn-row').count(), 0, 'El resumen compacto reserva el mapa');
        assert.equal(await guidance.getByRole('button').count(), 1);
        await expectReachable(guidance.getByRole('button', { name: 'Salir de navegación', exact: true }), `Salir en ${viewport.width}/${theme}`);
        await expectReachable(page.getByRole('button', { name: 'Centrar ubicación y seguir recorrido', exact: true }), `Recentrar flotante en ${viewport.width}/${theme}`);
        assert.ok((await page.locator('.map-bottom-sheet').boundingBox()).height <= 200, 'Navegación compacta ocupa como máximo200px');
        assert.equal(await guidance.locator('.gn-compact-maneuver').count(), 1);
        assert.equal(await guidance.locator('.gn-speed').count(), 1);
        assert.equal(await guidance.locator('.gn-estimate-source').count(), 1);
        assert.equal(await page.locator('.map-fixed-legend, .map-layer-panel').count(), 0, 'La navegación reserva leyendas y filtros al menú');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'La navegación tampoco introduce desbordamiento horizontal');
        await screenshot(page, `navigation-${viewport.width}-${theme}`);
        await setSheetExpanded(page, true);
        for (const name of ['Centrar', 'Silenciar voz', 'Recalcular', 'Finalizar']) await expectReachable(guidance.getByRole('button', { name, exact: true }), `${name} expandido en ${viewport.width}/${theme}`);
        await page.getByRole('button', { name: 'Cambiar capas', exact: true }).waitFor();
        await page.getByRole('radio', { name: 'Auto', exact: true }).waitFor();
        await screenshot(page, `navigation-expanded-${viewport.width}-${theme}`);
        results.push({ viewport, theme, layout, riskRange, routeCardsAndGuidanceChecked: true });
      } catch (error) {
        await screenshot(page, `failure-${viewport.width}-${dark ? 'dark' : 'light'}`);
        throw error;
      } finally { await context.close(); }
    }
  }

  const { context, page } = await openFixture({ width: 390, height: 844 }, true);
  try {
    await page.evaluate(() => window.auditMap.setZoom(14));
    await page.locator('.map-layer-panel > summary').click();
    await page.getByLabel('Todos los años',{exact:true}).uncheck();
    await page.waitForFunction(()=>document.querySelector('.map-bottom-sheet .badge')?.textContent==='0 en mapa');
    await page.getByLabel('2024',{exact:true}).check();
    await page.waitForFunction(()=>document.querySelector('.map-bottom-sheet .badge')?.textContent==='1 en mapa');
    assert.equal(await visibleMarkers(page).count(),1);
    await page.getByLabel('2023',{exact:true}).check();
    await page.waitForFunction(()=>document.querySelector('.map-bottom-sheet .badge')?.textContent==='2 en mapa');
    await screenshot(page,'filtros-anos-390');
    await page.getByLabel('Todos los años',{exact:true}).check();
    const filter = page.getByLabel('Filtrar por tipo', { exact: true });
    await filter.selectOption('robo');
    await page.waitForFunction(() => [...document.querySelectorAll('.incident-marker[data-incident-id]')].filter(element => element.checkVisibility()).length === 1);
    assert.match(await visibleMarkers(page).first().getAttribute('aria-label'), /^Robo:/);
    const eventToggle = page.getByLabel('Incidentes', { exact: true });
    await eventToggle.uncheck();
    assert.equal(await visibleMarkers(page).count(), 0);
    await eventToggle.check();
    await filter.selectOption('');
    await page.waitForFunction(() => [...document.querySelectorAll('.incident-marker[data-incident-id]')].filter(element => element.checkVisibility()).length === 3);
    const marker = page.locator('[data-incident-id="501"]');
    const appearance = await marker.evaluate(element => {
      const style = getComputedStyle(element), inner = element.querySelector('.marker-inner');
      return { background: style.backgroundColor, shadow: style.boxShadow, animation: style.animationName, innerAnimation: inner ? getComputedStyle(inner).animationName : 'none', pillVisible: !!element.querySelector('.marker-risk-pill')?.checkVisibility() };
    });
    assert.equal(appearance.background, 'rgba(0, 0, 0, 0)');
    assert.equal(appearance.animation, 'none'); assert.equal(appearance.innerAnimation, 'none');
    assert.equal(appearance.pillVisible, false);
    await page.locator('.map-layer-panel > summary').click();
    await setSheetExpanded(page, false);
    const beforeHover = await marker.boundingBox();
    await marker.hover();
    await page.waitForTimeout(100);
    const afterHover = await marker.boundingBox();
    assert.ok(Math.abs(beforeHover.width - afterHover.width) < .5 && Math.abs(beforeHover.height - afterHover.height) < .5, 'El icono no cambia de tamaño ni rebota al señalarlo');
    await marker.click();
    const detail = page.getByRole('dialog', { name: 'Detalle del incidente', exact: true });
    await detail.waitFor();
    await detail.getByText('Bache frente al acceso peatonal de la avenida de prueba.', { exact: true }).waitFor();
    await screenshot(page, 'incident-card-390-dark');
    await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await detail.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Restablecer orientación al norte', exact: true }).click();
    assert.ok(await page.evaluate(() => window.auditMap.camera.some(call => call.kind === 'north' || call.bearing === 0)));
    await page.getByRole('button', { name: 'Ubicar mi posición', exact: true }).click();
    await page.waitForFunction(() => window.auditMap.camera.some(call => ['fly', 'ease'].includes(call.kind) && call.center?.[0] === window.auditFix.longitud));

    await page.locator('.map-layer-panel > summary').click();
    const traffic = page.getByLabel('Tráfico · TomTom', { exact: true });
    if (await traffic.isChecked()) await traffic.uncheck();
    await page.evaluate(() => { window.auditHoldTrafficTiles = true; });
    await traffic.check();
    await page.waitForFunction(() => !!window.auditMap.layers['tomtom-flow-layer'] && window.auditMap.layers['tomtom-flow-layer'].layout.visibility !== 'none');
    const tiles = await page.evaluate(() => window.auditMap.sources['tomtom-flow'].tiles);
    assert.ok(tiles?.length && tiles.every(tile => tile.startsWith(fixtureOrigin + '/api/navigation/traffic/')));
    assert.ok(tiles.every(tile => !/key=|token=/.test(tile)), 'La capa usa proxy local sin claves del proveedor');
    await page.waitForFunction(() => window.auditCalls.some(call => call.path.startsWith('/navigation/traffic/incidents')));
    await page.evaluate(() => window.auditMap.fire('sourcedata', { sourceId: 'tomtom-flow', sourceDataType: 'metadata', isSourceLoaded: true }));
    await page.waitForTimeout(50);
    assert.ok((await page.locator('.map-layer-panel .map-traffic-legend').innerText()).includes('Cargando capa'), 'Los metadatos no se presentan como mosaicos recibidos');
    await page.evaluate(() => { window.auditHoldTrafficTiles = false; window.auditMap.fire('sourcedata', { sourceId: 'tomtom-flow', sourceDataType: 'content', tile: {}, isSourceLoaded: true }); });
    await page.locator('.map-layer-panel .map-traffic-legend').getByText(/Última recepción/).waitFor();
    await traffic.uncheck();
    assert.equal(await page.evaluate(() => window.auditMap.layers['tomtom-flow-layer']?.layout.visibility), 'none');
    const trafficCallsWhenOff = await page.evaluate(() => window.auditCalls.filter(call => call.path.startsWith('/navigation/traffic/incidents')).length);
    await page.waitForTimeout(75);
    assert.equal(await page.locator('.external-traffic-marker').count(), 0, 'Apagar tráfico elimina sus marcadores');
    assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path.startsWith('/navigation/traffic/incidents')).length), trafficCallsWhenOff, 'Apagar tráfico detiene consultas externas');
    await traffic.check();
    await page.locator('.map-layer-panel > summary').click();
    const trafficMarker = page.getByRole('button', { name: 'Cierre vial de prueba · TomTom', exact: true });
    await trafficMarker.click();
    const externalDetail = page.getByRole('region', { name: 'Aviso temporal de tráfico', exact: true });
    await externalDetail.waitFor();
    assert.ok((await externalDetail.innerText()).includes('<img src=x onerror='), 'El texto del proveedor no se interpreta como HTML');
    assert.equal(await externalDetail.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.auditInjected), undefined);
    await expectReachable(externalDetail.getByRole('button', { name: 'Cerrar aviso de tráfico', exact: true }), 'Cerrar aviso de tráfico con hoja compacta');
    await screenshot(page, 'traffic-popup-390-dark');
    await setSheetExpanded(page, true);
    await expectReachable(externalDetail.getByRole('button', { name: 'Cerrar aviso de tráfico', exact: true }), 'Cerrar aviso de tráfico con hoja expandida');
    const popupBounds = await externalDetail.boundingBox();
    const expandedSheetBounds = await page.locator('.map-bottom-sheet').boundingBox();
    assert.ok(popupBounds.y + popupBounds.height <= expandedSheetBounds.y + 1, 'La tarjeta de tráfico queda encima de la hoja expandida');
    await screenshot(page, 'traffic-popup-expanded-390-dark');
    await externalDetail.getByRole('button', { name: 'Cerrar aviso de tráfico', exact: true }).click();
    await setSheetExpanded(page, true);

    await searchDestination(page);
    await page.locator('.route-result').nth(2).waitFor();
    assert.equal(await page.locator('.route-result').count(), 3);
    for (const title of ['Más segura', 'Más rápida', 'Equilibrada']) assert.ok(await page.locator('.route-result').getByText(title, { exact: true }).count());
    assert.equal(await page.evaluate(() => window.auditSpeech.length), 0, 'Planificar o seleccionar no activa la voz');
    await page.locator('.route-result').filter({ hasText: 'Equilibrada' }).locator('.route-select').click();
    await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).waitFor();
    await screenshot(page, 'route-cards-390-dark');
    await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).click();
    const guidance = page.getByRole('region', { name: 'Indicaciones del recorrido', exact: true });
    await guidance.waitFor();
    await expectFullscreenNavigation(page, { width: 390, height: 844 });
    await page.getByRole('button', { name: 'Centrar ubicación y seguir recorrido', exact: true }).click();
    assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path === '/navigation/history').length), 1, 'Una sola escritura al comenzar navegación');
    await page.waitForFunction(() => window.auditSpeech.length > 0);
    assert.match(await page.evaluate(() => window.auditSpeech.at(-1)), /avenida de prueba|izquierda/);
    await screenshot(page, 'navigation-390-dark');
    await page.getByRole('button', { name: 'Abrir asistente de ayuda CiviGo', exact: true }).click();
    await page.getByRole('dialog', { name: 'Asistente CiviGo', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Asistente CiviGo', exact: true }).waitFor({ state: 'detached' });
    await setSheetExpanded(page, true);
    assert.equal(await guidance.locator('.gn-maneuver').getAttribute('data-direction'), 'left', 'La flecha coincide con el siguiente giro');
    await guidance.getByRole('button', { name: 'Finalizar', exact: true }).waitFor();
    await page.getByRole('radio', { name: 'Auto', exact: true }).click();
    await page.locator('.user-gps-marker[data-navigation-avatar="car"]').waitFor();
    await page.waitForFunction(() => Object.keys(localStorage).some(key => key.endsWith('civigo:navigation-avatar:v1:user:901') && localStorage.getItem(key) === 'car'));
    await page.getByRole('radio', { name: 'SUV', exact: true }).click();
    await page.getByRole('button', { name: 'Rojo', exact: true }).click();
    await page.locator('.user-gps-marker[data-navigation-avatar="suv:red"]').waitFor();
    await page.waitForFunction(() => Object.keys(localStorage).some(key => key.endsWith('civigo:navigation-avatar:v1:user:901') && localStorage.getItem(key) === 'suv:red'));
    await page.evaluate(() => { window.auditMap.bearing = 30; window.auditMap.fire('rotate'); });
    const gpsRotation = await page.locator('.navigation-avatar-heading').evaluate(element => element.style.transform);
    assert.equal(gpsRotation, 'rotate(145deg)', 'El avatar usa rumbo GPS175° relativo a cámara30°');
    await page.getByRole('button', { name: 'Cambiar capas', exact: true }).click();
    const layerDrawer = page.getByRole('dialog', { name: 'Capas del mapa', exact: true });
    await layerDrawer.waitFor();
    await page.evaluate(() => { window.auditThemeMap=window.auditMap; window.auditThemeSource=window.auditMap.sources['route-source']; window.auditThemeRisk=JSON.stringify(window.auditMap.layers['civigo-roads-layer'].paint); });
    assert.equal(await layerDrawer.getByLabel('Aspecto del mapa', {exact:true}).count(),0); await page.evaluate(() => window.auditSetTheme('light'));
    await page.waitForFunction(() => window.auditMap.layers['route-line'].paint['line-color'] === '#1554d8');
    assert.equal(await page.evaluate(() => window.auditMap.layers['fixture-road'].paint['line-color']), '#a9d5c6');
    await page.evaluate(() => window.auditSetTheme('dark')); assert.equal(await page.evaluate(() => window.auditMap.layers['fixture-road'].paint['line-color']), '#a9d5c6');
    await page.waitForFunction(() => window.auditMap.layers['route-line'].paint['line-color'] === '#1554d8');
    assert.equal(await page.evaluate(() => window.auditMap===window.auditThemeMap && window.auditMap.sources['route-source']===window.auditThemeSource && JSON.stringify(window.auditMap.layers['civigo-roads-layer'].paint)===window.auditThemeRisk), true, 'Cambiar tema conserva instancia, fuente de ruta y semántica de riesgo');
    await page.locator('.user-gps-marker[data-navigation-avatar="suv:red"]').waitFor();
    await layerDrawer.getByLabel('Riesgo por tramo', { exact: true }).check();
    assert.equal(await page.evaluate(() => window.auditMap.layers['tomtom-flow-layer']?.layout.visibility), 'none');
    await layerDrawer.getByLabel('Tráfico · TomTom', { exact: true }).check();
    await page.waitForFunction(() => window.auditMap.layers['tomtom-flow-layer']?.layout.visibility !== 'none');
    await screenshot(page, 'navigation-layers-390-dark');
    await page.keyboard.press('Escape');
    await layerDrawer.waitFor({ state: 'detached' });
    await setSheetExpanded(page, true);
    await page.getByRole('button', { name: 'Agregar aviso', exact: true }).click();
    await page.getByRole('heading', { name: 'Reportar un incidente', exact: true }).waitFor();
    assert.equal(await page.locator('.app-navigation-fullscreen').count(), 0, 'El formulario recupera la navegación general de la aplicación');
    await page.getByRole('button', { name: 'Explorar Mapa', exact: true }).click();
    await expectFullscreenNavigation(page, { width: 390, height: 844 });
    await page.locator('.user-gps-marker[data-navigation-avatar="suv:red"]').waitFor();
    assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path === '/navigation/history').length), 1, 'Volver del aviso conserva el viaje sin duplicar historial');
    assert.equal(await guidance.locator('.gn-turn-row').count(), 0, 'Regresa al mapa con el resumen compacto');
    await screenshot(page, 'navigation-after-report-390-dark');
    await setSheetExpanded(page, true);
    const firstSpeech = await page.evaluate(() => window.auditSpeech.length);
    await page.evaluate(() => window.auditSetFix({ ...window.auditFix, latitud: -14.068 }));
    await page.waitForTimeout(75);
    assert.equal(await page.evaluate(() => window.auditSpeech.length), firstSpeech, 'No repite voz en el mismo tramo por cada muestra GPS');
    await guidance.getByRole('button', { name: 'Silenciar voz', exact: true }).click();
    assert.ok(await page.evaluate(() => window.auditSpeechStops > 0));
    await page.evaluate(() => window.auditSetFix(null));
    await guidance.getByText(/GPS sin señal reciente/).waitFor();
    assert.equal(await guidance.getByRole('button', { name: 'Centrar', exact: true }).isDisabled(), true);
    assert.equal(await guidance.getByRole('button', { name: 'Recalcular', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.auditMap.sources['route-source'].data.type), 'Feature', 'Perder GPS conserva el último trazado');
    await page.evaluate(() => window.auditSetFix({ latitud: -14.068, longitud: -75.7286, accuracy: 5, heading: 180 }));
    await page.waitForFunction(() => ![...document.querySelectorAll('.navigation-guidance button')].find(button => button.textContent.includes('Recalcular'))?.disabled);
    const plansBefore = await page.evaluate(() => window.auditCalls.filter(call => call.path === '/navigation/plan').length);
    await guidance.getByRole('button', { name: 'Recalcular', exact: true }).click();
    await page.waitForFunction(count => window.auditCalls.filter(call => call.path === '/navigation/plan').length > count, plansBefore);
    assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path === '/navigation/history').length), 1, 'Recalcular no duplica el historial');
    // Walk the real fixture geometry with consistent GPS timestamps. A one-frame
    // teleport to the destination must now be rejected by the jump guard.
    await page.clock.install({ time: Date.now() });
    for (const [from, to] of [[[-75.7286, -14.068], [-75.7286, -14.0718]], [[-75.7286, -14.0718], [-75.731, -14.0758]]]) {
      for (let part = 1; part <= 5; part++) {
        await page.clock.fastForward(15000);
        await page.evaluate(({ from, to, part }) => window.auditSetFix({ latitud: from[1] + (to[1] - from[1]) * part / 5, longitud: from[0] + (to[0] - from[0]) * part / 5, accuracy: 5, heading: 200 }), { from, to, part });
      }
    }
    await guidance.getByText('DESTINO ALCANZADO', { exact: true }).waitFor();
    await screenshot(page, 'navigation-arrived-390-dark');
    await guidance.getByRole('button', { name: 'Finalizar', exact: true }).click();
    await guidance.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.app-navigation-fullscreen').count(), 0);
    await page.locator('.mobile-header').waitFor({ state: 'visible' });
    await page.locator('.bottom-nav').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.auditMap.sources['route-source'].data.features?.length), 0, 'Finalizar retira el trazado activo');
    assert.equal(await page.evaluate(() => window.auditInjected), undefined);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => !!window.auditMap?.getSource('civigo-incidents')?.data?.features?.length);
    await page.getByRole('button', { name: 'Plaza de Armas de Ica', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).click();
    await expectFullscreenNavigation(page, { width: 390, height: 844 });
    await page.locator('.user-gps-marker[data-navigation-avatar="suv:red"]').waitFor();
    await screenshot(page, 'navigation-persisted-avatar-390-dark');
    await page.waitForFunction(() => Object.keys(localStorage).some(key => key.endsWith('civigo:active-trip:v1:user:901')));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
    await expectFullscreenNavigation(page, { width: 390, height: 844 });
    await page.locator('.user-gps-marker[data-navigation-avatar="suv:red"]').waitFor();
    assert.equal(await page.evaluate(() => window.auditCalls.filter(call => call.path === '/navigation/history').length), 0, 'Recrear la aplicación recupera el recorrido sin duplicar el historial');
    await screenshot(page, 'navigation-restored-trip-390-dark');
    await page.getByRole('button', { name: 'Salir de navegación', exact: true }).click();
    assert.equal(await page.locator('.app-navigation-fullscreen').count(), 0, 'Salir compacto restaura la interfaz general');
    await page.locator('.mobile-header').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.auditMap.sources['route-source'].data.features?.length), 0);
    await page.getByRole('button', { name: 'Plaza de Armas de Ica', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).click();
    await expectFullscreenNavigation(page, { width: 390, height: 844 });
    await page.evaluate(() => { window.auditFirstUser={...window.auditUser}; window.auditSetUser(null); });
    await page.locator('.app-navigation-fullscreen').waitFor({ state: 'detached' });
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.endsWith('civigo:active-trip:v1:user:901')));
    await page.evaluate(() => window.auditSetUser({...window.auditFirstUser,id:902,nickname:'Otra cuenta',correo:'otra@example.invalid'}));
    await page.getByRole('button', { name: 'Buscar destino en Ica', exact: true }).click();
    const privateSearch = page.getByRole('dialog', { name: 'Buscar destino', exact: true });
    assert.equal(await privateSearch.locator('.place-personal-list').count(), 0, 'Los lugares recientes del usuario anterior no aparecen en otra cuenta');
    assert.equal(await page.locator('.app-navigation-fullscreen').count(), 0, 'La otra cuenta no recibe el recorrido anterior');
    await privateSearch.getByRole('searchbox', { name: 'Buscar lugares en Ica', exact: true }).fill('Plaza de Armas');
    await privateSearch.getByRole('region', { name: 'Resultados de lugares', exact: true }).getByRole('button', { name: /Plaza de Armas de Ica/ }).first().click();
    await page.getByRole('dialog', { name: 'Información del lugar', exact: true }).getByRole('button', { name: 'Ver ubicación', exact: true }).click();
    await page.locator('.map-focused-location').waitFor();
    assert.equal(await page.evaluate(() => window.auditMap.camera.some(call => call.kind==='fly'&&call.center?.[0]===-75.731&&call.center?.[1]===-14.0758)),true,'Ver ubicación enfoca el lugar real dentro del mapa de CiviGo');
    results.push({ checks: ['zoom-14-threshold','complete-provincial-data','background-free-static-icons','type-and-event-filters','risk-traffic-legends-inside-panel','filters-and-legends-hit-tested-above-sheet','authenticated-incident-dialog','north-and-location-camera','traffic-proxy-visibility','no-off-traffic-requests-and-markers','metadata-is-not-tile-receipt','escaped-traffic-popup','traffic-popup-above-expanded-sheet','three-route-cards','selected-route-start','one-history-write','guidance-recenter','matching-left-maneuver','voice-starts-after-navigation-gesture','voice-no-GPS-repeat','voice-stop','GPS-loss-retains-route-and-disables-controls','manual-reroute-without-history-duplicate','arrival-guidance','navigation-stop','full-app-viewport','edge-to-edge-planner','compact-only-essential-controls','expanded-navigation-menu','assistant-in-navigation','live-layer-drawer','navigation-avatar-selection-and-heading','navigation-report-return','navigation-avatar-cold-load','compact-exit-restores-shell','destination-explorer-real-fields','vehicle-model-and-color','theme-preserves-live-route-and-markers','trip-recreation-without-history-duplicate','logout-trip-and-place-privacy','place-focuses-inside-civigo-map'], appearance });
  } catch (error) {
    await screenshot(page, 'failure-functional-390-dark');
    throw error;
  } finally { await context.close(); }
  for (const viewport of [{width:390,height:844},{width:640,height:360}]) {
    const {context,page}=await openFixture(viewport,true,{'civigo:spotify_nav_enabled':'true'});
    try {
      await searchDestination(page);
      await page.getByRole('button',{name:'Iniciar recorrido',exact:true}).click();
      await expectFullscreenNavigation(page,viewport);
      assert.equal(await page.evaluate(()=>window.auditSpotifyCalls.filter(call=>call.method==='connect').length),0,'Una preferencia activada no autoriza una conexión automática');
      await page.getByRole('button',{name:'Conectar Spotify',exact:true}).click();
      const player=page.getByRole('complementary',{name:'Reproducción de Spotify',exact:true});
      await player.waitFor();
      await player.getByText('Fixture SDK',{exact:true}).waitFor();
      const compactLayout=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height};};
        return{sheet:rect('.map-bottom-sheet'),turn:rect('.gn-compact-maneuver'),player:rect('.spotify-remote-player'),summary:rect('.gn-compact-summary')};
      });
      assert.ok(compactLayout.player.bottom<=compactLayout.sheet.bottom+.5 && compactLayout.turn.top>=compactLayout.sheet.top,`Spotify compacto y giro deben estar visibles juntos: ${JSON.stringify(compactLayout)}`);
      await screenshot(page,`spotify-connected-${viewport.width}-dark`);
      for(let cycle=0;cycle<3;cycle++){await setSheetExpanded(page,true);await setSheetExpanded(page,false);}
      assert.equal(await page.evaluate(()=>window.auditSpotifyCalls.filter(call=>call.method==='connect').length),1,'Expandir y contraer conserva la conexión autorizada');
      assert.equal(await page.evaluate(()=>window.auditSpotifyListenerCount()),1,'Existe una sola suscripción del SDK');
      await player.getByRole('button',{name:'Pausar Spotify',exact:true}).click();
      assert.equal(await player.getByRole('button',{name:'Pausar Spotify',exact:true}).count(),1,'Un comando exitoso no simula un cambio de reproducción');
      await page.evaluate(()=>window.auditSpotifyPublish({...window.auditSpotifyPlayback,paused:true,updatedAt:Date.now()}));
      await player.getByRole('button',{name:'Reproducir en Spotify',exact:true}).waitFor();
      await player.getByRole('button',{name:'Siguiente pista en Spotify',exact:true}).click();
      assert.equal(await player.getByText('Fixture SDK',{exact:true}).count(),1,'Siguiente no inventa una nueva canción');
      await setSheetExpanded(page,true);
      await page.getByRole('button',{name:'Agregar aviso',exact:true}).click();
      await page.getByRole('button',{name:'Mi Perfil',exact:true}).click();
      await page.locator('label').filter({hasText:'Spotify durante la navegación'}).locator('input[type=checkbox]').uncheck();
      await page.waitForFunction(()=>window.auditSpotifyListenerCount()===0&&window.auditSpotifyCalls.some(call=>call.method==='setEnabled'&&call.body.enabled===false));
      await page.getByRole('button',{name:'Explorar Mapa',exact:true}).click();
      assert.equal(await page.locator('.spotify-remote-player,.spotify-remote-notice').count(),0,'Al desactivar Spotify desaparecen controles y conexión');
      results.push({viewport,spotifySDKFixture:true,compactLayout,checks:['spotify-user-gesture','spotify-single-connection-across-panel','spotify-observed-only-playback','spotify-opt-out-cleans-resources','spotify-map-space-preserved']});
    }catch(error){await screenshot(page,`failure-spotify-${viewport.width}`);throw error;}finally{await context.close();}
  }
  assert.deepEqual(errors, [], 'No deben aparecer excepciones React/JavaScript');
  assert.deepEqual(blocked, [], 'El mapa simulado no debe intentar contactar servicios externos');
  const report = { passed: true, checkedAt: new Date().toISOString(), viewportCases: 10, externalRequestsAllowed: 0, speechEngine: 'mocked; Android engine requires native validation', mapRenderer: 'stub canvas; no claim about real provider tiles', spotifySDK: 'native driver fixture; no real Spotify account or playback', results };
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  await rm(path.join(artifacts, 'failure.json'), { force: true });
  console.log(JSON.stringify({ passed: true, viewportCases: report.viewportCases, functionalChecks: results.flatMap(result=>result.checks??[]).length, pageErrors: errors.length, blockedExternalRequests: blocked.length, artifacts }));
} catch (error) {
  await writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ passed: false, message: error.message, stack: error.stack, errors, blocked, results }, null, 2));
  throw error;
} finally { await browser.close(); }
