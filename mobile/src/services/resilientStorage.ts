export interface PreferenceDriver {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type Intent = { version: 1; id: number; operation: 'set'; value: string } | { version: 1; id: number; operation: 'remove' };
const PREFIX = 'civigo:storage-journal:v1:';
const queues = new WeakMap<PreferenceDriver, Promise<void>>();
const durableWrites = new WeakMap<PreferenceDriver, Map<string, number>>();
let sequence = 0;
export const storageJournalKey = (key: string) => PREFIX + encodeURIComponent(key);

function ordered<T>(driver: PreferenceDriver, operation: () => Promise<T>): Promise<T> {
  const next = (queues.get(driver) ?? Promise.resolve()).then(operation);
  queues.set(driver, next.then(() => {}, () => {}));
  return next;
}
function parseIntent(raw: string | null): Intent | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Intent;
    if (value?.version === 1 && Number.isSafeInteger(value.id) && value.id > 0 &&
        (value.operation === 'remove' || value.operation === 'set' && typeof value.value === 'string')) return value;
  } catch { /* A corrupt security journal is not evidence that logout was cleared. */ }
  throw new Error('No se pudo recuperar el almacenamiento local de CiviGo.');
}
function journalValue(intent: Intent): string | null { return intent.operation === 'set' ? intent.value : null; }

/**
 * Write-ahead intents survive a new WebView/process. Native Preferences is the
 * normal store; a failed native operation remains visible through its journal.
 * A remove is a tombstone, never a false success that leaves an old native value.
 */
export class ResilientStorage {
  constructor(private preferences: PreferenceDriver, private fallback: () => JournalStorage) {}

  async get(key: string): Promise<string | null> {
    return ordered(this.preferences, async () => {
      const store = this.fallback(), journalKey = storageJournalKey(key);
      let raw = store.getItem(journalKey);
      // Older builds wrote this security flag to an alternate key on a native
      // failure. Keep a requested logout conservative across the upgrade too.
      if (raw === null && key === 'civigo:logout-pending' && store.getItem(key) === 'true') {
        raw = JSON.stringify({ version: 1, id: ++sequence, operation: 'set', value: 'true' } satisfies Intent);
        store.setItem(journalKey, raw);
      }
      if (raw !== null) return this.reconcile(key, store, raw);
      let result: { value: string | null };
      try {
        result = await this.preferences.get({ key });
        // A newer set/remove can arrive while the native read is in flight.
        const newer = store.getItem(journalKey);
        if (newer !== null) return journalValue(parseIntent(newer)!);
      } catch (error) {
        const newer = store.getItem(journalKey);
        if (newer !== null) return journalValue(parseIntent(newer)!);
        const legacy = store.getItem(key);
        if (legacy === null) throw new Error('No se pudo leer el almacenamiento local de CiviGo.');
        const migrated = JSON.stringify({ version: 1, id: ++sequence, operation: 'set', value: legacy } satisfies Intent);
        store.setItem(journalKey, migrated);
        return legacy;
      }
      if (result.value !== null && typeof result.value !== 'string') throw new Error('No se pudo leer el almacenamiento local de CiviGo.');
      // A cleanup error must not turn a successful native read into a legacy
      // fallback: that obsolete key may contain a trip/account already removed.
      store.removeItem(key);
      return result.value;
    });
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof value !== 'string') throw new Error('El valor de almacenamiento no es válido.');
    return this.write(key, { version: 1, id: ++sequence, operation: 'set', value });
  }
  async remove(key: string): Promise<void> {
    return this.write(key, { version: 1, id: ++sequence, operation: 'remove' });
  }

  private async write(key: string, intent: Intent): Promise<void> {
    const store = this.fallback(), journalKey = storageJournalKey(key);
    const previous = store.getItem(journalKey), raw = JSON.stringify(intent);
    let journaled = false;
    try {
      store.setItem(journalKey, raw); journaled = true;
      let writes = durableWrites.get(this.preferences);
      if (!writes) { writes = new Map(); durableWrites.set(this.preferences, writes); }
      writes.set(key, intent.id);
    }
    catch { /* A healthy native store can still commit when web quota is full. */ }
    return ordered(this.preferences, async () => {
      // A later durable intent can already have been reconciled by a queued
      // read, so its missing journal does not permit an older write to replay.
      // Conversely, a quota failure is not durability: still attempt the native
      // commit even when the previous operation has since removed its journal.
      if ((durableWrites.get(this.preferences)?.get(key) ?? 0) > intent.id) return;
      try { await this.apply(key, intent); }
      catch {
        if (journaled) return; // The latest intent is already durable.
        throw new Error('No se pudo guardar el almacenamiento local de CiviGo.');
      }
      try {
        store.removeItem(key);
        if (store.getItem(journalKey) === (journaled ? raw : previous)) store.removeItem(journalKey);
      } catch {
        // If native commit succeeded, retain the intent rather than deleting a
        // tombstone that could still be required to mask an alternate value.
        if (!journaled) throw new Error('No se pudo confirmar el almacenamiento local de CiviGo.');
      }
    });
  }

  private async reconcile(key: string, store: JournalStorage, raw: string): Promise<string | null> {
    const intent = parseIntent(raw)!;
    try {
      await this.apply(key, intent);
      store.removeItem(key);
      if (store.getItem(storageJournalKey(key)) === raw) store.removeItem(storageJournalKey(key));
    } catch { /* Keep a valid, durable intent while the native store is unavailable. */ }
    const latest = store.getItem(storageJournalKey(key));
    return latest !== null ? journalValue(parseIntent(latest)!) : journalValue(intent);
  }
  private async apply(key: string, intent: Intent): Promise<void> {
    if (intent.operation === 'set') await this.preferences.set({ key, value: intent.value });
    else await this.preferences.remove({ key });
  }
}
