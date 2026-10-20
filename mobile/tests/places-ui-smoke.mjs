import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Real components + NavigationService transport. HTTP results are explicit local
// fixtures. No provider, account, location service or external map is contacted.
const root = process.cwd(), origin = 'https://places.civigo.invalid';
const artifacts = path.join(root, '.local', 'places-ui-smoke');
await mkdir(artifacts, { recursive: true });
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{DestinationExplorer}from'./src/components/navigation/DestinationExplorer';
import{NearbyIncidentCards}from'./src/components/incident/NearbyIncidentCards';
import'./src/index.css';
const route={id:'active-original',modo:'driving',destinoNombre:'Destino original',destino:{latitud:-14.0578,longitud:-75.7286},geometria:{type:'LineString',coordinates:[[-75.7286,-14.0678],[-75.7286,-14.0578]]}};
window.choices=[];window.stops=[];window.shown=[];window.auditStore={};
function Fixture(){const[open,setOpen]=useState(true),[owner,setOwner]=useState(7),[navigation,setNavigation]=useState(false);
window.auditOpen=setOpen;window.auditOwner=setOwner;window.auditNavigation=setNavigation;
return <><button onClick={()=>setOpen(true)}>Abrir búsqueda de prueba</button><p id='original-trip'>Destino original intacto</p>
<NearbyIncidentCards incidents={[{id:1,tipo:'Robo',tipoSlug:'robo',descripcion:'Descripción real del fixture',latitud:-14.0678,longitud:-75.7286,estado:'ACTIVO',nivelRiesgo:null,totalReportes:1,fechaEvento:'2026-10-20T12:00:00Z',distrito:'Ica'}]} updatedAt={new Date()} position={{latitud:-14.0678,longitud:-75.7286,accuracy:5,timestamp:Date.now()}} onSelect={value=>window.shown.push(value)} />
<DestinationExplorer open={open} onClose={()=>setOpen(false)} ownerId={owner} navigationActive={navigation} activeRoute={navigation?route:null}
currentPosition={{latitud:-14.0678,longitud:-75.7286,accuracy:5,timestamp:Date.now()}} onChooseDestination={place=>window.choices.push(place)} onShowPlace={place=>window.shown.push(place)}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  outfile: path.join(artifacts, 'fixture.js'), format: 'iife', target: 'es2020', platform: 'browser',
  define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_API_URL: origin + '/api' }) },
  plugins: [{ name: 'local-preferences', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/preferences$/ }, () => ({ path: 'preferences', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const Preferences={get:async({key})=>({value:window.auditStore[key]??null}),set:async({key,value})=>{window.auditStore[key]=value;}};` }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const executablePath = process.env.CIVIGO_CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], screenshots = [], holds = new Map();
const plaza = { nombre: 'Plaza de Armas de Ica', descripcion: 'Ica, Perú', fuente: 'TomTom', latitud: -14.0678, longitud: -75.7286 };
const restaurant = { nombre: 'Restaurante local fixture', descripcion: 'Dirección real suministrada por fixture', fuente: 'TomTom', latitud: -14.063, longitud: -75.7288 };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(6000);
  const errors = [], queries = [], blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async handler => {
    const url = new URL(handler.request().url());
    if (url.href === origin + '/') return handler.fulfill({ contentType: 'text/html', body: '<html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.origin === origin && url.pathname === '/api/navigation/places') {
      const q = url.searchParams.get('q'); queries.push(q);
      if (q === 'lento') await new Promise(resolve => holds.set(q, resolve));
      if (q === 'error') return handler.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'PLACES_SEARCH_UNAVAILABLE' }) });
      const data = q === 'nada' ? [] : q === 'restaurantes' ? [restaurant, { ...restaurant, nombre: 'Lejano fixture', longitud: -75.76 }] : [plaza];
      try { return await handler.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }); } catch { return; }
    }
    blocked.push(url.href); return handler.abort();
  });
  await page.goto(origin + '/');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
  const search = page.getByRole('searchbox', { name: 'Buscar lugares en Ica' });
  await search.waitFor(); await search.focus();
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await search.fill('Plaza');
  await page.getByRole('button', { name: 'Plaza de Armas de Ica Ica, Perú TomTom' }).waitFor();
  await search.fill('  Plaza   ');
  await page.waitForFunction(() => document.querySelector('.place-results li'));
  assert.equal(queries.filter(q => q === 'Plaza').length, 1);
  checks.push('autofocus y normalización sin consulta duplicada');
  await page.getByRole('button', { name: 'Plaza de Armas de Ica Ica, Perú TomTom' }).click();
  await page.getByRole('dialog', { name: 'Información del lugar' }).waitFor();
  assert.equal(await page.getByText('Distancia en línea recta', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.choices.length), 0, 'leer una ficha no cambia el destino');
  assert.equal(await page.locator('img').filter({ hasText: /Plaza/ }).count(), 0);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: 'Guardado', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Casa', exact: true }).click();
  await page.waitForFunction(() => Object.values(window.auditStore).some(value => JSON.parse(value).saved?.some(entry => entry.label === 'home')));
  await page.screenshot({ path: path.join(artifacts, 'ficha-390-light.png') }); screenshots.push('ficha-390-light.png');
  await page.getByRole('button', { name: 'Volver a resultados' }).click();
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await page.getByRole('heading', { name: /^Recientes/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Casa Plaza de Armas/ }).count(), 1);
  checks.push('ficha real, historial y Casa/guardados por cuenta');
  await page.evaluate(() => window.auditOwner(8));
  await page.getByRole('searchbox', { name: 'Buscar lugares en Ica' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: /^Recientes/ }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Guardados', exact: true }).count(), 0);
  await page.evaluate(() => window.auditOwner(7));
  await page.getByRole('heading', { name: 'Guardados', exact: true }).waitFor();
  checks.push('cambiar de cuenta no filtra historial anterior');
  await search.fill('lento');
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('Buscando'));
  await new Promise(resolve => { const until = Date.now() + 3000; const check = () => holds.has('lento') || Date.now() > until ? resolve() : setTimeout(check, 20); check(); });
  await search.fill('nada');
  await page.getByText(/No hay resultados disponibles/).waitFor();
  holds.get('lento')?.(); holds.delete('lento');
  assert.equal(await page.locator('.place-results li').count(), 0);
  await search.fill('error');
  await page.getByRole('alert').waitFor();
  checks.push('cancelación de búsqueda lenta, sin resultados y error de proveedor');
  await page.evaluate(() => { window.auditNavigation(true); document.documentElement.dataset.theme = 'dark'; });
  await page.getByRole('button', { name: 'Alimentos', exact: true }).click();
  await page.getByRole('button', { name: /Restaurante local fixture/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Lejano fixture/ }).count(), 0);
  await page.getByRole('button', { name: /Restaurante local fixture/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Ver rutas', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Agregar parada', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.choices.length), 0);
  assert.equal(await page.getByText(/Tu destino y recorrido siguen activos/).count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'en-ruta-390-dark.png') }); screenshots.push('en-ruta-390-dark.png');
  checks.push('resultados próximos a geometría de ruta sin desvíos inventados ni perder destino');
  await page.getByRole('button', { name: 'Cerrar ficha del lugar' }).click();
  await page.locator('#original-trip').waitFor();
  assert.equal(await page.evaluate(() => window.choices.length), 0);
  await page.locator('.nearby-incident-cards > summary').click();
  await page.getByRole('button', { name: 'Ver en mapa Robo #1' }).click();
  assert.equal(await page.evaluate(() => window.shown[0].id), 1);
  checks.push('cerrar consulta conserva recorrido y tarjetas cercanas tienen acción real');
  await page.evaluate(() => { window.auditNavigation(false); window.auditOpen(true); });
  await page.getByRole('button', { name: 'Volver a resultados' }).click();
  await search.fill('Plaza');
  await page.getByRole('button', { name: 'Plaza de Armas de Ica Ica, Perú TomTom' }).click();
  await page.getByRole('button', { name: 'Ver rutas', exact: true }).click();
  assert.equal(await page.evaluate(() => window.choices[0].nombre), plaza.nombre);
  assert.equal(await page.getByRole('dialog').count(), 0);
  checks.push('buscar, consultar ficha y elegir destino en un flujo');
  for (const viewport of [{ width: 360, height: 740 }, { width: 640, height: 360 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => window.auditOpen(true));
    if (await page.getByRole('button', { name: 'Volver a resultados' }).count()) await page.getByRole('button', { name: 'Volver a resultados' }).click();
    await page.getByRole('searchbox', { name: 'Buscar lugares en Ica' }).waitFor();
    const layout = await page.locator('.place-explorer').evaluate(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1 && layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
    await page.screenshot({ path: path.join(artifacts, `busqueda-${viewport.width}.png`) }); screenshots.push(`busqueda-${viewport.width}.png`);
    await page.getByRole('button', { name: 'Cerrar búsqueda', exact: true }).click();
  }
  checks.push('360px, paisaje y tablet sin desbordamiento');
  assert.ok(blocked.length <= 2, `Una imagen y su fallback fallan sólo una vez: ${blocked.length}`);
  assert.equal(await page.locator('.incident-icon-wrapper svg').count(), 1);
  checks.push('imagen ausente y fallback sin bucle de solicitudes');
  assert.deepEqual(errors, []);
  const result = { passed: true, checkedAt: new Date().toISOString(), checks, queryCount: queries.length, externalRequestsAllowed: 0, blockedRequests: blocked.length, nativeKeyboardTested: false, screenshots };
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { for (const resolve of holds.values()) resolve(); await browser.close(); }
