import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';
import { isNative, resolveApiUrl } from './api';
import { resolveMediaUrl } from './media';
import type { OperationToken } from './operationScope';

export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf']);

export interface MediaRequest { url: string; mimeType: string; privado?: boolean }
export interface MediaTransport {
  native: boolean;
  fetch(url: string, options: RequestInit): Promise<Response>;
  nativeGet(options: HttpOptions): Promise<HttpResponse>;
}
const transport: MediaTransport = {
  native: isNative,
  fetch: (url, options) => fetch(url, options),
  nativeGet: (options) => CapacitorHttp.get(options),
};

function signature(bytes: Uint8Array, mime: string): boolean {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  switch (mime) {
    case 'image/jpeg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/png': return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case 'image/gif': return /^GIF8[79]a$/.test(text(0, 6));
    case 'image/webp': return text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
    case 'video/mp4': return text(4, 4) === 'ftyp';
    case 'video/quicktime': return text(4, 4) === 'ftyp' && text(8, 4) === 'qt  ';
    case 'video/webm': return [26, 69, 223, 163].every((byte, index) => bytes[index] === byte);
    case 'application/pdf': return text(0, 5) === '%PDF-';
    default: return false;
  }
}

function abortable<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Carga cancelada.', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    request.then((value) => { if (signal.aborted) cancel(); else resolve(value); }, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}

function validateHeaders(status: number, headers: Headers, expected: string): void {
  if (status < 200 || status >= 300) throw new Error(status === 401 || status === 403 ? 'No tienes acceso a esta evidencia.' : 'No se pudo cargar la evidencia.');
  const actual = headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (actual !== expected) throw new Error('El formato de la evidencia no coincide con el archivo.');
  const size = Number(headers.get('content-length'));
  if (size > MAX_MEDIA_BYTES) throw new Error('La evidencia supera el límite de 15 MB.');
}

function contentHeaders(headers: Record<string, string>): Headers {
  const selected = new Headers();
  for (const name of Object.keys(headers)) {
    if (['content-type', 'content-length'].includes(name.toLowerCase())) selected.set(name, headers[name]);
  }
  return selected;
}

export async function fetchAuthenticatedMedia(request: MediaRequest, operation: OperationToken, ports: MediaTransport = transport): Promise<Blob> {
  operation.assertActive();
  const permitted = resolveMediaUrl(request.url);
  if (!permitted || !allowed.has(request.mimeType) || (request.mimeType === 'application/pdf' && !request.privado)) {
    throw new Error('La dirección o el formato de la evidencia no es válido.');
  }
  const url = resolveApiUrl(permitted.startsWith('/api/uploads/') ? permitted.slice(4) : permitted);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  operation.signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 25000);
  try {
    let blob: Blob;
    if (ports.native) {
      // Native HTTP uses its HttpOnly cookie jar; credentials never enter JavaScript.
      const response = await abortable(ports.nativeGet({ url, responseType: 'arraybuffer', disableRedirects: true,
        headers: { Accept: request.mimeType }, connectTimeout: 15000, readTimeout: 25000,
        webFetchExtra: { credentials: 'include', signal: controller.signal },
      }), controller.signal);
      operation.assertActive();
      validateHeaders(response.status, contentHeaders(response.headers), request.mimeType);
      if (response.url && new URL(response.url, url).href !== url) throw new Error('La evidencia cambió de dirección.');
      if (typeof response.data !== 'string' || response.data.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(response.data)) throw new Error('La evidencia recibida no es válida.');
      const decoded = atob(response.data);
      const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      blob = new Blob([bytes], { type: request.mimeType });
    } else {
      const response = await abortable(ports.fetch(url, { credentials: 'include', signal: controller.signal,
        cache: 'no-store', redirect: 'error', headers: { Accept: request.mimeType },
      }), controller.signal);
      operation.assertActive();
      validateHeaders(response.status, response.headers, request.mimeType);
      if (response.url && new URL(response.url, url).href !== url) throw new Error('La evidencia cambió de dirección.');
      const reader = response.body?.getReader();
      if (reader) {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await abortable(reader.read(), controller.signal);
            operation.assertActive();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > MAX_MEDIA_BYTES) throw new Error('La evidencia supera el límite de 15 MB.');
            parts.push(new Uint8Array(chunk.value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        blob = new Blob(parts, { type: request.mimeType });
      } else blob = await abortable(response.blob(), controller.signal);
    }
    operation.assertActive();
    if (!blob.size || blob.size > MAX_MEDIA_BYTES) throw new Error('La evidencia está vacía o supera el tamaño permitido.');
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    operation.assertActive();
    if (!signature(bytes, request.mimeType)) throw new Error('El contenido de la evidencia no coincide con su formato.');
    return blob;
  } finally {
    clearTimeout(timeout);
    operation.signal.removeEventListener('abort', cancel);
  }
}

export interface MediaResource { url: string; dispose(): void }

export function stopMediaPlayback(media: Pick<HTMLMediaElement, 'pause' | 'removeAttribute' | 'load'> | null): void {
  if (!media) return;
  try { media.pause(); } catch { /* Already detached. */ }
  media.removeAttribute('src');
  try { media.load(); } catch { /* No player remains after detachment. */ }
}

export async function createAuthenticatedMediaResource(
  request: MediaRequest,
  operation: OperationToken,
  ports: MediaTransport = transport,
  objectUrls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): Promise<MediaResource> {
  const blob = await fetchAuthenticatedMedia(request, operation, ports);
  operation.assertActive();
  const url = objectUrls.createObjectURL(blob);
  let disposed = false;
  const resource = { url, dispose() { if (!disposed) { disposed = true; objectUrls.revokeObjectURL(url); } } };
  if (!operation.isActive()) { resource.dispose(); operation.assertActive(); }
  const cancel = () => resource.dispose();
  operation.signal.addEventListener('abort', cancel, { once: true });
  return { url, dispose() { operation.signal.removeEventListener('abort', cancel); resource.dispose(); } };
}
