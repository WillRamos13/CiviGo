import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

// Actual React screens, with all transport/providers substituted and every
// browser network request blocked. No account or external service is used.
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MyReportsPage} from './src/pages/MyReportsPage';
import {ReportPage} from './src/pages/ReportPage';
import './src/index.css';
window.mediaLoads=[];window.mediaDisposed=[];window.auditCalls=[];
window.auditUser={id:1,correoVerificado:true,bloqueado:false,rol:'USUARIO'};
window.auditRows=Array.from({length:30},(_,i)=>({id:i+1,tipo:'bache',descripcion:'Caso aislado',estado:i===1?'FALSO':'EN_REVISION',
 adjuntos:[{id:'f'+i,url:'/api/uploads/f'+i,mimeType:i===0?'video/mp4':'image/png',privado:false}],
 apelaciones:i===1?[{id:1,motivo:'Revisión anterior',estado:'RECHAZADA',creadoEn:'2026-10-15'}]:[]}));
window.auditApi=async path=>path==='/catalog'?{categorias:[],config:{}}:structuredClone(window.auditRows);
window.auditUpload=async(file,privado,tipo)=>{window.auditCalls.push({kind:'upload',name:file.name,privado,tipo});return{id:'new-proof',nombre:file.name,url:'/api/uploads/new-proof',mimeType:file.type,privado,tipo};};
window.auditPost=async(path,body)=>{window.auditCalls.push({kind:'post',path,body});const row=window.auditRows.find(r=>r.id===Number(path.split('/')[2]));
 if(path.endsWith('/appeal')){row.apelaciones.push({id:2,motivo:body.motivo,estado:'PENDIENTE'});return{};}
 if(path.endsWith('/evidence')){row.adjuntos.push({id:'new-proof',nombre:'proof.pdf',url:'/api/uploads/new-proof',mimeType:'application/pdf',privado:true,tipo:'EVIDENCIA'});return structuredClone(row);}
 return{};};
