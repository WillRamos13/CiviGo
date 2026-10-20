import type { LocationFix, Ruta } from '../types';

type Coordinate = number[];
export interface RouteProjection { segmentIndex: number; ratio: number; coordinates: Coordinate; }
export interface NavigationProgress {
  hasFix: boolean;
  offRoute: boolean;
  step: NonNullable<Ruta['pasos']>[number] | undefined;
  nextStep: NonNullable<Ruta['pasos']>[number] | undefined;
  remainingDistance: number;
  remainingDuration: number;
  distanceToNext: number;
  arrived: boolean;
  coveredDistance: number;
  projectedGeometryDistance: number;
  totalGeometryDistance: number;
  projection: RouteProjection | null;
  accepted: boolean;
}

interface IndexedRoute { offsets: number[]; lengths: number[]; total: number; }
interface Candidate extends RouteProjection { offset: number; lateral: number; }
const indexes = new WeakMap<Ruta, IndexedRoute>();
const radians = Math.PI / 180;

function meters(a: Coordinate, b: Coordinate): number {
  const lat = (b[1] - a[1]) * radians, lon = (b[0] - a[0]) * radians;
  const s = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

function indexRoute(route: Ruta): IndexedRoute {
  const cached = indexes.get(route);
  if (cached) return cached;
  const offsets = [0], lengths: number[] = [];
  const points = route.geometria.coordinates;
  for (let i = 1; i < points.length; i++) {
    const length = meters(points[i - 1], points[i]);
    lengths.push(length); offsets.push(offsets[i - 1] + length);
  }
  const index = { offsets, lengths, total: offsets[offsets.length - 1] || 0 };
  indexes.set(route, index);
  return index;
}

function usable(position: LocationFix | null | undefined, now: number): position is LocationFix {
  return !!position && Number.isFinite(position.latitud) && Math.abs(position.latitud) <= 90 &&
    Number.isFinite(position.longitud) && Math.abs(position.longitud) <= 180 &&
    (position.accuracy === undefined || Number.isFinite(position.accuracy) && position.accuracy >= 0 && position.accuracy <= 100) &&
    (position.timestamp === undefined || Number.isFinite(position.timestamp) && position.timestamp >= now - 30000 && position.timestamp <= now + 5000);
}

function candidates(route: Ruta, fix: LocationFix): Candidate[] {
  const points = route.geometria.coordinates, index = indexRoute(route);
  const scaleX = 111320 * Math.cos(fix.latitud * radians), scaleY = 111320;
  const result: Candidate[] = [];
  let nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const ax = (a[0] - fix.longitud) * scaleX, ay = (a[1] - fix.latitud) * scaleY;
    const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
    const denominator = dx * dx + dy * dy;
    const ratio = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    const lateral = Math.hypot(ax + ratio * dx, ay + ratio * dy);
    // Retain only candidates close to the nearest projection, rather than
    // allocating a second full copy of a long route on every GPS sample.
    if (lateral > nearest + 8) continue;
    if (lateral < nearest) {
      nearest = lateral;
      for (let j = result.length - 1; j >= 0; j--) if (result[j].lateral > nearest + 8) result.splice(j, 1);
    }
    result.push({ segmentIndex: i - 1, ratio, coordinates: [a[0] + ratio * (b[0] - a[0]), a[1] + ratio * (b[1] - a[1])],
      offset: index.offsets[i - 1] + ratio * index.lengths[i - 1], lateral });
  }
  return result;
}

function projectionAt(route: Ruta, offset: number): RouteProjection | null {
  const index = indexRoute(route), points = route.geometria.coordinates;
  if (!index.lengths.length) return null;
  const target = Math.max(0, Math.min(index.total, offset));
  let segmentIndex = index.lengths.length - 1;
  for (let i = 0; i < index.lengths.length; i++) {
    if (target <= index.offsets[i + 1]) { segmentIndex = i; break; }
  }
  const ratio = index.lengths[segmentIndex] > 0 ? (target - index.offsets[segmentIndex]) / index.lengths[segmentIndex] : 0;
  const a = points[segmentIndex], b = points[segmentIndex + 1];
  return { segmentIndex, ratio, coordinates: [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio] };
}

function progressAt(route: Ruta, offset: number, hasFix: boolean, offRoute: boolean, accepted: boolean, fix?: LocationFix | null): NavigationProgress {
  const index = indexRoute(route);
  const projectedGeometryDistance = Math.max(0, Math.min(index.total, offset));
  const coveredDistance = index.total > 0 ? projectedGeometryDistance / index.total * route.distancia : 0;
  const steps = route.pasos || [];
  let stepIndex = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].distanciaAcumulada <= coveredDistance + 3) stepIndex = i;
  const step = steps[stepIndex], nextStep = steps[stepIndex + 1];
  let elapsed = route.distancia > 0 ? coveredDistance / route.distancia * route.duracion : 0;
  if (step && step.distancia > 0) {
    elapsed = step.duracionAcumulada + Math.max(0, Math.min(1, (coveredDistance - step.distanciaAcumulada) / step.distancia)) * step.duracion;
  }
  const remainingDistance = Math.max(0, route.distancia - coveredDistance);
  const end = route.geometria.coordinates[route.geometria.coordinates.length - 1];
  return { hasFix, offRoute, step, nextStep, remainingDistance,
    remainingDuration: Math.max(0, route.duracion - elapsed),
    distanceToNext: nextStep ? Math.max(0, nextStep.distanciaAcumulada - coveredDistance) : remainingDistance,
    arrived: hasFix && accepted && !offRoute && remainingDistance <= 20 && !!fix && (fix.accuracy === undefined || fix.accuracy <= 30) && meters([fix.longitud, fix.latitud], end) <= 20,
    coveredDistance, projectedGeometryDistance, totalGeometryDistance: index.total,
    projection: projectionAt(route, projectedGeometryDistance), accepted };
}

