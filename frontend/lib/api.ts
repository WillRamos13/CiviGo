export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/$/, '');
export class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData))
        headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
        response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
    }
    catch (error) {
        if (options.signal?.aborted) throw error;
        throw new ApiError('No se pudo conectar con CiviGo. Comprueba tu conexión y vuelve a intentarlo.', 0);
    }
    const data = await response.json().catch(() => null);
    if (options.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    if (!response.ok) {
        let message = 'No se pudo completar la solicitud.';
        if (response.status >= 500) {
            message = 'El servicio de CiviGo no está disponible en este momento. Inténtalo de nuevo.';
            if (response.status === 503 && data?.code === 'ROADS_UNAVAILABLE')
                message = 'Los datos de calles no están disponibles en este momento. Inténtalo de nuevo más tarde.';
            else if (response.status === 503 && typeof data?.code === 'string' && data.code.startsWith('EMAIL_GOOGLE_'))
                message = 'La verificación con Google no está disponible en este momento. Inténtalo de nuevo más tarde.';
            else if (response.status === 503 && typeof data?.code === 'string' && data.code.startsWith('STORAGE_'))
                message = 'No se pudo acceder al archivo. Inténtalo de nuevo más tarde o comunícalo al administrador.';
        }
        else message = data?.error || data?.mensaje || message;
        throw new ApiError(message, response.status, data?.code);
    }
    return data as T;
}
export const post = <T>(path: string, body: unknown = {}, options: RequestInit = {}) => api<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });
export async function upload(file: File, privado = false, tipo: 'PUBLICO' | 'EVIDENCIA' | 'IDENTIDAD' = 'PUBLICO') { const form = new FormData(); form.append('archivo', file); form.append('privado', String(privado)); form.append('tipo', tipo); return api<import('./types').Adjunto>('/uploads', { method: 'POST', body: form }); }
export function currentPosition(): Promise<import('./types').Posicion> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation)
            return reject(new Error('Este navegador no permite obtener tu ubicación.'));
        navigator.geolocation.getCurrentPosition(p => resolve({ latitud: p.coords.latitude, longitud: p.coords.longitude }), () => reject(new Error('No se pudo obtener tu ubicación. Permite el acceso al GPS e inténtalo de nuevo.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
}
export function distance(a: import('./types').Posicion, b: import('./types').Posicion) { const rad = (v: number) => v * Math.PI / 180; const p = rad(b.latitud - a.latitud), q = rad(b.longitud - a.longitud); return 6371000 * 2 * Math.asin(Math.sqrt(Math.sin(p / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(q / 2) ** 2)); }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
export function formatDate(value?: string | null) {if(!value)return 'Sin fecha';const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Fecha no disponible';return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(date);}
export async function getReportes() { return api<import('./types').Reporte[]>('/reports/mine'); }
export async function crearReporte(data: unknown) { return post<{
    reporte: import('./types').Reporte;
    incidente: import('./types').Incidente;
    revision?: { requerida: true; motivo: 'IMAGEN_NO_RELACIONADA' | 'EVIDENCIA_NO_CONCLUYENTE' | 'IA_NO_DISPONIBLE' | 'REVISION_SOLICITADA'; mensaje: string };
}>('/reports', data); }