function Test(){const[view,setView]=useState('reports');window.auditOpenReport=()=>setView('report');return <div className="app-container"><main className="app-main">{view==='reports'?<MyReportsPage onGoLogin={()=>{}} onGoRegister={()=>{}} onGoReport={()=>{}}/>:<ReportPage onGoLogin={()=>{}} onGoRegister={()=>{}} onGoVerify={()=>{}} onGoMyReports={()=>{}} onGoMap={()=>{}}/>}</main></div>;}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
  outdir: '.local/media-followup-ui-smoke-bundle',
  format: 'iife', platform: 'browser', target: 'es2020', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolated-media-followup-adapters', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const file = args.path.replaceAll('\\', '/');
      if (file.endsWith('hooks/useAuth')) return { path: 'auth-hook', namespace: 'audit' };
      if (file.endsWith('services/auth') || (file === './auth' && args.importer.replaceAll('\\', '/').includes('/services/'))) return { path: 'auth', namespace: 'audit' };
      if (file.endsWith('services/api') || (file === './api' && args.importer.replaceAll('\\', '/').includes('/services/'))) return { path: 'api', namespace: 'audit' };
      if (file.endsWith('services/native')) return { path: 'native', namespace: 'audit' };
      if (file.endsWith('services/authenticatedMedia')) return { path: 'media', namespace: 'audit' };
      if (file.endsWith('map/MapView')) return { path: 'map', namespace: 'audit' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'audit' }, args => ({ loader: 'js', contents:
      args.path === 'auth-hook' ? 'export const useAuth=()=>({usuario:window.auditUser,loading:false,offline:false});' :
      args.path === 'auth' ? 'export const canParticipate=user=>user?.correoVerificado===true&&user.bloqueado!==true;' :
      args.path === 'api' ? `export const BASE_API_URL='/api';export const api=async p=>window.auditApi(p);export const post=async(p,b)=>window.auditPost(p,b);export const upload=async(f,p,t)=>window.auditUpload(f,p,t);export const crearReporte=async()=>{};export const formatDate=()=> 'Fecha';export const errorMessage=e=>e.message;export const distance=()=>0;` :
      args.path === 'native' ? `export const isNative=true;export const triggerHaptic=async()=>{};export const getCurrentDevicePosition=async()=>null;export const capturePhotoOrVideo=async()=>null;export const StorageService={get:async()=>null,set:async()=>{},remove:async()=>{}};export const getRecoveredReportPhoto=async()=>null;export const loadRecoveredReportPhoto=async()=>null;export const consumeRecoveredReportPhoto=async()=>{};` :
      args.path === 'map' ? 'export const MapView=()=>null;' :
      `export const createAuthenticatedMediaResource=async request=>{window.mediaLoads.push(request.url);return{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',dispose(){window.mediaDisposed.push(request.url)}}};export const stopMediaPlayback=()=>{};` }));
  } }],
});
const executablePath = process.env.CIVIGO_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', handler => handler.abort());
  await page.setContent('<style>article{min-height:260px}</style><div id="root"></div>');
  await page.addStyleTag({ content: bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n') });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForFunction(() => window.mediaLoads.length > 0);
  const initial = await page.evaluate(() => ({ loads: window.mediaLoads.length, hasVideo: window.mediaLoads.includes('/api/uploads/f0') }));
  assert.ok(initial.loads < 10, 'offscreen evidence must not eagerly load all 30 files');
  assert.equal(initial.hasVideo, false, 'a visible video needs a deliberate click before any download');
  await page.getByRole('button', { name: 'Cargar video', exact: true }).click();
  await page.waitForFunction(() => window.mediaLoads.includes('/api/uploads/f0'));
  await page.evaluate(() => { const main = document.querySelector('.app-main'); main.scrollTo(0, main.scrollHeight); });
  await page.waitForFunction(() => window.mediaDisposed.includes('/api/uploads/f0'));
  await page.evaluate(() => document.querySelector('.app-main').scrollTo(0, 0));

  const first = page.locator('article').first();
  await first.getByRole('button', { name: 'Solicitar revisión del reporte' }).click();
  await page.getByLabel('Motivo de apelación').fill('Solicito una revisión humana del reporte.');
  await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
  await page.waitForFunction(() => window.auditCalls.some(call => call.path === '/reports/1/appeal'));
  await first.getByRole('button', { name: 'Solicitar revisión del reporte' }).waitFor();
  assert.equal(await first.getByRole('button', { name: 'Solicitar revisión del reporte' }).isDisabled(), true);
  assert.equal(await page.locator('article').nth(1).getByRole('button', { name: 'Solicitar revisión del reporte' }).isEnabled(), true, 'a resolved appeal permits another review request');

  await first.getByRole('button', { name: 'Aportar pruebas privadas', exact: true }).click();
  await first.locator('input[type="file"]').setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nfixture') });
  await first.getByRole('button', { name: 'Enviar pruebas privadas', exact: true }).click();
  await page.waitForFunction(() => window.auditCalls.some(call => call.path === '/reports/1/evidence'));
  assert.deepEqual(await page.evaluate(() => window.auditCalls.find(call => call.kind === 'upload')), { kind: 'upload', name: 'proof.pdf', privado: true, tipo: 'EVIDENCIA' });

  await page.evaluate(() => window.auditOpenReport());
  await page.getByText('Adjuntar foto o video', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'El formulario con CSS real no desborda horizontalmente');
  assert.match(await page.locator('input[type="file"]').getAttribute('accept'), /video\/mp4/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['offscreen-media-deferred', 'video-by-click', 'offscreen-media-release', 'review-en-revision', 'pending-appeal-disabled', 'resolved-appeal-enabled', 'private-proof-upload', 'android-video-file-selector'], externalRequestsAllowed: 0 }));
} finally { await browser.close(); }
