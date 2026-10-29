// Incident Icon mapping for CiviGo Mobile
// Uses bundled icons in /iconos/
const ICON_MAP: Record<string, string> = {
  'bache': '/iconos/bache.png',
  'basura-acumulada': '/iconos/basura.png',
  'calle-bloqueada': '/iconos/calle bloqueada.png',
  'accidente-vehicular': '/iconos/choque.png',
  'derrumbe': '/iconos/derrumbe.png',
  'persona-desaparecida': '/iconos/desaparecido.png',
  'disturbio': '/iconos/disturbios.png',
  'fuga-de-gas': '/iconos/gas.png',
  'mala-iluminacion': '/iconos/iluminacion.png',
  'incendio': '/iconos/incendio.png',
  'intento-de-robo': '/iconos/intento de robo.png',
  'inundacion': '/iconos/inundacion.png',
  'robo': '/iconos/robo.png',
  'hurto': '/incident-symbols/hurto.svg',
  'extorsion': '/incident-symbols/extorsion.svg',
  'amenazas': '/incident-symbols/amenazas.svg',
  'humo': '/incident-symbols/humo.svg',
  'pelea': '/incident-symbols/pelea.svg',
  'animal-peligroso': '/incident-symbols/animal-peligroso.svg',
  'semaforo': '/iconos/semaforo.png',
  'semaforo-danado': '/iconos/semaforo.png',
  'persona-sospechosa': '/iconos/sospechoso.png',
};

export function normalizeIncidentSlug(value?: string | null): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-');
}

export const normalizeIconSlug = normalizeIncidentSlug;

export function getIncidentIconPath(...candidates: (string | undefined | null)[]): string {
  for (const candidate of candidates) {
    const slug = normalizeIncidentSlug(candidate);
    const family=slug.startsWith('hurto-')?'hurto':slug.startsWith('extorsion-')?'extorsion':slug.startsWith('amenaza')?'amenazas':slug.startsWith('humo')?'humo':['rina','peleas'].includes(slug)?'pelea':slug;
    if (family && ICON_MAP[family]) return ICON_MAP[family];
  }
  return '/iconos/alerta.svg';
}

export function getIncidentScale(slug?: string | null): number {
  const norm = normalizeIncidentSlug(slug);
  if (norm === 'calle-bloqueada') return 2.2;
  return 1;
}
