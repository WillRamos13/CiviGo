import type { Posicion } from "./types";
import { metersBetween } from "./navigation";
export type MapBusinessPoint = Posicion & {
  id: number;
  nombre: string;
  demo?: boolean;
  activo?: boolean;
};
const selections=new WeakMap<object,{x:number;y:number;at:number}>();
export function rememberBusinessSelection(map:object,point:{x:number;y:number},now=performance.now()){selections.set(map,{...point,at:now});}
export function consumeBusinessSelection(map:object,point:{x:number;y:number},now=performance.now()){
  const previous=selections.get(map);selections.delete(map);
  return !!previous&&now-previous.at>=0&&now-previous.at<500&&Math.hypot(previous.x-point.x,previous.y-point.y)<2;
}
/** Only explicit real, active records. The mesh is a symbol, not a reconstructed facade. */
export function nearbyMapBusinesses(
  items: MapBusinessPoint[],
  center: Posicion,
  limit = 12,
) {
  const unique = new Map<number, MapBusinessPoint>();
  for (const item of items) {
    if (
      item.demo !== false ||
      item.activo === false ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      !Number.isFinite(item.latitud) ||
      !Number.isFinite(item.longitud) ||
      Math.abs(item.latitud) > 90 ||
      Math.abs(item.longitud) > 180
    )
      continue;
    if (metersBetween(item, center) <= 2000) unique.set(item.id, item);
  }
  return [...unique.values()]
    .sort((a, b) => metersBetween(a, center) - metersBetween(b, center))
    .slice(0, Math.min(12, Math.max(0, limit)));
}
