import { NavigationService, isPosition, isUsableFix, type NavigationPlace } from './navigation';
import { distance } from './api';
import type { LocationFix, Ruta } from '../types';

export interface RouteStopPreview {
  place: NavigationPlace;
  firstLeg: Ruta;
  secondLeg: Ruta;
  baseline: Ruta;
  combinedDistance: number;
  combinedDuration: number;
  additionalDistance: number;
  additionalDuration: number;
  calculatedAt: number;
}

type Planner = typeof NavigationService.planRoute;
export function canContinueAfterStop(route: Ruta, current: LocationFix | null | undefined, now = Date.now()): boolean {
  return !!route.paradaIntermedia && isUsableFix(current, now) && current.timestamp !== undefined && Number.isFinite(current.timestamp) && current.accuracy !== undefined && current.accuracy <= 30 &&
    distance(current, route.paradaIntermedia) <= 20;
}
function select(routes: Ruta[], criterion: Ruta['tipo']): Ruta {
  const selected = routes.find(route => route.tipo === criterion) || routes[0];
  if (!selected) throw new Error('No se encontró una ruta válida para esta parada. Se conserva el recorrido actual.');
  return selected;
}

/** Three real routings; neither straight-line distances nor invented detour times. */
export async function planIntermediateStop(current: LocationFix | null | undefined, place: NavigationPlace,
  activeRoute: Ruta, signal: AbortSignal, planner: Planner = NavigationService.planRoute): Promise<RouteStopPreview> {
  if (!isUsableFix(current) || current.timestamp === undefined || !Number.isFinite(current.timestamp) || current.accuracy === undefined || current.accuracy > 50) throw new Error('Necesitas GPS reciente y preciso para calcular una parada.');
  const final = activeRoute.paradaIntermedia?.destinoFinal || activeRoute.destino;
  if (!isPosition(final) || !isPosition(place)) throw new Error('La parada o el destino final no tiene una ubicación válida.');
  const mode = activeRoute.modo || 'walking';
  const stop = { latitud: place.latitud, longitud: place.longitud };
  const first = select(await planner(current, stop, mode, signal), activeRoute.tipo);
  if (signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
  const second = select(await planner(stop, final, mode, signal), activeRoute.tipo);
  if (signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
  const baseline = select(await planner(current, final, mode, signal), activeRoute.tipo);
  if (signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
  const finalName = activeRoute.paradaIntermedia?.destinoFinalNombre || activeRoute.destinoNombre;
  const firstLeg: Ruta = { ...first, origen: current, destino: stop, destinoNombre: place.nombre, modo: mode,
    paradaIntermedia: { ...stop, nombre: place.nombre, destinoFinal: { ...final }, destinoFinalNombre: finalName } };
  const secondLeg: Ruta = { ...second, origen: stop, destino: { ...final }, destinoNombre: finalName, modo: mode };
  const combinedDistance = first.distancia + second.distancia, combinedDuration = first.duracion + second.duracion;
  return { place, firstLeg, secondLeg, baseline, combinedDistance, combinedDuration,
    additionalDistance: combinedDistance - baseline.distancia, additionalDuration: combinedDuration - baseline.duracion, calculatedAt: Date.now() };
}

/** The final leg is always recalculated from the actual GPS, not the old stop coordinate. */
export async function planAfterStop(current: LocationFix | null | undefined, route: Ruta, signal: AbortSignal,
  planner: Planner = NavigationService.planRoute): Promise<Ruta> {
  if (!route.paradaIntermedia || !isUsableFix(current) || !canContinueAfterStop(route, current)) throw new Error('Acércate a la parada y espera una ubicación GPS precisa para continuar.');
  const final = route.paradaIntermedia.destinoFinal;
  const mode = route.modo || 'walking';
  const next = select(await planner(current, final, mode, signal), route.tipo);
  if (signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
  const { paradaIntermedia: _ignored, ...withoutStop } = next;
  return { ...withoutStop, origen: current, destino: { ...final }, destinoNombre: route.paradaIntermedia.destinoFinalNombre, modo: mode };
}
