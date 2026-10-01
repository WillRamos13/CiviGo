export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeState = { theme: ThemePreference; resolvedTheme: ResolvedTheme };

export const THEME_STORAGE_KEY = 'civigo-theme';
export const INITIAL_THEME: ThemeState = Object.freeze({ theme: 'system', resolvedTheme: 'light' });

export function parseThemePreference(value: unknown): ThemePreference {
    return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
    return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

// A fixed, parser-executed script sets the theme before the first paint. No user values are interpolated.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var preference="system";try{var saved=localStorage.getItem("civigo-theme");if(saved==="light"||saved==="dark"||saved==="system")preference=saved;}catch(_){}var dark=false;try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(_){}var theme=preference==="system"?(dark?"dark":"light"):preference;document.documentElement.setAttribute("data-theme",theme);document.documentElement.style.colorScheme=theme;})();`;

export interface ThemeEnvironment {
    readPreference(): unknown;
    writePreference(theme: ThemePreference): void;
    systemDark(): boolean;
    applyTheme(theme: ResolvedTheme): void;
    onSystemChange(listener: () => void): () => void;
    onStorageChange(listener: (value: unknown) => void): () => void;
}

export class ThemeController {
    private state: ThemeState = INITIAL_THEME;
    private listeners = new Set<() => void>();
    private environment?: ThemeEnvironment;
    private stopSystem?: () => void;
    private stopStorage?: () => void;

    getSnapshot = (): ThemeState => this.state;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    connect(environment: ThemeEnvironment): () => void {
        this.disconnect();
        this.environment = environment;
        let saved: unknown;
        try { saved = environment.readPreference(); } catch { /* Storage may be blocked. */ }
        this.applyPreference(parseThemePreference(saved));
        this.stopStorage = environment.onStorageChange(value => {
            if (this.environment === environment) this.applyPreference(parseThemePreference(value));
        });
        return () => {
            if (this.environment === environment) this.disconnect();
        };
    }

    setTheme = (theme: ThemePreference): void => {
        const preference = parseThemePreference(theme);
        this.applyPreference(preference);
        try { this.environment?.writePreference(preference); } catch { /* Keep the selected theme for this visit. */ }
    };

    private disconnect(): void {
        this.stopSystem?.();
        this.stopStorage?.();
        this.stopSystem = undefined;
        this.stopStorage = undefined;
        this.environment = undefined;
    }

    private systemDark(): boolean {
        try { return this.environment?.systemDark() ?? false; } catch { return false; }
    }

    private applyPreference(theme: ThemePreference): void {
        this.stopSystem?.();
        this.stopSystem = undefined;
        this.publish(theme, resolveTheme(theme, this.systemDark()));
        const environment = this.environment;
        if (theme === 'system' && environment) {
            this.stopSystem = environment.onSystemChange(() => {
                if (this.environment === environment && this.state.theme === 'system') {
                    this.publish('system', resolveTheme('system', this.systemDark()));
                }
            });
        }
    }

    private publish(theme: ThemePreference, resolvedTheme: ResolvedTheme): void {
        this.environment?.applyTheme(resolvedTheme);
        if (theme === this.state.theme && resolvedTheme === this.state.resolvedTheme) return;
        this.state = { theme, resolvedTheme };
        this.listeners.forEach(listener => listener());
    }
}
