/* eslint-disable @typescript-eslint/no-require-imports */
// Run with desktop/node_modules/electron/dist/electron.exe. All fixtures and
// browser requests stay on loopback; no Mapbox, account, or production API.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');

const fixturePort = Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT || 55709);
const frontendPort = Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710);
const origin = `http://127.0.0.1:${frontendPort}`;
const shellOnly = process.argv.includes('--shell-only');
const local = path.resolve(__dirname, '../.local/map-live-smoke');
require('node:fs').mkdirSync(path.join(local, 'session'), { recursive: true });
app.setPath('userData', local);
app.setPath('sessionData', path.join(local, 'session'));
app.disableHardwareAcceleration();
const windows = [];
const requests = [];
const blockedHosts = new Set();
const errors = [];
const stages = [];
const headerLayouts = [];
let incidents = [];
let revision = 0;
let authenticated = true;

const incident = {
  id: 912, tipo: 'Incendio', tipoNombre: 'Incendio', tipoSlug: 'incendio',
  descripcion: 'Incidente publicado desde el dispositivo A',
  latitud: -14.0678, longitud: -75.7286, estado: 'ACTIVO',
  nivelRiesgo: 2, gravedad: 2, totalReportes: 1, confirmaciones: 0,
  evaluacion: 'IA', publicado: true, emergencia: true, individual: false,
  fechaEvento: '2026-10-07T12:00:00Z', fechaCreacion: '2026-10-07T12:00:00Z',
  adjuntos: [],
};
const crimeFixtures = [
  { ...incident, id: 913, tipo: 'Robo', tipoNombre: 'Robo', tipoSlug: 'robo',
    descripcion: 'Robo reportado como antecedente', gravedad: 4, nivelRiesgo: 4,
    emergencia: false, historico: true, individual: true },
  { ...incident, id: 914, tipo: 'Hurto', tipoNombre: 'Hurto', tipoSlug: 'hurto',
    descripcion: 'Hurto reportado como antecedente', gravedad: 2, nivelRiesgo: 2,
    emergencia: false, historico: true, individual: true },
];
const catalog = {
  categorias: [
    { id: 1, nombre: 'Delitos y seguridad', slug: 'delitos-y-seguridad', tipos: [
      { id: 11, nombre: 'Robo', slug: 'robo', emergencia: false, historico: true, fotoObligatoria: true, individual: true, ubicacionRemota: true },
      { id: 12, nombre: 'Hurto', slug: 'hurto', emergencia: false, historico: true, fotoObligatoria: true, individual: true, ubicacionRemota: true },
    ] },
    { id: 2, nombre: 'Emergencias', slug: 'emergencias', tipos: [
      { id: 21, nombre: 'Incendio', slug: 'incendio', emergencia: true, historico: false, fotoObligatoria: false, individual: false, ubicacionRemota: false },
    ] },
  ], config: {}, distritos: ['Ica'],
};
const server = http.createServer((request, response) => {
  requests.push({ url: request.url, method: request.method, revision });
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/incidents') return response.end(JSON.stringify(incidents));
  if (/^\/api\/incidents\/\d+\/chat$/.test(request.url)) return response.end('[]');
  if (/^\/api\/incidents\/\d+$/.test(request.url)) {
    const id = Number(request.url.split('/').at(-1));
    return response.end(JSON.stringify(incidents.find(item => item.id === id) || incident));
  }
  if (request.url === '/api/navigation/roads') return response.end(JSON.stringify({ type: 'FeatureCollection', features: [] }));
  if (request.url === '/api/announcements') return response.end(JSON.stringify([{id: 1, tipo: 'NOVEDAD', titulo: 'Novedad de prueba', mensaje: 'Conoce tu entorno', enlace: null, negocio: null}, {id: 2, tipo: 'NEGOCIO', titulo: 'Negocio local', mensaje: 'Visita nuestra ficha', enlace: null, negocio: {id: 1, nombre: 'Negocio local de prueba', descripcion: 'Fixture', latitud: -14.06, longitud: -75.72}}]));
  if (request.url === '/api/businesses' || request.url === '/api/navigation/favorites') return response.end('[]');
  if (request.url === '/api/navigation/history') return response.end(request.method === 'GET' ? '[]' : '{}');
  if (request.url.startsWith('/api/navigation/history?')) return response.end('[]');
  if (request.url === '/api/participation') return response.end(JSON.stringify({reportesValidados:0,totalReportes:0,puntosMensuales:0,mes:'2026-10',insignias:[],movimientos:[]}));
  if (request.url === '/api/ranking' || request.url.startsWith('/api/ranking?')) return response.end(JSON.stringify({mes:'2026-10',entries:[],finalized:false}));
  if (request.url === '/api/navigation/traffic/status') return response.end(JSON.stringify({configurado:false,habilitado:false,controlCuotaDisponible:true}));
  if (request.url === '/api/navigation/traffic/incidents') return response.end(JSON.stringify({incidentes:[],trafico:{disponible:false,fuente:null,actualizadoEn:null,motivo:'Sin tráfico actualizado: TomTom no está configurado.'}}));
  if (request.url === '/api/navigation/plan') {
    let raw = ''; request.on('data',chunk => {raw += chunk;});
    request.on('end', () => {
      const body = JSON.parse(raw); requests[requests.length-1].planBody = body;
      const coordinates = [[body.origen.longitud,body.origen.latitud], [body.destino.longitud,body.origen.latitud], [body.destino.longitud,body.destino.latitud]];
      const rutas = ['segura','rapida','equilibrada'].map((tipo,index) => ({id:`fixture-${tipo}-${revision}`, nombre:tipo === 'segura' ? 'Más segura' : tipo === 'rapida' ? 'Más rápida' : 'Equilibrada',tipo,modo:body.modo,origen:body.origen,destino:body.destino, criterios:[tipo],distancia:2100,duracion:600+index*100,puntosRiesgo:index,nivelRiesgo:index,advertencias:[],geometria:{type:'LineString',coordinates},pasos:[{id:'salida',tipo:'salida',maniobra:'salida',instruccion:'Continúa',calle:'Calle uno',distancia:1000,duracion:300,distanciaAcumulada:0,duracionAcumulada:0,indiceInicio:0,indiceFin:1,coordenadas:coordinates[0],geometria:{type:'LineString',coordinates:coordinates.slice(0,2)}},{id:'giro',tipo:'izquierda',maniobra:'izquierda',instruccion:'Gira a la izquierda hacia calle dos',calle:'Calle dos',distancia:1100,duracion:300,distanciaAcumulada:1000,duracionAcumulada:300,indiceInicio:1,indiceFin:2,coordenadas:coordinates[1],geometria:{type:'LineString',coordinates:coordinates.slice(1)}},{id:'llegada',tipo:'llegada',maniobra:'llegada',instruccion:'Llegaste a tu destino',calle:'',distancia:0,duracion:0,distanciaAcumulada:2100,duracionAcumulada:600,indiceInicio:2,indiceFin:2,coordenadas:coordinates[2],geometria:{type:'LineString',coordinates:coordinates.slice(1)}}]}));
      response.end(JSON.stringify({rutas,seleccionadaId:rutas.find(r=>r.tipo===body.criterio)?.id}));
    }); return;
  }
  if (request.url === '/api/catalog') return response.end(JSON.stringify(catalog));
  if (request.url === '/api/users/me') {
    if (!authenticated) { response.statusCode = 401; return response.end(JSON.stringify({error:'Sesión no iniciada.'})); }
    return response.end(JSON.stringify({usuario:{id:901,nickname:'Usuario prueba',correo:'fixture@example.invalid',telefono:'',correoVerificado:true,rol:'USUARIO',premium:false,credibilidad:100,monedas:0}}));
  }
  if (request.url === '/api/users/logout' && request.method === 'POST') { authenticated = false; return response.end(JSON.stringify({cerrada:true})); }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'No existe esta ruta en el fixture local' }));
});

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(window, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await window.webContents.executeJavaScript(expression)) return Date.now() - started;
    await delay(100);
  }
  const text = await window.webContents.executeJavaScript('document.body.innerText');
  throw new Error(`No se alcanzó: ${expression}\n${text.slice(0, 3000)}`);
}
async function both(expression, timeout) {
  return Promise.all(windows.map(window => waitUntil(window, expression, timeout)));
}
async function capture(window, name) {
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await delay(400);
  await fs.writeFile(path.join(local, name), (await window.webContents.capturePage()).toPNG());
}
async function panelState(window, selector, expanded) {
  await waitUntil(window, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const body = button && document.getElementById(button.getAttribute('aria-controls'));
    return button?.getAttribute('aria-expanded') === ${JSON.stringify(String(expanded))}
      && body?.hidden === ${!expanded} && (getComputedStyle(body).display !== 'none') === ${expanded};
  })()`);
}
async function togglePanel(window, selector) {
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function filterByName(window, name) {
  const value = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.map-frame .map-controls select');
    const option = Array.from(select.options).find(item => item.textContent === ${JSON.stringify(name)});
    if (!option) throw new Error('El filtro de mapa no contiene el tipo solicitado');
    select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
    return option.value;
  })()`);
  return value;
}
async function assertViewport(window, expectedWidth) {
  const geometry = await window.webContents.executeJavaScript(`(() => {
    const selectors = ['.map-frame', '.map-controls', '.risk-legend'];
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      rectangles: selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right };
      }) };
  })()`);
  assert.equal(geometry.width, expectedWidth);
  assert.ok(geometry.documentWidth <= geometry.width, 'La página no debe tener desbordamiento horizontal');
  for (const rect of geometry.rectangles) {
    assert.ok(rect.left >= 0 && rect.right <= geometry.width + 1, `Control fuera del ancho de pantalla: ${rect.selector}`);
  }
}
async function menuOpen(window, expanded) {
  await waitUntil(window, `(() => {
    const button = document.querySelector('.mobile-menu');
    const sidebar = document.querySelector('.sidebar');
    return button?.getAttribute('aria-expanded') === ${JSON.stringify(String(expanded))}
      && sidebar?.classList.contains('is-open') === ${expanded};
  })()`);
}
async function openMobileMenu(window) {
  await window.webContents.executeJavaScript(`(() => { const menu = document.querySelector('.mobile-menu'); if (menu.getAttribute('aria-expanded') !== 'true') menu.click(); })()`);
  await menuOpen(window, true);
}
async function assertCommonShell(window, width, signedIn) {
  await waitUntil(window, `!!document.querySelector('.app-header .map-announcements[aria-label="Anuncios y novedades"] .announcement-content')`);
  const shell = await window.webContents.executeJavaScript(`(() => {
    const geometry = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      let clipped = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect(), parentStyle = getComputedStyle(parent);
        if (/(hidden|clip|auto|scroll)/.test(parentStyle.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) clipped = true;
        if (/(hidden|clip|auto|scroll)/.test(parentStyle.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) clipped = true;
      }
      return {label: element.getAttribute('aria-label') || element.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, visible, clipped,
        withinViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1};
    };
    const banner = document.querySelector('.app-header .map-announcements');
    const rect = banner.getBoundingClientRect();
    const account = document.querySelector('.sidebar-account');
    const accountRect = account?.getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar');
    return {
      width: innerWidth, height: innerHeight, route: location.pathname, documentWidth: document.documentElement.scrollWidth,
      brand: geometry(document.querySelector('.app-header .brand')),
      headerControls: Array.from(document.querySelectorAll('.header-actions button, .header-actions a')).map(geometry).filter(rect => rect.visible),
      menu: geometry(document.querySelector('.header-actions .mobile-menu')),
      menuIcon: geometry(document.querySelector('.header-actions .mobile-menu svg')),
      theme: geometry(document.querySelector('.header-actions button[aria-label^="Cambiar a modo "]')),
      bannerVisible: rect.width > 0 && rect.height > 0 && getComputedStyle(banner).display !== 'none' && rect.top >= 0 && rect.bottom <= innerHeight,
      bannerWithinWidth: rect.left >= 0 && rect.right <= innerWidth + 1,
      accounts: document.querySelectorAll('.sidebar-account').length,
      profile: account?.querySelector('a[href="/perfil"]')?.textContent,
      logouts: document.querySelectorAll('button[aria-label="Cerrar sesión"]').length,
      sidebarLogout: !!account?.querySelector('button[aria-label="Cerrar sesión"]'),
      duplicatedHeader: !!document.querySelector('.app-header .profile-link, .app-header button[aria-label="Cerrar sesión"]'),
      accountAfterNavigation: !!account && Array.from(sidebar.children).indexOf(account) > Array.from(sidebar.children).indexOf(sidebar.querySelector('nav')),
      accountBottomGap: accountRect ? sidebar.getBoundingClientRect().bottom - accountRect.bottom : null,
      accountVisible: !!accountRect && accountRect.width > 0 && accountRect.height > 0 && accountRect.left >= 0 && accountRect.right <= innerWidth + 1 && accountRect.bottom <= innerHeight + 1,
      anonymousLoginLinks: !!document.querySelector('a[href="/ingresar"]') && !!document.querySelector('a[href="/registro"]'),
    };
  })()`);
  assert.equal(shell.width, width);
  const layout = {route:shell.route,width:shell.width,height:shell.height,signedIn,brand:shell.brand,controls:shell.headerControls,menu:shell.menu,theme:shell.theme};
  headerLayouts.push(layout);
  assert.equal(shell.brand?.visible, true, 'El logo y nombre de CiviGo deben estar visibles');
  assert.equal(shell.brand?.withinViewport, true, `Logo fuera de pantalla: ${JSON.stringify(layout)}`);
  assert.equal(shell.brand?.clipped, false, 'El logo no debe quedar recortado por el encabezado');
  assert.equal(shell.theme?.visible, true, 'El botón de tema debe estar visible en todos los tamaños');
  assert.ok(shell.menu, 'El encabezado siempre incluye el botón del menú móvil');
  assert.equal(shell.menu.visible, width <= 900, 'El botón del menú debe verse en pantallas móviles y tabletas');
  if (width <= 900) {
    assert.equal(shell.menuIcon?.visible, true, 'El icono de abrir/cerrar menú debe verse dentro del botón');
    assert.equal(shell.menuIcon?.withinViewport, true, 'El icono del menú debe caber en la pantalla');
    assert.equal(shell.menuIcon?.clipped, false, 'El icono del menú no debe estar recortado');
  }
  assert.ok(shell.headerControls.length > 0, 'El encabezado debe conservar sus controles visibles');
  for (const control of shell.headerControls) {
    assert.equal(control.withinViewport, true, `Control del encabezado fuera de pantalla: ${JSON.stringify(control)}`);
    assert.equal(control.clipped, false, `Control del encabezado recortado: ${JSON.stringify(control)}`);
  }
  assert.ok(shell.documentWidth <= width, 'El shell común no debe desbordar horizontalmente');
  assert.equal(shell.bannerVisible, true, 'El banner debe permanecer visible fuera del mapa');
  assert.equal(shell.bannerWithinWidth, true, 'El banner debe caber en el encabezado');
  assert.equal(shell.duplicatedHeader, false, 'La cuenta no se repite en el encabezado');
  if (signedIn) {
    assert.equal(shell.accounts, 1);
    assert.ok(shell.profile.includes('Usuario prueba'));
    assert.equal(shell.logouts, 1);
    assert.equal(shell.sidebarLogout, true);
    assert.equal(shell.accountAfterNavigation, true, 'La cuenta debe ir debajo de los enlaces de navegación');
    assert.equal(shell.accountVisible, true, 'La cuenta debe estar accesible en escritorio y en el menú móvil abierto');
    assert.ok(shell.accountBottomGap >= 0 && shell.accountBottomGap <= 36, 'La cuenta debe quedar abajo en la barra lateral');
  } else {
    assert.equal(shell.logouts, 0);
    assert.equal(shell.sidebarLogout, false);
    assert.equal(shell.anonymousLoginLinks, true);
  }
}
async function bannerBusiness(window, route) {
  await waitUntil(window, `!!document.querySelector('.app-header button[aria-label="Anuncio siguiente"]')`);
  await window.webContents.executeJavaScript(`(() => {
    const content = document.querySelector('.app-header .announcement-content');
    if (!content.textContent.includes('Negocio local')) document.querySelector('.app-header button[aria-label="Anuncio siguiente"]').click();
  })()`);
  await waitUntil(window, `document.querySelector('.app-header button.announcement-content')?.textContent.includes('Negocio local')`);
  await window.webContents.executeJavaScript(`document.querySelector('.app-header button.announcement-content').click()`);
  await waitUntil(window, `document.querySelector('[role="dialog"][aria-label="Ficha del negocio"]')?.textContent.includes('Negocio local de prueba')`);
  const modal = await window.webContents.executeJavaScript(`({route: location.pathname, count: document.querySelectorAll('[role="dialog"][aria-label="Ficha del negocio"]').length})`);
  assert.deepEqual(modal, {route, count:1}, 'La ficha se abre una sola vez sin salir de la página actual');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar ficha"]').click()`);
  await waitUntil(window, `!document.querySelector('[role="dialog"][aria-label="Ficha del negocio"]')`);
}
async function commonShellScenarios() {
  const originalClients = windows.slice(0, 2);
  for (const [index, window] of originalClients.entries()) {
    const mobile = index === 1, width = mobile ? 390 : 1400, viewport = mobile ? 'móvil' : 'escritorio';
    if (mobile) await openMobileMenu(window);
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-account a[href="/perfil"]').click()`);
    await waitUntil(window, `location.pathname === '/perfil' && document.querySelector('main h1')?.textContent === 'Mi perfil' && !!document.querySelector('#nickname')`);
    if (mobile) {
      await menuOpen(window, false);
      await openMobileMenu(window);
    }
    await assertCommonShell(window, width, true);
    await bannerBusiness(window, '/perfil');
    await capture(window, `perfil-shell-${mobile ? 'movil' : 'escritorio'}.png`);
    stages.push({test:`Shell común en /perfil (${viewport}): banner, ficha en la misma página y cuenta única bajo navegación`,passed:true});

    await window.webContents.executeJavaScript(`document.querySelector('.sidebar nav a[href="/ranking"]').click()`);
    await waitUntil(window, `location.pathname === '/ranking' && document.querySelector('main h1')?.textContent === 'Ranking mensual' && document.body.innerText.includes('Todavía no hay puntos registrados en este mes.')`);
    if (mobile) {
      await menuOpen(window, false);
      await openMobileMenu(window);
    }
    await assertCommonShell(window, width, true);
    await bannerBusiness(window, '/ranking');
    await capture(window, `ranking-shell-${mobile ? 'movil' : 'escritorio'}.png`);
    if (mobile) {
      await window.webContents.executeJavaScript(`dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await menuOpen(window, false);
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement === document.querySelector('.mobile-menu')`),true);
      await openMobileMenu(window);
    }
    stages.push({test:`Shell común en /ranking (${viewport}): navegación conserva cuenta/banner y menú móvil cierra/restaura foco`,passed:true});
  }
  // Create these clients while the fixture is still authenticated. Existing
  // desktop/mobile scenarios keep the same viewports and assertions above.
  const compactClients = [];
  for (const [width, height] of [[320,640],[850,700]]) {
    const window = await createClient(windows.length + 1, width, height, {route:'/perfil',mapReady:false});
    compactClients.push({window,width,height});
    await waitUntil(window, `location.pathname === '/perfil' && document.querySelector('main h1')?.textContent === 'Mi perfil' && !!document.querySelector('#nickname')`);
    await menuOpen(window, false);
    await openMobileMenu(window);
    await assertCommonShell(window, width, true);
    await bannerBusiness(window, '/perfil');
    const links = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.sidebar nav a')).map(link => link.getAttribute('href'))`);
    assert.deepEqual(links, ['/mapa','/reportar','/mis-reportes','/alertas','/ranking','/recompensas','/premium'], 'El menú compacto conserva toda la navegación global');
    await capture(window, `perfil-shell-${width}x${height}-autenticado.png`);
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar nav a[href="/ranking"]').click()`);
    await waitUntil(window, `location.pathname === '/ranking' && document.body.innerText.includes('Todavía no hay puntos registrados en este mes.')`);
    await menuOpen(window, false);
    await openMobileMenu(window);
    await assertCommonShell(window, width, true);
    await bannerBusiness(window, '/ranking');
    await window.webContents.executeJavaScript(`dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await menuOpen(window, false);
    assert.equal(await window.webContents.executeJavaScript(`document.activeElement === document.querySelector('.mobile-menu')`), true, 'Escape cierra el menú compacto y devuelve el foco');
    await openMobileMenu(window);
    stages.push({test:`Shell ${width}×${height} autenticado: cuenta al pie, controles sin recortes, navegación global y ficha en /perfil y /ranking`,passed:true});
  }
  for (const [index, window] of originalClients.entries()) {
    const mobile = index === 1, width = mobile ? 390 : 1400, viewport = mobile ? 'móvil' : 'escritorio';
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-account button[aria-label="Cerrar sesión"]').click()`);
    await waitUntil(window, `!document.querySelector('button[aria-label="Cerrar sesión"]') && !!document.querySelector('a[href="/ingresar"]')`);
    const directLogin = await window.webContents.executeJavaScript(`(() => {
      const anchor = Array.from(document.querySelectorAll('a[href="/ingresar"]')).find(link => link.getBoundingClientRect().width > 0 && link.getBoundingClientRect().height > 0);
      if (anchor) {anchor.click();return true;}
      document.querySelector('.app-header a[href="/registro"]').click();return false;
    })()`);
    if (!directLogin) {
      await waitUntil(window, `location.pathname === '/registro' && !!document.querySelector('main a[href="/ingresar"]')`);
      await window.webContents.executeJavaScript(`const link = document.querySelector('main a[href="/ingresar"]'); link.scrollIntoView(); link.click()`);
    }
    await waitUntil(window, `location.pathname === '/ingresar' && document.body.innerText.includes('Qué bueno verte de nuevo.')`);
    await window.webContents.executeJavaScript('window.scrollTo(0,0)');
    if (mobile) await openMobileMenu(window);
    await assertCommonShell(window, width, false);
    await bannerBusiness(window, '/ingresar');
    await capture(window, `ingresar-shell-anonimo-${mobile ? 'movil' : 'escritorio'}.png`);
    stages.push({test:`Shell común anónimo en /ingresar (${viewport}): sesión cerrada desde sidebar, banner y ficha conservados`,passed:true});
  }
  for (const {window,width,height} of compactClients) {
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-account button[aria-label="Cerrar sesión"]').click()`);
    await waitUntil(window, `!document.querySelector('button[aria-label="Cerrar sesión"]') && !!document.querySelector('.app-header a[href="/registro"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('.app-header a[href="/registro"]').click()`);
    await waitUntil(window, `location.pathname === '/registro' && !!document.querySelector('main a[href="/ingresar"]')`);
    await window.webContents.executeJavaScript(`const link = document.querySelector('main a[href="/ingresar"]'); link.scrollIntoView(); link.click()`);
    await waitUntil(window, `location.pathname === '/ingresar' && document.body.innerText.includes('Qué bueno verte de nuevo.')`);
    await window.webContents.executeJavaScript('window.scrollTo(0,0)');
    await openMobileMenu(window);
    await assertCommonShell(window, width, false);
    await window.webContents.executeJavaScript(`document.querySelector('.mobile-menu').click()`);
    await menuOpen(window, false);
    await assertCommonShell(window, width, false);
    await capture(window, `ingresar-shell-${width}x${height}-anonimo-menu-cerrado.png`);
    await openMobileMenu(window);
    await assertCommonShell(window, width, false);
    await bannerBusiness(window, '/ingresar');
    await capture(window, `ingresar-shell-${width}x${height}-anonimo-menu-abierto.png`);
    stages.push({test:`Shell ${width}×${height} anónimo: menú abre/cierra, logo/tema/controles visibles y ficha de negocio sin abandonar /ingresar`,passed:true});
  }
}
async function createClient(index, width, height, {route='/mapa',mapReady=true} = {}) {
  const expectedAuthentication = authenticated;
  const window = new BrowserWindow({
    show: false, width, height, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, partition: `map-live-fixture-${index}` },
  });
  windows.push(window);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      allowed = (url.origin === origin && ['http:', 'ws:'].includes(url.protocol))
        || (url.hostname === '127.0.0.1' && url.port === String(frontendPort) && url.protocol === 'ws:')
        || url.protocol === 'data:' || url.protocol === 'blob:';
      if (!allowed) blockedHosts.add(url.hostname || url.protocol);
    } catch { allowed = false; }
    callback({ cancel: !allowed });
  });
  window.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    if (mainFrame) requests.push({ client: index, navigation: url, inPlace });
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(`client ${index}: ${details.reason}`));
  await window.loadURL(`${origin}${route}`);
  window.webContents.enableDeviceEmulation({
    screenPosition: width <= 900 ? 'mobile' : 'desktop', screenSize: { width, height },
    viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 1, scale: 1,
  });
  await waitUntil(window, `innerWidth === ${width}`);
  assert.equal(window.isVisible(), false);
  // A hidden test window has a hidden document. Simulate a foreground browser
  // without showing a native window or changing the app's polling interval.
  await window.webContents.executeJavaScript(`
    window.__smokeVisible = true;
    window.__smokeOnline = true;
    window.__smokeErrors = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__smokeVisible ? 'visible' : 'hidden' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__smokeOnline });
    addEventListener('error', event => window.__smokeErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.__smokeErrors.push(String(event.reason)));
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await waitUntil(window, expectedAuthentication
    ? `!!document.querySelector('.sidebar-account a[href="/perfil"]')`
    : `!!document.querySelector('.app-header a[href="/registro"]') && !document.querySelector('.sidebar-account')`);
  if (mapReady) await waitUntil(window, `document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
  return window;
}
async function finishShellValidation() {
  for (const [index, window] of windows.entries()) {
    assert.equal(window.isVisible(), false, 'Las ventanas de prueba permanecen ocultas');
    assert.deepEqual(await window.webContents.executeJavaScript('window.__smokeErrors'), [], `Errores de React al navegar shell común en cliente ${index + 1}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual([...blockedHosts], []);
  assert.equal(requests.filter(request => request.navigation && !request.inPlace).length, windows.length, 'La navegación del shell usa enlaces internos sin recargar documentos');
  assert.equal(requests.filter(request => request.url === '/api/users/logout' && request.method === 'POST').length, windows.length, 'Todos los clientes cierran su sesión desde la cuenta de sidebar');
  const result = {passed:true,mode:shellOnly ? 'shell-only' : 'map-and-shell',stages,clients:windows.length,headerLayouts,
    incidentRequests:requests.filter(request => request.url === '/api/incidents').length,
    roadRequests:requests.filter(request => request.url === '/api/navigation/roads').length,
    logoutRequests:requests.filter(request => request.url === '/api/users/logout' && request.method === 'POST').length,
    documentLoads:requests.filter(request => request.navigation && !request.inPlace).length,
    limitation:'Token de Mapbox vacío: se verifica la lista y el detalle React; no se solicita cartografía externa.'};
  await fs.writeFile(path.join(local, shellOnly ? 'resultado-shell.json' : 'resultado.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
async function run() {
  await fs.mkdir(local, { recursive: true });
  server.listen(fixturePort, '127.0.0.1');
  await once(server, 'listening');
  await app.whenReady();
  await Promise.all([createClient(1, 1400, 768), createClient(2, 390, 844)]);
  if (shellOnly) {
    await commonShellScenarios();
    await finishShellValidation();
    return;
  }
  await capture(windows[1], 'mapa-vacio.png');
  stages.push({ test: 'Dos clientes independientes, inicialmente vacíos', passed: true });

  incidents = [{ ...incident }]; revision++;
  const publication = await both(`document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row')?.innerText.includes('Incidente publicado desde el dispositivo A')`);
  stages.push({ test: 'Publicación visible en ambos clientes sin recargar', passed: true, milliseconds: publication });
  const isolation = await windows[1].webContents.executeJavaScript(`({ require: typeof require, process: typeof process, rows: document.querySelectorAll('.incident-row').length })`);
  assert.equal(isolation.require, 'undefined'); assert.equal(isolation.process, 'undefined');

  incidents = [{ ...incident, gravedad: 4, nivelRiesgo: 4, descripcion: 'Gravedad actualizada desde otro dispositivo' }]; revision++;
  const update = await both(`document.querySelector('.incident-row')?.innerText.includes('Gravedad 4') && document.querySelector('.incident-row')?.innerText.includes('Gravedad actualizada desde otro dispositivo')`);
  stages.push({ test: 'Cambios de descripción y gravedad sincronizados', passed: true, milliseconds: update });
  await windows[1].webContents.executeJavaScript(`document.querySelector('.incident-row').click()`);
  await waitUntil(windows[1], `!!document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`);

  incidents = []; revision++;
  const resolution = await both(`document.querySelectorAll('.incident-row').length === 0 && document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
  await waitUntil(windows[1], `!document.querySelector('[role="dialog"][aria-labelledby="incident-title"]')`);
  stages.push({ test: 'Resolución retira el incidente y cierra su detalle', passed: true, milliseconds: resolution });

  await windows[1].webContents.executeJavaScript(`window.__smokeVisible = false; document.dispatchEvent(new Event('visibilitychange'));`);
  incidents = [{ ...incident, descripcion: 'Publicado mientras el segundo cliente estaba oculto' }]; revision++;
  await waitUntil(windows[0], `document.querySelector('.incident-row')?.innerText.includes('Publicado mientras el segundo cliente estaba oculto')`);
  await delay(1000);
  assert.equal(await windows[1].webContents.executeJavaScript(`document.querySelectorAll('.incident-row').length`), 0);
  await windows[1].webContents.executeJavaScript(`window.__smokeVisible = true; document.dispatchEvent(new Event('visibilitychange'));`);
  const foreground = await waitUntil(windows[1], `document.querySelector('.incident-row')?.innerText.includes('Publicado mientras el segundo cliente estaba oculto')`, 3000);
  stages.push({ test: 'Cliente oculto se actualiza al volver al primer plano', passed: true, milliseconds: foreground });

  await windows[1].webContents.executeJavaScript(`window.__smokeOnline = false; dispatchEvent(new Event('offline'));`);
  incidents = [{ ...incident, gravedad: 5, nivelRiesgo: 5, descripcion: 'Actualizado mientras el segundo cliente estaba sin conexión' }]; revision++;
  await waitUntil(windows[0], `document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`);
  assert.equal(await windows[1].webContents.executeJavaScript(`document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`), false);
  await windows[1].webContents.executeJavaScript(`window.__smokeOnline = true; dispatchEvent(new Event('online'));`);
  const reconnect = await waitUntil(windows[1], `document.querySelector('.incident-row')?.innerText.includes('Gravedad 5')`, 3000);
  stages.push({ test: 'Reconexión actualiza al segundo cliente inmediatamente', passed: true, milliseconds: reconnect });

  incidents = [{ ...incident }, ...crimeFixtures]; revision++;
  await both(`document.querySelectorAll('.incident-row').length === 3`);
  const controls = '.map-frame .map-controls > .panel-toggle';
  const legend = '.map-frame .risk-legend > .panel-toggle';
  for (const [index, window] of windows.entries()) {
    const viewport = index === 0 ? 'escritorio' : 'movil';
    const cleanPage = await window.webContents.executeJavaScript(`({
      largeHeading: !!document.querySelector('.map-heading'),
      pilot: /piloto|cobertura inicial/i.test(document.body.innerText),
      filterInMap: !!document.querySelector('.map-frame .map-controls select'),
      duplicateFilter: !!document.querySelector('#filter-type'),
    })`);
    assert.deepEqual(cleanPage, { largeHeading: false, pilot: false, filterInMap: true, duplicateFilter: false });
    await panelState(window, controls, false);
    await panelState(window, legend, true);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await window.webContents.executeJavaScript('window.scrollTo(0, 0)');
    await capture(window, `mapa-paneles-plegados-${viewport}.png`);

    await togglePanel(window, controls);
    await panelState(window, controls, true);
    const filter = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.map-frame .map-controls select');
      return { options: Array.from(select.options).map(option => option.textContent),
        groups: Array.from(select.querySelectorAll('optgroup')).map(group => group.label) };
    })()`);
    for (const name of ['Robo', 'Hurto', 'Incendio']) assert.ok(filter.options.includes(name), `${viewport}: falta ${name}`);
    for (const group of ['Delitos y seguridad', 'Emergencias']) assert.ok(filter.groups.includes(group));
    await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').click()`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').checked`), false);
    await togglePanel(window, controls);
    await panelState(window, controls, false);
    await togglePanel(window, controls);
    await panelState(window, controls, true);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').checked`), false);
    await window.webContents.executeJavaScript(`document.querySelector('.map-controls input[type="checkbox"]').click()`);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-filtros-${viewport}.png`);

    await togglePanel(window, legend);
    await panelState(window, legend, false);
    await togglePanel(window, legend);
    await panelState(window, legend, true);
    await panelState(window, controls, true);
    await togglePanel(window, controls);
    await panelState(window, controls, false);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-leyenda-${viewport}.png`);
    await togglePanel(window, legend);
    await panelState(window, legend, false);

    const routeSelector = '.map-route-panel > .panel-toggle';
    await panelState(window, routeSelector, true);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, false);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, true);
    await togglePanel(window, routeSelector);
    await panelState(window, routeSelector, false);
    const reportsSelector = '.map-reports-panel > .panel-toggle';
    await panelState(window, reportsSelector, true);
    await togglePanel(window, reportsSelector);
    await panelState(window, reportsSelector, false);
    await togglePanel(window, reportsSelector);
    await panelState(window, reportsSelector, true);
  }
  stages.push({ test: 'Paneles capas, leyenda y rutas se pliegan en escritorio y móvil; conservan controles y no desbordan', passed: true });
  stages.push({ test: 'Filtro agrupado con Robo, Hurto e Incendio dentro del mapa; cabecera grande y textos de piloto retirados', passed: true });

  const selectedValues = [];
  for (const window of windows) {
    await togglePanel(window, controls);
    await panelState(window, controls, true);
    selectedValues.push(await filterByName(window, 'Hurto'));
    await waitUntil(window, `document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Hurto'`);
    selectedValues[selectedValues.length - 1] = await filterByName(window, 'Robo');
    await waitUntil(window, `document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Robo'`);
  }
  stages.push({ test: 'Seleccionar Hurto o Robo filtra los reportes de ambos clientes', passed: true });
  incidents = [...incidents, { ...crimeFixtures[0], id: 915, descripcion: 'Segundo robo publicado mientras el filtro está activo' }]; revision++;
  await both(`document.querySelectorAll('.incident-row').length === 2 && Array.from(document.querySelectorAll('.incident-row strong')).every(item => item.textContent === 'Robo') && Array.from(document.querySelectorAll('.incident-row')).some(item => item.innerText.includes('Segundo robo publicado mientras el filtro está activo'))`);
  for (const [index, window] of windows.entries()) {
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.map-controls select').value`), selectedValues[index]);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-robo-filtrado-${index === 0 ? 'escritorio' : 'movil'}.png`);
  }
  stages.push({ test: 'Nuevos reportes respetan el filtro elegido después del refresco automático', passed: true });

  incidents = [...incidents, { ...incident, id: 916, tipo: 'Alerta vecinal', tipoNombre: 'Alerta vecinal', tipoSlug: 'alerta-vecinal', descripcion: 'Tipo observado fuera del catálogo' }]; revision++;
  await both(`Array.from(document.querySelector('.map-controls select').options).some(option => option.textContent === 'Alerta vecinal')`);
  const observedValues = [];
  for (const window of windows) observedValues.push(await filterByName(window, 'Alerta vecinal'));
  await both(`document.querySelectorAll('.incident-row').length === 1 && document.querySelector('.incident-row strong')?.textContent === 'Alerta vecinal'`);
  incidents = incidents.filter(item => item.id !== 916); revision++;
  await both(`document.querySelectorAll('.incident-row').length === 0 && document.body.innerText.includes('No hay incidentes publicados para este filtro.')`);
  for (const [index, window] of windows.entries()) {
    const selected = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.map-controls select');
      return { value: select.value, name: select.selectedOptions[0]?.textContent };
    })()`);
    assert.deepEqual(selected, { value: observedValues[index], name: 'Alerta vecinal' });
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.map-controls button')).find(button => button.textContent.trim() === 'Quitar filtro').click()`);
    await waitUntil(window, `document.querySelector('.map-controls select').value === '' && document.querySelectorAll('.incident-row').length === 4`);
    await assertViewport(window, index === 0 ? 1400 : 390);
    await capture(window, `mapa-todos-${index === 0 ? 'escritorio' : 'movil'}.png`);
  }
  stages.push({ test: 'Un tipo fuera del catálogo conserva su filtro al retirar el último reporte; Quitar filtro restaura Todos', passed: true });

  await windows[0].webContents.executeJavaScript(`document.querySelector('button[aria-label="Cambiar a modo claro"]')?.click()`);
  await waitUntil(windows[0], `!!document.querySelector('button[aria-label="Cambiar a modo oscuro"]')`);
  await windows[0].webContents.executeJavaScript(`document.querySelector('button[aria-label="Cambiar a modo oscuro"]').click()`);
  await waitUntil(windows[0], `document.documentElement.dataset.theme === 'dark' && !!document.querySelector('button[aria-label="Cambiar a modo claro"][aria-pressed="true"]')`);
  await assertViewport(windows[0], 1400);
  await windows[0].webContents.executeJavaScript('window.scrollTo(0, 0)');
  await capture(windows[0], 'mapa-filtros-oscuro-escritorio.png');
  await togglePanel(windows[0], legend);
  await panelState(windows[0], legend, true);
  await capture(windows[0], 'mapa-leyenda-oscuro-escritorio.png');
  stages.push({ test: 'Modo oscuro se activa desde ThemeToggle y mantiene controles dentro de pantalla', passed: true });


  // Full browser navigation with synthetic GPS, keeping every request local.
  const navigationWindow = windows[0];
  await togglePanel(navigationWindow, '.map-route-panel > .panel-toggle');
  await panelState(navigationWindow, '.map-route-panel > .panel-toggle', true);
  await navigationWindow.webContents.executeJavaScript(`
    window.__gpsStopped = 0;
    Object.defineProperty(navigator, 'geolocation', {configurable:true, value:{watchPosition(ok){window.__gps=ok;return 99;},clearWatch(){window.__gpsStopped++;}}});
    Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent.includes('Ingresar coordenadas')).click();
  `);
  for (const [label,value] of [['Latitud Origen','-14.06'],['Longitud Origen','-75.73'],['Latitud Destino','-14.05'],['Longitud Destino','-75.72']]) {
    await navigationWindow.webContents.executeJavaScript(`(() => {const input=document.querySelector('input[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, '${value}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  await waitUntil(navigationWindow, `Array.from(document.querySelectorAll('.map-route-panel button')).some(b=>b.textContent === 'Buscar recorridos' && !b.disabled)`);
  await navigationWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent === 'Buscar recorridos').click()`);
  await waitUntil(navigationWindow, `document.querySelector('.route-option')?.innerText.includes('Más segura')`);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('.route-option').click()`);
  await waitUntil(navigationWindow, `Array.from(document.querySelectorAll('.map-route-panel button')).some(b=>b.textContent.includes('Iniciar recorrido'))`);
  await navigationWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.map-route-panel button')).find(b=>b.textContent.includes('Iniciar recorrido')).click()`);
  await waitUntil(navigationWindow, `typeof window.__gps === 'function'`);
  const emitFix = (latitud,longitud,timestamp=Date.now()) => navigationWindow.webContents.executeJavaScript(`window.__gps({coords:{latitude:${latitud},longitude:${longitud},accuracy:10,heading:90,speed:1.2},timestamp:${timestamp}})`);
  await emitFix(-14.06,-75.729);
  await waitUntil(navigationWindow, `document.querySelector('.navigation-guidance')?.innerText.includes('Gira a la izquierda')`);
  await capture(navigationWindow, 'mapa-navegacion.png');
  stages.push({test:'Recorrido con giro, ETA, voz y controles a partir de GPS',passed:true});
  await emitFix(-14.065,-75.728); await emitFix(-14.065,-75.727);
  await waitUntil(navigationWindow, `document.querySelector('.navigation-guidance')?.innerText.includes('Recorrido actualizado')`);
  const replan = requests.filter(r=>r.planBody?.criterio).at(-1)?.planBody;
  assert.equal(replan.criterio,'segura'); assert.equal(replan.origen.latitud,-14.065); assert.equal(replan.origen.longitud,-75.727);
  assert.equal(replan.destino.latitud,-14.05); assert.equal(replan.destino.longitud,-75.72);
  assert.equal(await navigationWindow.webContents.executeJavaScript('window.__gpsStopped'),0);
  stages.push({test:'Desvío recalcula automáticamente desde GPS conservando destino y criterio sin reiniciar watch',passed:true});
  await emitFix(-14.05,-75.72,Date.now()); await emitFix(-14.05,-75.72,Date.now()+6000);
  await waitUntil(navigationWindow, `!document.querySelector('.navigation-guidance') && document.body.innerText.includes('Llegaste a tu destino. Recorrido finalizado.')`);
  assert.equal(await navigationWindow.webContents.executeJavaScript('window.__gpsStopped'),1);
  stages.push({test:'Llegada confirmada finaliza recorrido y libera GPS',passed:true});
  await waitUntil(navigationWindow, `!!document.querySelector('button[aria-label="Anuncio siguiente"]')`);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="Anuncio siguiente"]').click()`);
  if (!await navigationWindow.webContents.executeJavaScript(`document.querySelector('.announcement-content')?.textContent.includes('Negocio local')`)) await navigationWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="Anuncio siguiente"]').click()`);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('button.announcement-content').click()`);
  await waitUntil(navigationWindow, `document.querySelector('[role="dialog"][aria-label="Ficha del negocio"]')?.textContent.includes('Negocio local de prueba')`);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="Cerrar ficha"]').click()`);
  stages.push({test:'Anuncios rotan y abren la ficha comercial existente',passed:true});

  for (const [index, window] of windows.entries()) {
    assert.deepEqual(await window.webContents.executeJavaScript(`window.__smokeErrors`), [], `Errores de React en cliente ${index + 1}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual([...blockedHosts], []);
  assert.equal(requests.filter(request => request.navigation && !request.inPlace).length, 2, 'Cada cliente debe cargar el documento una sola vez');
  assert.ok(requests.some(request => request.url === '/api/navigation/roads' && request.revision >= 4), 'La capa vial también debe actualizarse');
  await capture(windows[1], 'mapa-sincronizado.png');
  stages.push({ test: 'Sin recargas, errores de React, ni peticiones externas; capa vial actualizada', passed: true });
  await commonShellScenarios();
  await finishShellValidation();
}
run().then(() => app.exit(0)).catch(async error => {
  console.error(error.stack || String(error));
  await fs.writeFile(path.join(local, 'fallo.json'), JSON.stringify({ error: String(error), stages, navigations: requests.filter(request => request.navigation) }, null, 2));
  app.exit(1);
}).finally(() => {
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
});
