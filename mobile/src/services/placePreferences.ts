import { Preferences } from '@capacitor/preferences';
import { cleanPlace, placeKey } from './placeDiscovery';
import type { NavigationPlace } from './navigation';

export type PlaceLabel = 'saved' | 'home' | 'work';
export interface RecentPlace { place: NavigationPlace; visitedAt: number; }
export interface SavedPlace { place: NavigationPlace; label: PlaceLabel; }
export interface PlacePreferences { recent: RecentPlace[]; saved: SavedPlace[]; }
export const emptyPlacePreferences = (): PlacePreferences => ({ recent: [], saved: [] });
export interface PlacePreferencesDriver {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
}
const queues = new WeakMap<PlacePreferencesDriver, Promise<void>>();
function enqueue<T>(driver: PlacePreferencesDriver, task: () => Promise<T>): Promise<T> {
  const pending = (queues.get(driver) ?? Promise.resolve()).then(task);
  queues.set(driver, pending.then(() => {}, () => {}));
  return pending;
}

export function parsePlacePreferences(value: string | null, now = Date.now()): PlacePreferences {
  const result = emptyPlacePreferences();
  if (!value || value.length > 100000) return result;
  let data: unknown;
  try { data = JSON.parse(value); } catch { return result; }
  if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) return result;
  const input = data as { recent?: unknown; saved?: unknown };
  if (Array.isArray(input.recent)) {
    const used = new Set<string>();
    for (const entry of input.recent.slice(0, 100)) {
      const place = cleanPlace(entry?.place), visitedAt = entry?.visitedAt;
      if (!place || typeof visitedAt !== 'number' || !Number.isFinite(visitedAt) || visitedAt < now - 90 * 86400000 || visitedAt > now + 5000 || used.has(placeKey(place))) continue;
      used.add(placeKey(place)); result.recent.push({ place, visitedAt });
    }
    result.recent.sort((a, b) => b.visitedAt - a.visitedAt); result.recent = result.recent.slice(0, 8);
  }
  if (Array.isArray(input.saved)) {
    const used = new Set<string>();
    for (const entry of input.saved.slice(0, 100)) {
      const place = cleanPlace(entry?.place), label = entry?.label;
      if (!place || !['saved', 'home', 'work'].includes(label)) continue;
      const key = label === 'saved' ? `${label}:${placeKey(place)}` : label;
      if (used.has(key)) continue;
      used.add(key); result.saved.push({ place, label });
      if (result.saved.length === 20) break;
    }
  }
  return result;
}

/** No anonymous history; every read/write is scoped to the current account. */
export class PlacePreferencesController {
  private owner: number | null = null;
  private revision = 0;
  constructor(private driver: PlacePreferencesDriver = Preferences) {}
  setOwner(id: number | null) {
    const next = Number.isSafeInteger(id) && Number(id) > 0 ? id : null;
    if (this.owner === next) return;
    this.owner = next; this.revision++;
  }
  load(): Promise<PlacePreferences | null> {
    const owner = this.owner, revision = ++this.revision;
    if (owner === null) return Promise.resolve(null);
    return enqueue(this.driver, async () => {
      if (owner !== this.owner || revision !== this.revision) return null;
      const { value } = await this.driver.get({ key: `civigo:places:v1:user:${owner}` });
      return owner === this.owner && revision === this.revision ? parsePlacePreferences(value) : null;
    });
  }
  change(update: (current: PlacePreferences) => PlacePreferences): Promise<PlacePreferences | null> {
    const owner = this.owner, revision = this.revision;
    if (owner === null) return Promise.resolve(null);
    return enqueue(this.driver, async () => {
      if (owner !== this.owner || revision !== this.revision) return null;
      const key = `civigo:places:v1:user:${owner}`;
      const { value } = await this.driver.get({ key });
      if (owner !== this.owner || revision !== this.revision) return null;
      const next = update(parsePlacePreferences(value));
      const safe = parsePlacePreferences(JSON.stringify({ version: 1, ...next }));
      await this.driver.set({ key, value: JSON.stringify({ version: 1, ...safe }) });
      return owner === this.owner && revision === this.revision ? safe : null;
    });
  }
  remember(place: NavigationPlace) {
    const safe = cleanPlace(place);
    if (!safe) return Promise.reject(new Error('El lugar no es válido.'));
    return this.change(current => ({ ...current, recent: [{ place: safe, visitedAt: Date.now() }, ...current.recent.filter(entry => placeKey(entry.place) !== placeKey(safe))].slice(0, 8) }));
  }
  save(place: NavigationPlace, label: PlaceLabel = 'saved') {
    const safe = cleanPlace(place);
    if (!safe || !['saved', 'home', 'work'].includes(label)) return Promise.reject(new Error('El lugar no es válido.'));
    return this.change(current => ({ ...current, saved: [{ place: safe, label }, ...current.saved.filter(entry => label === 'saved' ? entry.label !== label || placeKey(entry.place) !== placeKey(safe) : entry.label !== label)].slice(0, 20) }));
  }
  remove(place: NavigationPlace, label: PlaceLabel = 'saved') {
    return this.change(current => ({ ...current, saved: current.saved.filter(entry => entry.label !== label || placeKey(entry.place) !== placeKey(place)) }));
  }
  clearRecent() { return this.change(current => ({ ...current, recent: [] })); }
}
