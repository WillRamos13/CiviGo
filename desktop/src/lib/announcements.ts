export interface MapAnnouncement {
  id: number;
  tipo: 'NOVEDAD' | 'NEGOCIO';
  titulo: string;
  mensaje: string;
  enlace: string | null;
  negocioId: number | null;
  negocio?: { id: number; nombre: string; activo: boolean } | null;
  activo: boolean;
  orden: number;
  inicio: string | null;
  fin: string | null;
}

export function peruDateInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '';
  // Peru has UTC-5 and no daylight saving time; do not use the Windows timezone.
  return new Date(+date - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function peruDateIso(value: string) {
  if (!value) return null;
  const date = new Date(value + ':00-05:00');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(+date)) throw new Error('Fecha inválida.');
  return date.toISOString();
}

export interface ExternalTrafficNotice {
  id: string;
  externoId: string;
  fuente: 'TOMTOM';
  tipo: string;
  titulo: string;
  descripcion: string;
  latitud: number;
  longitud: number;
  inicio: string | null;
  fin: string | null;
}
export interface TrafficModeration {
  id: number;
  proveedor: 'TOMTOM';
  externoId: string;
  oculto: boolean;
  motivo: string;
  usuarioId: number;
  datos?: Partial<ExternalTrafficNotice>;
  actualizadoEn: string;
}

export function trafficSnapshot(notice: ExternalTrafficNotice) {
  return {
    titulo: notice.titulo, tipo: notice.tipo, descripcion: notice.descripcion,
    latitud: notice.latitud, longitud: notice.longitud, inicio: notice.inicio, fin: notice.fin,
  };
}
