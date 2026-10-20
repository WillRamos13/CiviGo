import type { Ruta, RouteStep } from '../types';

/** The backend provides seconds and an optional provider timestamp; never scale them. */
export function routeEstimateSource(route: Ruta, now = Date.now()) {
  const metadata = route as Ruta & { fuente?: string; actualizadoEn?: string };
  const trafficDate = route.trafico?.actualizadoEn ? Date.parse(route.trafico.actualizadoEn) : NaN;
  const routeDate = metadata.actualizadoEn ? Date.parse(metadata.actualizadoEn) : NaN;
  const timestamp = route.trafico?.disponible ? trafficDate : routeDate;
  const validTimestamp = Number.isFinite(timestamp) && timestamp <= now + 300000;
  const stale = route.copiaGuardada === true || validTimestamp && now - timestamp > 300000;
  const trafficProvider = typeof route.trafico?.fuente === 'string' ? route.trafico.fuente.trim() : '';
  const source = typeof metadata.fuente === 'string' ? metadata.fuente.trim() : '';
  const live = route.modo === 'driving' && route.trafico?.disponible === true && !!trafficProvider && validTimestamp && !stale;
  const provider = route.trafico?.disponible ? trafficProvider || 'proveedor no informado' : source || 'red local';
  const label = route.trafico?.disponible === true
    ? live ? `Tráfico ${provider}` : stale ? `Tráfico ${provider} · desactualizado` : !trafficProvider ? 'Tráfico · fuente sin verificar' : `Tráfico ${provider} · fecha sin verificar`
    : `Estimación ${source || 'red local'} · sin tráfico en vivo${route.copiaGuardada ? ' · recorrido guardado' : stale ? ' · datos antiguos' : ''}`;
  const updatedAt = validTimestamp ? new Date(timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }) : null;
  return { label, provider, live, stale, updatedAt,
    description: `${label}.${updatedAt ? ` Datos de las ${updatedAt}.` : ''}${route.trafico?.motivo ? ` ${route.trafico.motivo}` : ''}` };
}

export function routeArrivalLabel(route: Ruta, remainingSeconds = route.duracion, now = Date.now(), navigating = false): string | null {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return null;
  // A server arrival is a planning snapshot. Once navigating use the same
  // remaining duration shown in the dashboard, not the old fixed arrival.
  const supplied = !navigating && route.llegadaEstimada ? Date.parse(route.llegadaEstimada) : NaN;
  const arrival = Number.isFinite(supplied) && supplied >= now - 60000 ? supplied : now + remainingSeconds * 1000;
  return new Date(arrival).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
}

export function routeCriterionLabel(type: Ruta['tipo']): string {
  return type === 'segura' ? 'Más segura' : type === 'equilibrada' ? 'Equilibrada' : type === 'corta' ? 'Más corta · guardada' : 'Más rápida';
}

/** Display only the measured route summary; segment IDs are not risk samples. */
export function routeRiskSummary(route: Ruta) {
  const known = route.riesgoConocido === true && Number.isInteger(route.nivelRiesgo) && route.nivelRiesgo >= 0 && route.nivelRiesgo <= 5;
  return {
    known,
    level: known ? Math.round(route.nivelRiesgo) : null,
    exposure: known && Number.isFinite(route.puntosRiesgo) && route.puntosRiesgo >= 0 ? route.puntosRiesgo : null,
  };
}

export function splitNavigationWarnings(warnings: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of warnings) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const key = value.trim().toLocaleLowerCase('es').replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value.trim());
  }
  const urgent = unique.filter((value) =>
    /emergencia|incidente grave|peligro|cierre|v[ií]a bloqueada/i.test(value) &&
    // This explains how the planner avoids closures; it reports no new hazard.
    !/^Se evitan los tramos con cierres temporales de TomTom\b/i.test(value));
  return { urgent, conditions: unique.filter((value) => !urgent.includes(value)) };
}

/** Keep the map visible while preserving actual GPS and route warning states. */
export function compactNavigationStatus({ hasFix, offRoute, busy, urgent, error, voiceError }: {
  hasFix: boolean; offRoute: boolean; busy: boolean; urgent: string[]; error?: string; voiceError?: string;
}) {
  const labels: string[] = [], descriptions: string[] = [];
  if (!hasFix) {
    labels.push('GPS pendiente');
    descriptions.push('GPS sin señal reciente o con poca precisión. Se conserva la última estimación.');
  } else if (offRoute) {
    labels.push(busy ? 'Recalculando' : 'Fuera de ruta');
    descriptions.push(busy ? 'Recalculando desde tu ubicación.' : 'Te desviaste de la ruta. Se intentará recalcular desde tu GPS.');
  } else if (busy) {
    labels.push('Recalculando'); descriptions.push('Recalculando desde tu ubicación.');
  }
  if (urgent.length) {
    labels.push(urgent.length === 1 ? 'Alerta en la ruta' : `${urgent.length} alertas en la ruta`);
    descriptions.push(...urgent);
  }
  if (error) { labels.push('Revisa la ruta'); descriptions.push(error); }
  if (voiceError) { labels.push('Voz no disponible'); descriptions.push(voiceError); }
  return labels.length ? { text: labels.join(' · '), description: descriptions.join(' '), alert: Boolean(error || urgent.length) } : null;
}

export function maneuverDirection(step?: Pick<RouteStep, 'maniobra' | 'tipo'> | null): 'left' | 'right' | 'uturn' | 'roundabout' | 'arrival' | 'straight' {
  const value = step?.maniobra || step?.tipo;
  return value === 'izquierda' ? 'left' : value === 'derecha' ? 'right' : value === 'retorno' ? 'uturn' : value === 'rotonda' ? 'roundabout' : value === 'llegada' ? 'arrival' : 'straight';
}

export function headingLabel(heading: number | undefined): string | null {
  if (heading === undefined || !Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(heading / 45) % 8];
}
