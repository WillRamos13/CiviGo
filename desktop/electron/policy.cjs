const path = require('node:path');
const DEFAULT_BACKEND = 'https://civigo-production.up.railway.app';
const DEFAULT_ORIGIN = 'https://civigo.online';
const RENDERER_URL = 'civigo://app/index.html';
const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

class DesktopError extends Error {
  constructor(message, status = 400, code = 'DESKTOP_INVALID') { super(message); this.status = status; this.code = code; }
}
function backendUrl(value = DEFAULT_BACKEND, development = false) {
  if (typeof value !== 'string' || value.length > 2048) throw new DesktopError('Configuración del servidor inválida.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new DesktopError('Configuración del servidor inválida.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    throw new DesktopError('Usa una dirección HTTPS del backend, sin rutas ni credenciales.');
  return url.origin;
}
function requestOrigin(value = DEFAULT_ORIGIN, development = false) { return backendUrl(value, development); }
const numeric = '[1-9][0-9]{0,9}';
const readRoutes = [
  /^\/admin(?:\/(?:incidents|users|catalog|businesses|config|rewards|redemptions|appeals|recoveries|audit|integrations))?$/,
  /^\/catalog$/, /^\/users\/me$/,
  /^\/announcements\/(?:manage|traffic-moderation)$/, /^\/navigation\/traffic\/incidents$/,
];
const writeRoutes = [
  ['POST', /^\/announcements\/(?:manage|traffic-moderation)$/],
  ['PATCH', new RegExp(`^/announcements/manage/${numeric}$`)],
  ['DELETE', new RegExp(`^/announcements/manage/${numeric}$`)],
  ['POST', /^\/admin\/users$/],
  ['POST', new RegExp(`^/admin/(?:incidents/${numeric}/(?:classify|review)|users/${numeric}/adjustments|appeals/${numeric}|recoveries/${numeric}|ranking/settle|lifecycle/run|categories|types|businesses|rewards|redemptions/${numeric})$`)],
  ['PATCH', new RegExp(`^/admin/(?:users/${numeric}|config|categories/${numeric}|types/${numeric}|businesses/${numeric}|rewards/${numeric})$`)],
  ['POST', /^\/history\/import\/(?:preview|commit)$/],
];
function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DesktopError('Solicitud inválida.');
  const { route, method = 'GET', body, requestId } = input;
  if (typeof route !== 'string' || route.length > 500 || !route.startsWith('/') || /[%\\?#\s]/.test(route) || route.includes('..') || route.includes('//')) throw new DesktopError('Ruta no permitida.');
  if (!(method === 'GET' && readRoutes.some(r => r.test(route))) && !writeRoutes.some(([m, r]) => method === m && r.test(route))) throw new DesktopError('Operación no permitida.');
  if (method === 'GET' && body !== undefined) throw new DesktopError('Solicitud inválida.');
  if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 3 * 1024 * 1024)) throw new DesktopError('La solicitud supera el tamaño permitido.');
  if (body !== undefined) { try { const json = JSON.parse(body); if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(); } catch { throw new DesktopError('Datos de solicitud inválidos.'); } }
  if (requestId !== undefined && (method !== 'GET' || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))) throw new DesktopError('Lectura inválida.');
  return { route, method, body, requestId };
}
function validateUpload(input) {
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' || input.name.length > 150 || /[\\/\x00-\x1f]/.test(input.name) || !FILE_TYPES.has(input.mimeType) || !['PUBLICO', 'EVIDENCIA', 'IDENTIDAD'].includes(input.tipo) || typeof input.privado !== 'boolean') throw new DesktopError('Archivo inválido.');
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) throw new DesktopError('Cada archivo debe pesar como máximo 15 MB.');
  return { ...input, bytes: new Uint8Array(bytes) };
}
function uploadId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new DesktopError('Archivo inválido.');
  return value;
}
function publicUrl(value) {
  if (typeof value !== 'string' || !/^\/(?:mapa|ranking|incidentes\/[1-9][0-9]{0,9})$/.test(value)) throw new DesktopError('Enlace no permitido.');
  return DEFAULT_ORIGIN + value;
}
function senderAllowed(event, window) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === RENDERER_URL;
}
function bundlePath(root, value) {
  let url;
  try { url = new URL(value); } catch { throw new DesktopError('Recurso inválido.'); }
  if (url.protocol !== 'civigo:' || url.host !== 'app' || url.search || url.hash) throw new DesktopError('Recurso inválido.');
  let name;
  try { name = decodeURIComponent(url.pathname); } catch { throw new DesktopError('Recurso inválido.'); }
  if (name.includes('\\') || /[\x00-\x1f]/.test(name)) throw new DesktopError('Recurso inválido.');
  const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new DesktopError('Recurso inválido.');
  return target;
}
module.exports = { DEFAULT_BACKEND, DEFAULT_ORIGIN, RENDERER_URL, FILE_TYPES, MAX_FILE_BYTES, DesktopError, backendUrl, requestOrigin, validateRequest, validateUpload, uploadId, publicUrl, senderAllowed, bundlePath };
