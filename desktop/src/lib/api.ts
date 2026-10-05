import type { BridgeResult } from '../desktop';
export const API_URL = 'civigo://app/api';
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; }
}
export function unwrap<T>(result: BridgeResult<T>): T {
  if (!result.ok) throw new ApiError(result.error.message, result.error.status, result.error.code);
  return result.data;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
  if (options.body && typeof options.body !== 'string') throw new ApiError('Carga el archivo con el canal autorizado.', 400);
  const method = options.method || 'GET';
  const requestId = method === 'GET' ? crypto.randomUUID() : undefined;
  let abortRead: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (!requestId || !options.signal) return;
    abortRead = () => {
      void window.civigoDesktop.cancelRead(requestId).catch(() => {});
      reject(new DOMException('Solicitud cancelada.', 'AbortError'));
    };
    options.signal.addEventListener('abort', abortRead, { once: true });
  });
  try {
    const pending = window.civigoDesktop.request({ route: path, method, ...(requestId ? { requestId } : {}), ...(typeof options.body === 'string' ? { body: options.body } : {}) });
    const data = unwrap(await (abortRead ? Promise.race([pending, interrupted]) : pending));
    if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    return data as T;
  } finally { if (abortRead) options.signal?.removeEventListener('abort', abortRead); }
}
export const post = <T>(path: string, body: unknown = {}, options: RequestInit = {}) => api<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });
export async function upload(file: File, privado = false, tipo: 'PUBLICO' | 'EVIDENCIA' | 'IDENTIDAD' = 'PUBLICO') {
  if (file.size > 15 * 1024 * 1024) throw new ApiError('Cada archivo debe pesar como máximo 15 MB.', 400);
  return unwrap(await window.civigoDesktop.upload({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), privado, tipo })) as import('./types').Adjunto;
}
export function currentPosition(): Promise<import('./types').Posicion> { return Promise.reject(new Error('Introduce las coordenadas del negocio. El escritorio no solicita permisos de ubicación.')); }
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
export function formatDate(value?: string | null) { if (!value) return 'Sin fecha'; const date = new Date(value); return Number.isFinite(+date) ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(date) : 'Fecha no disponible'; }
