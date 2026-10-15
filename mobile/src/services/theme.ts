export type Theme = 'light' | 'dark';
type ThemeStorage = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

export function preferredTheme(): Theme {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

/** Late preference reads cannot override a user's newer choice. */
export class ThemeController {
  private revision = 0;
  private lifecycle = 0;
  private writes: Promise<void> = Promise.resolve();
  constructor(private value: Theme, private storage: ThemeStorage, private changed: (theme: Theme) => void) {}
  initialize(): () => void {
    const lifecycle = ++this.lifecycle, revision = this.revision;
    void Promise.resolve().then(() => this.storage.get('civigo:theme')).then(saved => {
      if (this.lifecycle !== lifecycle || this.revision !== revision) return;
      if (saved === 'light' || saved === 'dark') { this.value = saved; this.changed(saved); }
    }).catch(() => {}); // A blocked preference store must not break the interface.
    return () => { if (this.lifecycle === lifecycle) this.lifecycle++; };
  }
  toggle(): void {
    this.revision++;
    const next = this.value === 'dark' ? 'light' : 'dark';
    this.value = next;
    this.changed(next);
    this.writes = this.writes.then(() => this.storage.set('civigo:theme', next)).catch(() => {});
  }
}
