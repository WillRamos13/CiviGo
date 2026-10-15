import { Capacitor } from '@capacitor/core';
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

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
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

    let response: Response;
    const url = path.startsWith('http') ? path : `${BASE_API_URL}${path}`;

    try {
      response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal,
        headers,
        credentials: 'include',
        cache: requestOptions.cache ?? 'no-store',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (timedOut) {
        throw new ApiError(
          'La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.',
          0,
          'REQUEST_TIMEOUT'
        );
      }
      throw new ApiError(
        'No se pudo conectar con el servidor de CiviGo. Comprueba tu conexión.',
        0,
        'NETWORK_ERROR'
      );
    }

    const data = await response.json().catch(() => null);

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
      let message = 'No se pudo completar la solicitud.';
      if (response.status >= 500) {
        message = 'El servicio de CiviGo no está disponible en este momento. Inténtalo de nuevo.';
        if (response.status === 503 && data?.code === 'ROADS_UNAVAILABLE') {
          message = 'Los datos de calles no están disponibles en este momento.';
        } else if (response.status === 503 && data?.code === 'PLACES_SEARCH_UNAVAILABLE') {
          message = 'No se pudo ampliar la búsqueda de lugares.';
        } else if (response.status === 503 && typeof data?.code === 'string' && data.code.startsWith('EMAIL_GOOGLE_')) {
          message = 'La verificación con Google no está disponible en este momento.';
        } else if (response.status === 503 && typeof data?.code === 'string' && data.code.startsWith('STORAGE_')) {
          message = 'No se pudo acceder al archivo multimedia.';
        }
      } else {
        message = typeof data?.error === 'string'
          ? data.error
          : typeof data?.mensaje === 'string'
          ? data.mensaje
          : message;
      }
      throw new ApiError(message, response.status, data?.code);
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

export const post = <T>(path: string, body: unknown = {}, options: RequestInit = {}) =>
  api<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });

export const put = <T>(path: string, body: unknown = {}, options: RequestInit = {}) =>
  api<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown = {}, options: RequestInit = {}) =>
  api<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string, options: RequestInit = {}) =>
  api<T>(path, { ...options, method: 'DELETE' });

export async function upload(
  file: File,
  privado = false,
  tipo: 'PUBLICO' | 'EVIDENCIA' | 'IDENTIDAD' = 'PUBLICO'
): Promise<Adjunto> {
  const form = new FormData();
  form.append('archivo', file);
  form.append('privado', String(privado));
  form.append('tipo', tipo);
  return api<Adjunto>('/uploads', { method: 'POST', body: form });
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
