export interface Usuario {
  id: number;
  nickname: string;
  nombre?: string;
  nombres?: string;
  apellidos?: string;
  correo: string;
  telefono: string;
  correoVerificado: boolean;
  rol: string;
  premium: boolean;
  credibilidad: number | null;
  monedas: number;
  permisos?: string[];
  distrito?: string | null;
  tipoAgente?: string | null;
  fechaNacimiento?: string;
  puntosMensuales?: number;
  ocultarAnuncios?: boolean;
  faltas?: number;
  bloqueado?: boolean;
  fechaCreacion?: string;
}

export interface TipoIncidente {
  id: number;
  nombre: string;
  slug: string;
  emergencia: boolean;
  historico: boolean;
  fotoObligatoria: boolean;
  individual: boolean;
  ubicacionRemota: boolean;
}

export interface CategoriaIncidente {
  id: number;
  nombre: string;
  slug: string;
  tipos: TipoIncidente[];
}

export interface Catalogo {
  categorias: CategoriaIncidente[];
  config: Record<string, unknown>;
  servicios?: Record<string, unknown>;
  distritos?: string[];
}

export interface Adjunto {
  id: string;
  nombre: string;
  mimeType: string;
  url: string | null;
  privado: boolean;
  tipo?: string;
}

export interface Incidente {
  id: number;
  distrito?: string | null;
  tipo: string;
  tipoNombre?: string;
  tipoSlug?: string;
  descripcion?: string;
  latitud: number;
  longitud: number;
  estado: string;
  nivelRiesgo: number | null;
  gravedad?: number | null;
  totalReportes: number;
  confirmaciones?: number | unknown[];
  validacion?: number;
  pesoValidacion?: number;
  puntos?: number;
  puntosEfectivos?: number;
  individual?: boolean;
  creadoEn?: string;
  fechaCreacion?: string;
  fechaPublicacion?: string | null;
  fecha?: string;
  fechaEvento?: string;
  chatAbierto?: boolean;
  adjuntos?: Adjunto[];
  reportes?: Reporte[];
  porEvaluar?: boolean;
  resoluciones?: number;
  evaluacion?: string;
  publicado?: boolean;
  emergencia?: boolean;
  historico?: boolean;
  fuente?: string;
  motivoRetiro?: string | null;
}

export interface Reporte {
  id: number;
  tipo: string;
  descripcion: string;
  estado: string;
  fecha?: string;
  creadoEn?: string;
  fechaCreacion?: string;
  fechaEvento?: string;
  fechaPublicacion?: string | null;
  latitud: number;
  longitud: number;
  incidenteId?: number;
  incidente?: Incidente;
  adjuntos?: Adjunto[];
  evidencias?: Adjunto[];
  motivoRetiro?: string | null;
  validado?: boolean;
  apelaciones?: {
    id: number;
    motivo: string;
    estado: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';
    respuesta?: string | null;
    creadoEn: string;
  }[];
}

export interface Posicion {
  latitud: number;
  longitud: number;
}

export interface LocationFix extends Posicion {
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
}

export type RouteCriterion = 'segura' | 'rapida' | 'equilibrada';

export interface RouteStep {
  id: string;
  tipo: string;
  maniobra: string;
  instruccion: string;
  calle: string;
  distancia: number;
  duracion: number;
  distanciaAcumulada: number;
  duracionAcumulada: number;
  coordenadas: number[];
  indiceInicio: number;
  indiceFin: number;
  geometria: GeoJSON.LineString;
}

export interface Ruta {
  id: string;
  nombre: string;
  tipo: 'corta' | RouteCriterion;
  distancia: number;
  duracion: number;
  geometria: GeoJSON.LineString;
  puntosRiesgo: number;
  nivelRiesgo: number;
  advertencias: (string | { mensaje: string })[];
  pasos?: RouteStep[];
  modo?: 'walking' | 'cycling' | 'driving';
  origen?: Posicion;
  destino?: Posicion;
  criterios?: RouteCriterion[];
  riesgoConocido?: boolean;
  llegadaEstimada?: string;
  copiaGuardada?: boolean;
  trafico?: {
    disponible: boolean;
    fuente: string | null;
    actualizadoEn: string | null;
    demoraSegundos: number;
    motivo: string;
  };
}

export interface Mensaje {
  id: number;
  mensaje: string;
  creadoEn: string;
  usuario?: {
    nickname: string;
    rol?: string;
  };
  nickname?: string;
}

export interface NotificationItem {
  id: number;
  titulo: string;
  mensaje: string;
  tipo: string;
  leida: boolean;
  creadoEn: string;
  incidenteId?: number | null;
}

export interface BusinessItem {
  id: number;
  nombre: string;
  descripcion?: string;
  latitud: number;
  longitud: number;
  direccion?: string;
  horario?: string;
  promocion?: string;
  telefono?: string;
  sitioWeb?: string;
}

export interface ParticipationSummaryData {
  reportesValidados: number;
  totalReportes: number;
  puntosMensuales: number;
  mes: string;
  insignias: {
    id: string;
    nombre: string;
    descripcion: string;
    minimo: number;
    obtenida: boolean;
  }[];
  movimientos: {
    tipo: string;
    puntos: number;
    creadoEn: string;
  }[];
}

export interface RankingEntry {
  posicion: number;
  id: number;
  nickname: string;
  puntosMensuales: number;
  reportesValidados: number;
  insigniaPrincipal?: string;
}

export interface RewardItem {
  id: number;
  titulo: string;
  descripcion: string;
  costoMonedas: number;
  categoria: string;
  stock?: number;
  imagen?: string;
  canjeado?: boolean;
}

export const RISK_COLORS = [
  '#22C55E', // Seguro
  '#84CC16', // Riesgo bajo
  '#A3E635', // Precaución
  '#EAB308', // Riesgo medio
  '#F97316', // Inseguro
  '#DC2626', // Crítico
];

export const RISK_NAMES = [
  'Seguro',
  'Riesgo bajo',
  'Precaución',
  'Riesgo medio',
  'Inseguro',
  'Crítico',
];
