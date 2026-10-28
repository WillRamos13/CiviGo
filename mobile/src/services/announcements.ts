const internalLink =
  /^\/(?:mapa|registro|ingresar|contactanos|comunidad|ranking|alertas|recompensas|premium|reportar|mis-reportes|perfil|incidentes\/[1-9]\d*)$/;
export type AnnouncementPlacement = "CABECERA" | "REPORTAR";
export interface MapBusiness {
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
export interface Announcement {
  id: number;
  tipo: "NOVEDAD" | "NEGOCIO";
  ubicacion?: AnnouncementPlacement;
  titulo: string;
  mensaje: string;
  enlace: string | null;
  negocio: MapBusiness | null;
  imagen?: { id: string; alt: string } | null;
}
export const BUSINESS_DETAILS_EVENT = "civigo:business-details";
export function announcementPath(placement: AnnouncementPlacement) {
  return placement === "CABECERA"
    ? "/announcements"
    : "/announcements?ubicacion=REPORTAR";
}
export function visibleAnnouncements(
  items: Announcement[],
  placement: AnnouncementPlacement,
  hideBusinessAds: boolean,
) {
  return items.filter(
    (item) =>
      (item.ubicacion ?? "CABECERA") === placement &&
      (item.tipo !== "NEGOCIO" || !hideBusinessAds),
  );
}
export function announcementLink(
  value: string | null | undefined,
  origin: string,
) {
  if (!value || /[\u0000-\u0020<>\\]/.test(value)) return null;
  try {
    if (internalLink.test(value))
      return new URL(value === "/comunidad" ? "/ranking" : value, origin).href;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function announcementImagePath(id: number, imageId: string) {
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      imageId,
    )
  )
    return null;
  return `/announcements/${id}/image`;
}
