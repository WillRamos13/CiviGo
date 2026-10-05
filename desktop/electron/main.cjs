const { app, BrowserWindow, ipcMain, protocol, session, Menu, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ApiClient } = require('./client.cjs');
const { backendUrl, requestOrigin, RENDERER_URL, DesktopError, senderAllowed, bundlePath, publicUrl, uploadId } = require('./policy.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'civigo', privileges: { standard: true, secure: true } }]);
app.enableSandbox();
app.setAppUserModelId('online.civigo.administracion');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
async function config() {
  let local = {};
  try { local = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'desktop.config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new DesktopError('La configuración local no es válida.'); }
  return { baseUrl: backendUrl(process.env.CIVIGO_DESKTOP_BACKEND_URL || local.backendUrl, !app.isPackaged), origin: requestOrigin(process.env.CIVIGO_DESKTOP_ORIGIN || local.origin, !app.isPackaged) };
}
async function bootstrap({ hidden = false } = {}) {
  await app.whenReady();
  const options = await config();
  let window;
  const client = new ApiClient({ ...options, onSession: user => { if (window && !window.isDestroyed()) window.webContents.send('civigo:session-changed', user); } });
  const rendererSession = session.fromPartition('civigo-administracion-ui');
  rendererSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('civigo://app/') }));
  rendererSession.protocol.handle('civigo', async request => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
      const target = bundlePath(path.join(__dirname, '../dist'), request.url);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(target)];
      if (!mime) return new Response('', { status: 404 });
      return new Response(await fs.readFile(target), { headers: { 'Content-Type': mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response('', { status: 404 }); }
  });
  window = new BrowserWindow({ width: 1320, height: 920, minWidth: 1000, minHeight: 680, show: !hidden, title: 'CiviGo Administración', icon: path.join(__dirname, '../dist/civigo-icon.png'), backgroundColor: '#f5f8fe', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: rendererSession, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: !app.isPackaged } });
  Menu.setApplicationMenu(null);
  async function download(id) {
    uploadId(id);
    const generation = client.generation();
    const file = await client.attachment(id);
    try {
      const result = await dialog.showSaveDialog(window, { title: 'Guardar archivo autorizado de CiviGo', defaultPath: path.join(app.getPath('downloads'), file.name), filters: [{ name: 'Archivo de CiviGo', extensions: [file.name.split('.').pop()] }] });
      if (result.canceled || !result.filePath) return { cancelado: true };
      if (!client.authenticated() || generation !== client.generation()) throw new DesktopError('La sesión terminó. Vuelve a solicitar el archivo.', 401);
      await fs.writeFile(result.filePath, file.bytes); return { guardado: true };
    } finally { file.bytes.fill(0); }
  }
  for (const [channel, action] of Object.entries({ login: value => client.login(value), session: () => client.me(), logout: () => client.logout(), request: value => client.request(value), 'cancel-read': value => client.cancelRead(value), upload: value => client.upload(value), download, public: value => shell.openExternal(publicUrl(value)) })) {
    ipcMain.handle('civigo:' + channel, async (event, value) => {
      if (!senderAllowed(event, window)) return { ok: false, error: { message: 'Origen de solicitud no permitido.', status: 403 } };
      try { return { ok: true, data: await action(value) }; }
      catch (error) { return { ok: false, error: { message: error instanceof DesktopError ? error.message : 'No se pudo completar la operación.', status: error instanceof DesktopError ? error.status : 0, code: error instanceof DesktopError ? error.code : 'DESKTOP_ERROR' } }; }
    });
  }
  const deniedNavigation = (event) => event.preventDefault();
  window.webContents.on('will-navigate', deniedNavigation);
  window.webContents.on('will-frame-navigate', deniedNavigation);
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    const match = url.match(/^civigo:\/\/app\/api\/uploads\/([a-zA-Z0-9_-]{1,100})$/);
    if (match) void download(match[1]).catch(() => { if (!window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: 'No se pudo descargar el archivo. Comprueba tu sesión y vuelve a intentarlo.' }); });
    return { action: 'deny' };
  });
  window.on('closed', () => { client.clear(); for (const name of ['login', 'session', 'logout', 'request', 'cancel-read', 'upload', 'download', 'public']) ipcMain.removeHandler('civigo:' + name); rendererSession.protocol.unhandle('civigo'); });
  await window.loadURL(RENDERER_URL);
  return { window, client };
}
if (require.main === module) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    let current;
    app.on('second-instance', () => { if (current && !current.isDestroyed()) { if (current.isMinimized()) current.restore(); current.focus(); } });
    bootstrap().then(({ window }) => { current = window; }).catch(error => { void dialog.showErrorBox('CiviGo Administración', error instanceof DesktopError ? error.message : 'No se pudo iniciar la aplicación.'); app.quit(); });
    app.on('window-all-closed', () => app.quit());
  }
}
module.exports = { bootstrap, CSP };
