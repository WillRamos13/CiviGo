import { Capacitor } from '@capacitor/core';
import { NativeHttpError, requestNativeApi } from './nativeHttp';
import type { Adjunto, Posicion, Reporte, Incidente } from '../types';

export const isNative = Capacitor.isNativePlatform();

// Production backend on Railway
const RAILWAY_BACKEND_URL = 'https://civigo-production.up.railway.app/api';

export const BASE_API_URL = (
  import.meta.env.VITE_API_URL ||
  (isNative ? RAILWAY_BACKEND_URL : '/api')
).replace(/\/$/, '');

export class ApiError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type ApiOptions = RequestInit & { timeoutMs?: number };

let sessionRevision = 0;
const unauthorizedListeners = new Set<() => void>();

/** Ignore responses belonging to a session that has since changed. */
export function advanceApiSession() { sessionRevision++; }

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function invalidateAuthenticatedSession() {
  advanceApiSession();
  for (const listener of unauthorizedListeners) listener();
}

export function resolveApiUrl(path: string): string {
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  let base: URL;
  let target: URL;
  try {
    base = new URL(BASE_API_URL, origin);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.hash || base.search)
      throw new Error();
    if (base.protocol === 'http:' && (isNative || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
      throw new Error();
    if (typeof path !== 'string' || !path || /[\s\\\u0000-\u001f]/.test(path) || path.startsWith('//') ||
        (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^https?:\/\//.test(path))) throw new Error();
    target = new URL(/^https?:\/\//.test(path) ? path : `${base.href.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`);
    const prefix = base.pathname.replace(/\/$/, '');
    if (target.origin !== base.origin || target.username || target.password || target.hash ||
        !target.pathname.startsWith(`${prefix}/`)) throw new Error();
  } catch {
    throw new ApiError('La dirección del servicio de CiviGo no es válida.', 0, 'INVALID_API_URL');
  }
  return target.href;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const requestSession = sessionRevision;
  const {
    timeoutMs = options.method && options.method !== 'GET' ? 90000 : 25000,
    ...requestOptions
  } = options;

  if (options.signal?.aborted) {
    throw new DOMException('Solicitud cancelada.', 'AbortError');
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    let response: { ok: boolean; status: number };
    let data: unknown;
    const url = resolveApiUrl(path);

    try {
      if (isNative) {
        const native = await requestNativeApi(url, { ...requestOptions, headers, signal: controller.signal, timeoutMs });
        response = native;
        data = native.data;
      } else {
        const web = await fetch(url, {
          ...requestOptions,
          signal: controller.signal,
          headers,
          credentials: 'include',
          redirect: 'error',
          cache: requestOptions.cache ?? 'no-store',
        });
        if (web.url && new URL(web.url).href !== url)
          throw new NativeHttpError('La conexión cambió de dirección y se bloqueó para proteger tus datos.', 'API_REDIRECT_BLOCKED');
        response = web;
        data = await web.json().catch(() => null);
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (timedOut) {
        throw new ApiError(
          'La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.',
          0,
          'REQUEST_TIMEOUT'
        );
      }
      if (error instanceof NativeHttpError) throw new ApiError(error.message, error.status, error.code);
      throw new ApiError(
        'No se pudo conectar con el servidor de CiviGo. Comprueba tu conexión.',
        0,
        'NETWORK_ERROR'
      );
    }

    if (options.signal?.aborted) {
      throw new DOMException('Solicitud cancelada.', 'AbortError');
    }
    if (timedOut) {
      throw new ApiError(
        'La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.',
        0,
        'REQUEST_TIMEOUT'
      );
    }

    if (!response.ok) {
      const errorData = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      // Invalid login credentials are not an expiry of the current session.
      if (response.status === 401 && requestSession === sessionRevision &&
          !/^\/users\/(login|register|logout|password\/(forgot|reset))$/.test(path)) {
        for (const listener of unauthorizedListeners) listener();
      }
      let message = 'No se pudo completar la solicitud.';
      if (response.status >= 500) {
        message = 'El servicio de CiviGo no está disponible en este momento. Inténtalo de nuevo.';
        if (response.status === 503 && errorData.code === 'ROADS_UNAVAILABLE') {
          message = 'Los datos de calles no están disponibles en este momento.';
        } else if (response.status === 503 && errorData.code === 'PLACES_SEARCH_UNAVAILABLE') {
          message = 'No se pudo ampliar la búsqueda de lugares.';
        } else if (response.status === 503 && typeof errorData.code === 'string' && errorData.code.startsWith('EMAIL_GOOGLE_')) {
          message = 'La verificación con Google no está disponible en este momento.';
        } else if (response.status === 503 && typeof errorData.code === 'string' && errorData.code.startsWith('STORAGE_')) {
          message = 'No se pudo acceder al archivo multimedia.';
        }
      } else {
        message = typeof errorData.error === 'string'
          ? errorData.error.slice(0, 1000)
          : typeof errorData.mensaje === 'string'
          ? errorData.mensaje.slice(0, 1000)
          : message;
      }
      throw new ApiError(message, response.status, typeof errorData.code === 'string' ? errorData.code : undefined);
    }

    if (data === null && response.status !== 204) {
      throw new ApiError('Respuesta incompleta del servidor.', 502, 'INVALID_RESPONSE');
    }

    return data as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export const post = <T>(path: string, body: unknown = {}, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });

export const put = <T>(path: string, body: unknown = {}, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown = {}, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'DELETE' });

export async function upload(
  file: File,
  privado = false,
  tipo: 'PUBLICO' | 'EVIDENCIA' | 'IDENTIDAD' = 'PUBLICO',
  options: Pick<RequestInit, 'signal'> = {}
): Promise<Adjunto> {
  const form = new FormData();
  form.append('archivo', file);
  form.append('privado', String(privado));
  form.append('tipo', tipo);
  return api<Adjunto>('/uploads', { method: 'POST', body: form, signal: options.signal });
}

export function distance(a: Posicion, b: Posicion): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const p = rad(b.latitud - a.latitud);
  const q = rad(b.longitud - a.longitud);
  return (
    6371000 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(p / 2) ** 2 +
          Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(q / 2) ** 2
      )
    )
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Ocurrió un error inesperado.';
}

export function formatDate(value?: string | null): string {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(date);
}

export async function getReportes(): Promise<Reporte[]> {
  return api<Reporte[]>('/reports/mine');
}

export async function crearReporte(data: unknown): Promise<{
  reporte: Reporte;
  incidente: Incidente;
  revision?: {
    requerida: true;
    motivo: string;
    mensaje: string;
  };
}> {
  return post('/reports', data);
}
