import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
type NativeOptions = Pick<RequestInit, 'method' | 'body' | 'headers' | 'signal'> & { timeoutMs: number };
type Send = (options: HttpOptions) => Promise<HttpResponse>;

export class NativeHttpError extends Error {
  constructor(message: string, public code: string, public status = 502) { super(message); }
}

function assertActive(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
}

async function formDataBody(form: FormData, signal?: AbortSignal | null) {
  const entries: { key: string; value: string; type: 'string' | 'base64File'; fileName?: string; contentType?: string }[] = [];
  let bytes = 0;
  for (const [key, value] of form.entries()) {
    assertActive(signal);
    if (entries.length >= 8 || !/^[A-Za-z0-9_-]{1,80}$/.test(key))
      throw new NativeHttpError('El archivo no se pudo preparar para el envío.', 'INVALID_UPLOAD', 400);
    if (typeof value === 'string') {
      if (value.length > 4096) throw new NativeHttpError('El formulario supera el tamaño permitido.', 'INVALID_UPLOAD', 400);
      entries.push({ key, value, type: 'string' });
      continue;
    }
    bytes += value.size;
    if (!value.size || bytes > MAX_UPLOAD_BYTES)
      throw new NativeHttpError('Selecciona un archivo de hasta 15 MB que no esté vacío.', 'INVALID_UPLOAD', 400);
    const buffer = new Uint8Array(await value.arrayBuffer());
    assertActive(signal);
    let binary = '';
    for (let offset = 0; offset < buffer.length; offset += 32768)
      binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
    entries.push({ key, value: btoa(binary), type: 'base64File',
      fileName: value.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 150) || 'archivo',
      contentType: /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value.type) ? value.type : 'application/octet-stream',
    });
  }
  return entries;
}

/** Use the public native HTTP API: patched fetch ignores redirect/time limits.
 * Do not detach an in-flight native call on abort: auth queues must wait until
 * its HttpOnly Set-Cookie can no longer overwrite a later login/logout.
 */
export async function requestNativeApi(
  url: string, options: NativeOptions, send: Send = options => CapacitorHttp.request(options),
): Promise<{ status: number; ok: boolean; data: unknown }> {
  assertActive(options.signal);
  let target: URL;
  try { target = new URL(url); }
  catch { throw new NativeHttpError('La dirección del servicio no es válida.', 'INVALID_API_URL', 0); }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash)
    throw new NativeHttpError('La dirección del servicio no es válida.', 'INVALID_API_URL', 0);
  const timeout = options.timeoutMs;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300000)
    throw new NativeHttpError('El tiempo de espera no es válido.', 'INVALID_REQUEST', 400);
  const headers = new Headers(options.headers);
  const request: HttpOptions = {
    url, method: (options.method || 'GET').toUpperCase(),
    headers: {}, responseType: 'json', disableRedirects: true,
    connectTimeout: Math.min(15000, timeout), readTimeout: timeout,
  };
  if (options.body instanceof FormData) {
    request.data = await formDataBody(options.body, options.signal);
    request.dataType = 'formData';
    const entropy = crypto.getRandomValues(new Uint8Array(12));
    headers.set('Content-Type', `multipart/form-data; boundary=----CiviGo${Array.from(entropy, byte => byte.toString(16).padStart(2, '0')).join('')}`);
  } else if (options.body != null) {
    if (typeof options.body !== 'string')
      throw new NativeHttpError('El contenido de la solicitud no es válido.', 'INVALID_REQUEST', 400);
    request.data = options.body;
  }
  request.headers = Object.fromEntries(headers.entries());
  assertActive(options.signal);
  const response = await send(request);
  assertActive(options.signal);
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599)
    throw new NativeHttpError('Respuesta incompleta del servidor.', 'INVALID_RESPONSE');
  let returnedUrl: URL;
  try { returnedUrl = new URL(response.url); }
  catch { throw new NativeHttpError('Respuesta incompleta del servidor.', 'INVALID_RESPONSE'); }
  if ((response.status >= 300 && response.status < 400) || returnedUrl.href !== target.href)
    throw new NativeHttpError('La conexión cambió de dirección y se bloqueó para proteger tus datos.', 'API_REDIRECT_BLOCKED');
  let data: unknown = response.data ?? null;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  return { status: response.status, ok: response.status >= 200 && response.status < 300, data };
}
