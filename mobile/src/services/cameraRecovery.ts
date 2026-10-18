interface Storage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
interface PendingPhoto { ownerId: number; nonce: string; createdAt: number }
export interface RecoveredReportPhoto extends PendingPhoto { webPath: string; format: string }
const PENDING = 'civigo:report-camera-pending';
const RECOVERED = 'civigo:report-camera-recovered';
const MAX_AGE = 15 * 60 * 1000;

/** A restored activity result never becomes another account's attachment. */
export class ReportCameraRecovery {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private storage: Storage, private origin: string, private now = Date.now) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work);
    this.writes = next.catch(() => {});
    return next;
  }
  private async value(key: string): Promise<unknown> {
    const raw = await this.storage.get(key);
    if (!raw || raw.length > 4096) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  private valid(value: unknown): value is PendingPhoto {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<PendingPhoto>;
    return Number.isSafeInteger(item.ownerId) && item.ownerId! > 0 && typeof item.nonce === 'string' &&
      /^[a-f0-9]{32}$/.test(item.nonce) && Number.isFinite(item.createdAt) &&
      item.createdAt! <= this.now() + 5000 && this.now() - item.createdAt! <= MAX_AGE;
  }
  private localPhoto(value: unknown): value is { webPath: string; format: string } {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<RecoveredReportPhoto>;
    if (typeof item.webPath !== 'string' || item.webPath.length > 2048 || typeof item.format !== 'string' || !['jpeg', 'jpg', 'png', 'gif', 'webp'].includes(item.format)) return false;
    try {
      const url = new URL(item.webPath);
      return url.origin === this.origin && url.pathname.startsWith('/_capacitor_file_/') && !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
  }
  snapshot(): Promise<string | null> {
    return this.serial(async () => { const value = await this.value(PENDING); return this.valid(value) ? value.nonce : null; });
  }

  begin(ownerId: number): Promise<string> {
    return this.serial(async () => {
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('Inicia sesión antes de tomar la fotografía.');
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      await this.storage.set(PENDING, JSON.stringify({ ownerId, nonce, createdAt: this.now() }));
      await this.storage.remove(RECOVERED);
      return nonce;
    });
  }
  finish(nonce: string): Promise<void> {
    return this.serial(async () => { const value = await this.value(PENDING); if (this.valid(value) && value.nonce === nonce) await this.storage.remove(PENDING); });
  }
  restore(event: { pluginId?: string; methodName?: string; success?: boolean; data?: unknown }, startupNonce: string | null): Promise<void> {
    return this.serial(async () => {
      if (event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return;
      const pending = await this.value(PENDING);
      // The retained Android event belongs to the capture present at startup,
      // never a newer capture started while native listener setup was pending.
      if (!this.valid(pending) || pending.nonce !== startupNonce) return;
      await this.storage.remove(PENDING);
      if (event.success !== true || !this.localPhoto(event.data)) return;
      await this.storage.set(RECOVERED, JSON.stringify({ ...pending, webPath: event.data.webPath, format: event.data.format }));
    });
  }
  read(ownerId: number | undefined): Promise<RecoveredReportPhoto | null> {
    return this.serial(async () => {
      const photo = await this.value(RECOVERED);
      if (!this.valid(photo) || !this.localPhoto(photo)) { await this.storage.remove(RECOVERED); return null; }
      return photo.ownerId === ownerId ? photo : null;
    });
  }
  consume(ownerId: number, nonce: string): Promise<void> {
    return this.serial(async () => {
      const photo = await this.value(RECOVERED);
      if (this.valid(photo) && photo.ownerId === ownerId && photo.nonce === nonce) await this.storage.remove(RECOVERED);
    });
  }
  discard(ownerId: number | undefined): Promise<void> {
    return this.serial(async () => {
      for (const key of [PENDING, RECOVERED]) {
        const value = await this.value(key);
        if (!this.valid(value) || value.ownerId === ownerId) await this.storage.remove(key);
      }
    });
  }
}
