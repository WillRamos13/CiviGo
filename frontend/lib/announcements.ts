const internalLink = /^\/(?:mapa|comunidad|ranking|alertas|recompensas|premium|reportar|mis-reportes|perfil|incidentes\/[1-9]\d*)$/;
export function announcementLink(value: string | null | undefined, origin: string) {
  if (!value || /[\u0000-\u0020<>\\]/.test(value)) return null;
  try {
    if (internalLink.test(value)) return new URL(value, origin).href;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function announcementImagePath(id: number, imageId: string) {
  if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(imageId)) return null;
  return `/announcements/${id}/image`;
}
