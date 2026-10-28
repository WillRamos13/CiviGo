import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const chrome = [process.env.CIVIGO_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()].find(p => p && existsSync(p));

test('GPS real del hook libera el watch al suspender, reanuda una vez y descarta respuestas antiguas', { skip: !chrome, timeout: 15000 }, async () => {
  const output = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useGeolocation} from './src/hooks/useGeolocation';
    window.auditGPS={starts:0,stops:0,callbacks:[],pending:[],active:true};
    function Test(){window.gpsHook=useGeolocation(true);return <span>{window.gpsHook.position?.latitud??'sin GPS'}</span>}
    createRoot(document.getElementById('root')).render(<Test/>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'error',
    plugins: [{ name: 'foreground-gps-driver', setup(builder) {
      builder.onResolve({ filter: /services\/(native|appLifecycle)$/ }, args => ({ path: args.path, namespace: 'driver' }));
      builder.onLoad({ filter: /.*/, namespace: 'driver' }, args => ({ loader: 'tsx', contents:
        args.path.endsWith('appLifecycle') ? `const listeners=new Set();window.setAppActive=value=>{window.auditGPS.active=value;for(const f of listeners)f()};
          export const getAppActivity=()=>window.auditGPS.active; export const subscribeAppActivity=f=>{listeners.add(f);return()=>listeners.delete(f)};` :
          `export const watchDevicePosition=(success,error)=>{const w=window.auditGPS;w.starts++;w.callbacks.push(success);let disposed=false;return()=>{if(!disposed){disposed=true;w.stops++}}};
           export const getCurrentDevicePosition=()=>new Promise(resolve=>window.auditGPS.pending.push(resolve));` }));
    } }], define: { 'import.meta.env': '{}' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', request => request.abort());
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.waitForFunction(() => (window as any).auditGPS.starts === 1);
    await page.evaluate(() => { const w = window as any; w.auditGPS.callbacks[0]({ latitud: -14, longitud:-75.72, timestamp: Date.now(), accuracy: 5 }); });
    await page.waitForFunction(() => (window as any).gpsHook.position?.latitud === -14);
    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 1);
    await page.evaluate(() => (window as any).setAppActive(false));
    await page.waitForFunction(() => !(window as any).gpsHook.loading);
    await page.evaluate(() => { const w = window as any; w.auditGPS.pending[0]({latitud:-12,longitud:-75.72,timestamp:Date.now(),accuracy:5});w.auditGPS.callbacks[0]({latitud:-13,longitud:-75.72,timestamp:Date.now(),accuracy:5}); });
    await page.waitForTimeout(20);
    assert.equal(await page.evaluate(() => (window as any).gpsHook.position.latitud), -14);
    await page.evaluate(() => (window as any).setAppActive(true));
    await page.waitForFunction(() => (window as any).auditGPS.starts === 2);
    await page.evaluate(() => { const w=window as any, callback=w.auditGPS.callbacks[1];
      callback({latitud:-10,longitud:-75.72,timestamp:Infinity}); callback({latitud:-11,longitud:-75.72,timestamp:NaN});
      callback({latitud:-12,longitud:-75.72,timestamp:Date.now()+60000}); callback({latitud:-13,longitud:-75.72,timestamp:Date.now()-60000});
      callback({latitud:-14.0001,longitud:-75.72,timestamp:Date.now()+2,accuracy:5}); });
    await page.waitForFunction(() => (window as any).gpsHook.position.latitud === -14.0001);
    for (let index=0; index<5; index++) {
      await page.evaluate(() => (window as any).setAppActive(false));
      await page.waitForFunction(() => (window as any).auditGPS.starts === (window as any).auditGPS.stops);
      await page.evaluate(() => (window as any).setAppActive(true));
      await page.waitForFunction(() => (window as any).auditGPS.starts === (window as any).auditGPS.stops+1);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('la promesa GPS manual conserva una negativa al suspender y un nuevo intento invalida la anterior', { skip: !chrome, timeout: 20000 }, async () => {
  const output = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { useGeolocation } from './src/hooks/useGeolocation';
    window.auditGPS = { starts: 0, stops: 0, callbacks: [], pending: [], active: true };
    function Test() { window.gpsHook = useGeolocation(true); return <span>{window.gpsHook.error || 'sin error'}</span>; }
    createRoot(document.getElementById('root')).render(<Test />);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'error',
    plugins: [{ name: 'manual-foreground-gps-driver', setup(builder) {
      builder.onResolve({ filter: /services\/(native|appLifecycle)$/ }, args => ({ path: args.path, namespace: 'driver' }));
      builder.onLoad({ filter: /.*/, namespace: 'driver' }, args => ({ loader: 'tsx', contents:
        args.path.endsWith('appLifecycle') ? `const listeners = new Set();
          window.setAppActive = value => { window.auditGPS.active = value; for (const listener of listeners) listener(); };
          export const getAppActivity = () => window.auditGPS.active;
          export const subscribeAppActivity = listener => { listeners.add(listener); return () => listeners.delete(listener); };` :
          `export const watchDevicePosition = (success, error) => {
             const w = window.auditGPS; w.starts++; w.callbacks.push({ success, error }); let closed = false;
             return () => { if (!closed) { closed = true; w.stops++; } };
           };
           export const getCurrentDevicePosition = () => new Promise((resolve, reject) => window.auditGPS.pending.push({ resolve, reject }));` }));
    } }], define: { 'import.meta.env': '{}' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', request => request.abort());
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.waitForFunction(() => (window as any).auditGPS.starts === 1);
    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 1);
    await page.evaluate(() => (window as any).setAppActive(false));
    await page.waitForFunction(() => !(window as any).gpsHook.loading);
    await page.evaluate(() => (window as any).auditGPS.pending[0].reject({ code: 'OS-PLUG-GLOC-0009' }));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => (window as any).gpsHook.error), '', 'el intento cerrado no actualiza la vista');
    await page.evaluate(() => (window as any).setAppActive(true));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => (window as any).auditGPS.starts), 1, 'volver no abre otra solicitud tras la negativa manual');

    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 2);
    await page.evaluate(() => (window as any).auditGPS.pending[1].resolve({ latitud: -14.0001, longitud:-75.72, timestamp: Date.now(), accuracy: 5 }));
    await page.waitForFunction(() => (window as any).auditGPS.starts === 2);
    assert.equal(await page.evaluate(() => (window as any).gpsHook.position.latitud), -14.0001);

    // A new manual attempt must supersede the old dialog even across a full
    // background/foreground cycle and its replacement automatic watcher.
    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 3);
    await page.evaluate(() => (window as any).setAppActive(false));
    await page.waitForFunction(() => !(window as any).gpsHook.loading);
    await page.evaluate(() => (window as any).setAppActive(true));
    await page.waitForFunction(() => (window as any).auditGPS.starts === 3);
    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 4);
    await page.evaluate(() => (window as any).auditGPS.pending[2].reject({ code: 'OS-PLUG-GLOC-0009' }));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => (window as any).gpsHook.error), '');
    assert.equal(await page.evaluate(() => (window as any).gpsHook.loading), true, 'la respuesta vieja no finaliza el nuevo intento');
    await page.evaluate(() => (window as any).auditGPS.pending[3].resolve({ latitud: -14.0002, longitud:-75.72, timestamp: Date.now(), accuracy: 5 }));
    await page.waitForFunction(() => (window as any).auditGPS.starts === 4);
    assert.equal(await page.evaluate(() => (window as any).gpsHook.position.latitud), -14.0002);

    // When resume happens before denial delivery, that late decision must close
    // the replacement watcher too, with the explanation shown only in the live view.
    await page.evaluate(() => { void (window as any).gpsHook.locate(); });
    await page.waitForFunction(() => (window as any).auditGPS.pending.length === 5);
    await page.evaluate(() => (window as any).setAppActive(false));
    await page.waitForFunction(() => !(window as any).gpsHook.loading);
    await page.evaluate(() => (window as any).setAppActive(true));
    await page.waitForFunction(() => (window as any).auditGPS.starts === 5);
    await page.evaluate(() => (window as any).auditGPS.pending[4].reject({ code: 'OS-PLUG-GLOC-0003' }));
    await page.waitForFunction(() => (window as any).auditGPS.starts === (window as any).auditGPS.stops);
    assert.match(await page.evaluate(() => (window as any).gpsHook.error), /GPS denegado/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
