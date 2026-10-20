export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
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
  private preference: ThemePreference = 'system';
  constructor(private value: Theme, private storage: ThemeStorage, private changed: (theme: Theme, preference?: ThemePreference) => void) {}
  initialize(): () => void {
    const lifecycle = ++this.lifecycle, revision = this.revision;
    let query: MediaQueryList | null = null;
    const systemChanged = () => {
      if (this.lifecycle !== lifecycle || this.preference !== 'system') return;
      this.value = preferredTheme(); this.changed(this.value, this.preference);
    };
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
      if (query.addEventListener) query.addEventListener('change', systemChanged);
      else query.addListener(systemChanged);
    } catch { /* Older WebViews keep an explicit choice without system events. */ }
    void Promise.resolve().then(() => this.storage.get('civigo:theme')).then(saved => {
      if (this.lifecycle !== lifecycle || this.revision !== revision) return;
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        this.preference = saved;
        this.value = saved === 'system' ? preferredTheme() : saved;
        this.changed(this.value, this.preference);
      }
    }).catch(() => {}); // A blocked preference store must not break the interface.
    return () => {
      if (this.lifecycle === lifecycle) this.lifecycle++;
      if (query?.removeEventListener) query.removeEventListener('change', systemChanged);
      else query?.removeListener(systemChanged);
    };
  }
  toggle(): void {
    this.setPreference(this.value === 'dark' ? 'light' : 'dark');
  }
  setPreference(preference: ThemePreference): void {
    if (preference !== 'system' && preference !== 'light' && preference !== 'dark') return;
    this.revision++;
    this.preference = preference;
    this.value = preference === 'system' ? preferredTheme() : preference;
    this.changed(this.value, preference);
    this.writes = this.writes.then(() => this.storage.set('civigo:theme', preference)).catch(() => {});
  }
}
