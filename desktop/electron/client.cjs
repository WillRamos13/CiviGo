const { DesktopError, MAX_FILE_BYTES, FILE_TYPES, validateRequest, validateUpload, uploadId } = require('./policy.cjs');
const SESSION_COOKIE = 'civigo_session';

async function boundedBytes(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new DesktopError('La respuesta supera el tamaño permitido.', 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > limit) throw new DesktopError('La respuesta supera el tamaño permitido.', 502);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
function privateCookie(headers, secure, now = Date.now()) {
  for (const value of headers.getSetCookie?.() || []) {
    const parts = value.split(';').map(v => v.trim());
    const match = parts.shift()?.match(/^civigo_session=([a-f0-9]{64})$/);
    if (!match) continue;
    const attributes = parts.map(v => v.toLowerCase());
    if (!attributes.includes('httponly') || (secure && !attributes.includes('secure')) || !attributes.includes('path=/')) throw new DesktopError('La sesión recibida no cumple los requisitos de seguridad.', 502);
    const expiry = parts.find(v => /^expires=/i.test(v));
    const expiresAt = expiry ? +new Date(expiry.slice(8)) : now + 7 * 86400000;
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 8 * 86400000) throw new DesktopError('La sesión recibida no es válida.', 502);
    return { header: SESSION_COOKIE + '=' + match[1], expiresAt };
  }
  throw new DesktopError('No se recibió una sesión válida.', 502);
}
class ApiClient {
  #cookie = null; #administrator = false; #epoch = 0; #controllers = new Set(); #reads = new Map(); #authBusy = false;
  constructor({ baseUrl, origin, fetchImpl = fetch, onSession = () => {} }) { this.baseUrl = baseUrl; this.origin = origin; this.fetch = fetchImpl; this.onSession = onSession; }
  clear() { this.#epoch++; this.#cookie = null; this.#administrator = false; for (const controller of this.#controllers) controller.abort(); this.#controllers.clear(); this.#reads.clear(); this.onSession(null); }
  authenticated() { return !!this.#cookie && this.#cookie.expiresAt > Date.now() && this.#administrator; }
  generation() { return this.#epoch; }
  #requireAdmin() { if (!this.authenticated()) { this.clear(); throw new DesktopError('Inicia sesión con una cuenta administradora.', 401, 'DESKTOP_SESSION_REQUIRED'); } }
  cancelRead(requestId) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) throw new DesktopError('Lectura inválida.');
    this.#reads.get(requestId)?.abort();
  }
  async #send(route, { method = 'GET', body, cookie = this.#cookie?.header, binary = false, requestId } = {}) {
    if (this.#controllers.size >= 8) throw new DesktopError('Espera a que terminen las solicitudes pendientes.', 429);
    if (requestId && this.#reads.has(requestId)) throw new DesktopError('La lectura ya está en curso.', 409);
    const controller = new AbortController(); this.#controllers.add(controller);
    if (requestId) this.#reads.set(requestId, controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    const epoch = this.#epoch;
    try {
      const response = await this.fetch(this.baseUrl + '/api' + route, {
        method, body, redirect: 'error', signal: controller.signal,
        headers: { Accept: binary ? '*/*' : 'application/json', Origin: this.origin, ...(cookie ? { Cookie: cookie } : {}), ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
      });
      const bytes = await boundedBytes(response, binary ? MAX_FILE_BYTES : 10 * 1024 * 1024);
      if (epoch !== this.#epoch) throw new DesktopError('La sesión cambió. Inicia sesión nuevamente.', 401);
      if (binary && response.ok) return { response, bytes };
      let data;
      try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new DesktopError('El servidor respondió de forma inesperada.', 502); }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.clear();
        const message = response.status >= 500 ? 'El servicio de CiviGo no está disponible. Inténtalo nuevamente.' : typeof data?.error === 'string' ? data.error.slice(0, 500) : 'No se pudo completar la solicitud.';
        throw new DesktopError(message, response.status, typeof data?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : 'DESKTOP_API_ERROR');
      }
      return { data, response };
    } catch (error) {
      if (error instanceof DesktopError) throw error;
      throw new DesktopError('No se pudo conectar con CiviGo. Comprueba tu conexión.', 0, 'DESKTOP_NETWORK');
    } finally { clearTimeout(timer); this.#controllers.delete(controller); if (this.#reads.get(requestId) === controller) this.#reads.delete(requestId); }
  }
  async login(input) {
    if (!input || typeof input.correo !== 'string' || input.correo.length > 254 || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) throw new DesktopError('Introduce tu correo y contraseña.');
    if (this.#authBusy) throw new DesktopError('Espera a que termine el acceso anterior.', 409);
    this.#authBusy = true; this.clear();
    try {
      const { data, response } = await this.#send('/users/login', { method: 'POST', cookie: null, body: JSON.stringify({ correo: input.correo, password: input.password }) });
      this.#cookie = privateCookie(response.headers, this.baseUrl.startsWith('https:'));
      if (data?.usuario?.rol !== 'ADMIN' || data.usuario.bloqueado) {
        try { await this.#send('/users/logout', { method: 'POST', body: '{}' }); } catch {}
        this.clear(); throw new DesktopError('Esta aplicación está reservada a administradores de CiviGo.', 403, 'DESKTOP_ADMIN_REQUIRED');
      }
      this.#administrator = true;
      return await this.me();
    } catch (error) { this.clear(); throw error; }
    finally { this.#authBusy = false; }
  }
  async me() {
    if (!this.authenticated()) { if (this.#cookie) this.clear(); return null; }
    const { data } = await this.#send('/users/me');
    if (data?.usuario?.rol !== 'ADMIN' || data.usuario.bloqueado) { this.clear(); throw new DesktopError('Tu cuenta ya no tiene acceso administrativo.', 403); }
    this.onSession(data.usuario); return data.usuario;
  }
  async logout() {
    if (this.#authBusy) throw new DesktopError('Espera a que termine el acceso anterior.', 409);
    this.#authBusy = true; const cookie = this.#cookie?.header; this.clear();
    try { if (cookie) await this.#send('/users/logout', { method: 'POST', body: '{}', cookie }); }
    catch {} finally { this.clear(); this.#authBusy = false; }
  }
  async request(input) { const options = validateRequest(input); this.#requireAdmin(); return (await this.#send(options.route, options)).data; }
  async upload(input) {
    const value = validateUpload(input); this.#requireAdmin();
    const body = new FormData();
    body.append('archivo', new Blob([value.bytes], { type: value.mimeType }), value.name);
    body.append('privado', String(value.privado)); body.append('tipo', value.tipo);
    return (await this.#send('/uploads', { method: 'POST', body })).data;
  }
  async attachment(value) {
    const id = uploadId(value); this.#requireAdmin();
    const { response, bytes } = await this.#send('/uploads/' + id, { binary: true });
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!FILE_TYPES.has(mimeType)) throw new DesktopError('El tipo de archivo recibido no está permitido.', 502);
    const headerName = response.headers.get('content-disposition')?.match(/filename="([^"\r\n]{1,150})"/)?.[1];
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
    const name = (headerName || 'archivo-' + id).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'archivo';
    return { bytes, mimeType, name: name.replace(/\.[^.]*$/, '') + '.' + extensions[mimeType] };
  }
}
module.exports = { ApiClient, privateCookie, boundedBytes };