/** Stateless projection for consumers that do not retain a live journey. */
export function getRouteProgress(route: Ruta, position?: LocationFix | null, now = Date.now()): NavigationProgress {
  if (!usable(position, now)) return progressAt(route, 0, false, false, false);
  const nearest = candidates(route, position).reduce<Candidate | null>((best, candidate) => !best || candidate.lateral < best.lateral ? candidate : best, null);
  const offRoute = !!nearest && nearest.lateral > Math.max(50, (position.accuracy || 0) * 1.5);
  return progressAt(route, offRoute ? 0 : nearest?.offset || 0, true, offRoute, !offRoute, position);
}

/** Monotonic journey progress. A poor/stale fix cannot erase already completed road. */
export class RouteProgressTracker {
  private route: Ruta | null = null;
  private offset = 0;
  private previousFix: LocationFix | null = null;
  private lastSample = -Infinity;
  reset() { this.route = null; this.offset = 0; this.previousFix = null; this.lastSample = -Infinity; }
  seed(route: Ruta, coveredDistance: number) {
    this.reset(); this.route = route;
    if (Number.isFinite(coveredDistance) && coveredDistance >= 0 && route.distancia > 0) {
      this.offset = Math.min(route.distancia, coveredDistance) / route.distancia * indexRoute(route).total;
    }
  }
  update(route: Ruta, position?: LocationFix | null, now = Date.now()): NavigationProgress {
    if (route !== this.route) this.seed(route, 0);
    if (!usable(position, now)) return progressAt(route, this.offset, false, false, false);
    // The fix is still useful for displaying GPS status, but not for trimming roads.
    if (position.accuracy !== undefined && position.accuracy > 50) return progressAt(route, this.offset, false, false, false);
    const sample = position.timestamp ?? now;
    if (sample < this.lastSample) return progressAt(route, this.offset, false, false, false);
    const projections = candidates(route, position);
    const nearestLateral = projections.reduce((nearest, candidate) => Math.min(nearest, candidate.lateral), Infinity);
    const offRoute = nearestLateral > Math.max(50, (position.accuracy || 0) * 1.5);
    if (offRoute) return progressAt(route, this.offset, true, true, false);
    const elapsed = this.previousFix ? Math.max(0, (sample - this.lastSample) / 1000) : Infinity;
    const speedCap = route.modo === 'walking' ? 8 : route.modo === 'cycling' ? 25 : 90;
    const allowance = 35 + (position.accuracy || 0) + (this.previousFix?.accuracy || 0);
    const maxAdvance = Number.isFinite(elapsed) ? speedCap * elapsed + allowance : Infinity;
    // At self intersections, prefer continuity instead of jumping to a later lap.
    const nearby = projections.filter(candidate => candidate.lateral <= nearestLateral + 8 &&
      candidate.offset <= this.offset + maxAdvance && (!this.previousFix || candidate.offset >= this.offset - allowance));
    const best = nearby.sort((a, b) => {
      if (Math.abs(a.lateral - b.lateral) > 5) return a.lateral - b.lateral;
      return Math.abs(a.offset - this.offset) - Math.abs(b.offset - this.offset);
    })[0];
    if (!best) {
      const behind = projections.some(candidate => candidate.lateral <= nearestLateral + 5 && candidate.offset < this.offset - allowance);
      return progressAt(route, this.offset, true, behind, false);
    }
    const backwards = !!this.previousFix && best.offset < this.offset - Math.max(35, position.accuracy || 0);
    if (backwards) return progressAt(route, this.offset, true, true, false);
    this.offset = Math.max(this.offset, best.offset);
    this.previousFix = position; this.lastSample = sample;
    return progressAt(route, this.offset, true, false, true, position);
  }
}

/** Split at the projected point; the route retained for rerouting/history is immutable. */
export function getNavigationRouteLines(route: Ruta, progress: NavigationProgress): { completed: GeoJSON.LineString | null; pending: GeoJSON.LineString | null } {
  const coordinates = route.geometria.coordinates;
  if (!progress.projection || progress.projectedGeometryDistance <= 0) return { completed: null, pending: { type: 'LineString', coordinates: coordinates.map(point => [...point]) } };
  if (progress.projectedGeometryDistance >= progress.totalGeometryDistance - 0.01) return { completed: { type: 'LineString', coordinates: coordinates.map(point => [...point]) }, pending: null };
  const { segmentIndex, coordinates: point } = progress.projection;
  const completed = [...coordinates.slice(0, segmentIndex + 1).map(value => [...value]), [...point]];
  const pending = [[...point], ...coordinates.slice(segmentIndex + 1).map(value => [...value])];
  const distinct = (line: number[][]) => line.filter((value, i) => !i || meters(value, line[i - 1]) > 0.01);
  const done = distinct(completed), ahead = distinct(pending);
  return { completed: done.length >= 2 ? { type: 'LineString', coordinates: done } : null,
    pending: ahead.length >= 2 ? { type: 'LineString', coordinates: ahead } : null };
}
