export type MapAppearance = {mode: '2d' | '3d'; light: 'auto' | 'dawn' | 'day' | 'dusk' | 'night'};
export const DEFAULT_APPEARANCE: MapAppearance = {mode: '2d', light: 'day'};
export const MAP_STYLE = 'mapbox://styles/mapbox/standard';
export const APPEARANCE_KEY = 'civigo:map-appearance:v1';
export function parseAppearance(value: unknown): MapAppearance {
    const entry = value as Partial<MapAppearance> | null;
    return {mode: entry?.mode === '3d' ? '3d' : '2d', light: ['auto','dawn','day','dusk','night'].includes(entry?.light ?? '') ? entry!.light! : 'day'};
}
export function mapLightPreset(light: MapAppearance['light'], now = new Date()): Exclude<MapAppearance['light'], 'auto'> {
    if (light !== 'auto') return light;
    const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Lima',hour:'2-digit',hourCycle:'h23'}).format(now));
    return hour < 5 || hour >= 19 ? 'night' : hour < 7 ? 'dawn' : hour < 17 ? 'day' : 'dusk';
}
