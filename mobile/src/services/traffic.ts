import { api, resolveApiUrl } from './api';
import { isPosition } from './navigation';
import type { MapBounds } from './mapData';

export interface ExternalTrafficIncident {
  id: string; externoId: string; fuente: 'TOMTOM'; tipo: string; titulo: string; descripcion: string;
  geometria: GeoJSON.Point | GeoJSON.LineString; latitud: number; longitud: number;
  inicio: string | null; fin: string | null; actualizadoEn: string; sentido: string | null;
  demoraSegundos: number; temporal: true; afectaRiesgo: false;
}
export interface TrafficResponse {
  incidentes: ExternalTrafficIncident[];
  trafico: { disponible: boolean; fuente: string | null; actualizadoEn: string | null; motivo: string };
  atribucion?: string;
}
export interface TrafficStatus {
  configurado: boolean; habilitado: boolean; controlCuotaDisponible: boolean;
  cuotas?: { tiles: { restantes: number } } | null;
  cobertura?: MapBounds;
  frescuraTilesSegundos?: number;
  fallos?: { tiles?: { codigo: string; motivo: string; reintentarEn: string } };
  ultimaActualizacion?: { tiles?: string };
}

const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validBounds = (value: unknown): value is MapBounds => Array.isArray(value) && value.length === 4 &&
  value.every(n => typeof n === 'number' && Number.isFinite(n)) && value[0] >= -180 && value[2] <= 180 &&
  value[1] >= -90 && value[3] <= 90 && value[0] < value[2] && value[1] < value[3];

export function readTrafficStatus(value: unknown): TrafficStatus {
  const status = value as TrafficStatus | null;
  if (!status || [status.configurado, status.habilitado, status.controlCuotaDisponible].some(flag => typeof flag !== 'boolean') ||
      (status.cobertura !== undefined && !validBounds(status.cobertura)) ||
      (status.controlCuotaDisponible && status.cuotas == null) ||
      (status.cuotas != null && (!Number.isFinite(status.cuotas.tiles?.restantes) || status.cuotas.tiles.restantes < 0)) ||
      (status.fallos?.tiles && (!validDate(status.fallos.tiles.reintentarEn) || typeof status.fallos.tiles.motivo !== 'string')) ||
      (status.ultimaActualizacion?.tiles !== undefined && !validDate(status.ultimaActualizacion.tiles))) {
    throw new Error('No se pudo comprobar la disponibilidad del tráfico.');
  }
  return status;
}

export function readTrafficResponse(value: unknown): TrafficResponse {
  const response = value as TrafficResponse | null;
  const validCoordinate = (point: unknown) => Array.isArray(point) && point.length === 2 &&
    point.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  if (!response || !response.trafico || typeof response.trafico.disponible !== 'boolean' ||
      typeof response.trafico.motivo !== 'string' || !Array.isArray(response.incidentes) || response.incidentes.length > 2000 ||
      (response.trafico.actualizadoEn !== null && !validDate(response.trafico.actualizadoEn)) ||
      response.incidentes.some(incident => !incident || !isPosition(incident) || typeof incident.id !== 'string' || !incident.id ||
        typeof incident.titulo !== 'string' || typeof incident.descripcion !== 'string' || typeof incident.tipo !== 'string' ||
        incident.fuente !== 'TOMTOM' || incident.temporal !== true || incident.afectaRiesgo !== false ||
        !validDate(incident.actualizadoEn) || !Number.isFinite(incident.demoraSegundos) || incident.demoraSegundos < 0 ||
        (incident.geometria?.type === 'Point' ? !validCoordinate(incident.geometria.coordinates) :
          incident.geometria?.type !== 'LineString' || !Array.isArray(incident.geometria.coordinates) ||
          !incident.geometria.coordinates.length || incident.geometria.coordinates.length > 10000 ||
          !incident.geometria.coordinates.every(validCoordinate)))) {
    throw new Error('No se recibieron avisos de tráfico válidos.');
  }
  return response.trafico.disponible ? response : { ...response, incidentes: [] };
}

export function trafficFlowMessage(status: TrafficStatus | null, now = Date.now()): string {
  if (!status) return 'No se pudo comprobar el tráfico. Volveremos a intentarlo.';
  if (!status.configurado || !status.habilitado) return 'Tráfico aún no habilitado por la administración.';
  if (!status.controlCuotaDisponible) return 'No se pudo comprobar la cuota de tráfico.';
  if (status.cuotas?.tiles?.restantes === 0) return 'Cuota de tráfico agotada. Las rutas locales siguen disponibles.';
  if (status.fallos?.tiles && Date.parse(status.fallos.tiles.reintentarEn) > now) return status.fallos.tiles.motivo;
  return '';
}

export function trafficAvailable(status: TrafficStatus | null): boolean {
  return status !== null && !trafficFlowMessage(status);
}

/** The raster proxy is public; no session token or TomTom key enters its URL. */
export function trafficTileUrl(revision: number, resolve = resolveApiUrl): string {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('La capa de tráfico no es válida.');
  const target = new URL(resolve('/navigation/traffic/tiles/flow/0/0/0.png'));
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.search ||
      !target.hostname || !/\/navigation\/traffic\/tiles\/flow\/0\/0\/0\.png$/.test(target.pathname)) {
    throw new Error('La dirección de tráfico debe pertenecer al servicio HTTPS de CiviGo.');
  }
  target.pathname = target.pathname.replace(/0\/0\/0\.png$/, '{z}/{x}/{y}.png');
  target.searchParams.set('v', String(revision));
  return target.href.replace(/%7B([zxy])%7D/gi, '{$1}');
}

export async function getTrafficStatus(signal?: AbortSignal): Promise<TrafficStatus> {
  return readTrafficStatus(await api('/navigation/traffic/status', { signal }));
}
export async function getTrafficIncidents(signal?: AbortSignal): Promise<TrafficResponse> {
  return readTrafficResponse(await api('/navigation/traffic/incidents', { signal }));
}
