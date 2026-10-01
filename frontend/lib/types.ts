export interface Usuario {
    id: number;
    nickname: string;
    nombre?: string;
    nombres?: string;
    apellidos?: string;
    correo: string;
    telefono: string;
    telefonoVerificado: boolean;
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
export interface Catalogo {
    categorias: {
        id: number;
        nombre: string;
        slug: string;
        tipos: TipoIncidente[];
    }[];
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
}
export interface Posicion {
    latitud: number;
    longitud: number;
}
export interface Ruta {
    id: string;
    nombre: string;
    tipo: 'corta' | 'segura' | 'equilibrada';
    distancia: number;
    duracion: number;
    geometria: GeoJSON.LineString;
    puntosRiesgo: number;
    nivelRiesgo: number;
    advertencias: (string | {
        mensaje: string;
    })[];
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
export const RISK_COLORS = ['#22C55E', '#84CC16', '#A3E635', '#EAB308', '#F97316', '#DC2626'];
export const RISK_NAMES = ['Seguro', 'Riesgo bajo', 'Precaución', 'Riesgo medio', 'Inseguro', 'Crítico'];
