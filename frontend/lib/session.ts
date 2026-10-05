import type { Usuario } from './types';
export interface BrowserStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface SessionState { usuario: Usuario | null; loading: boolean; offline: boolean; }
export const INITIAL_SESSION: SessionState = { usuario: null, loading: true, offline: false };
export function canParticipate(usuario: Pick<Usuario, 'correoVerificado' | 'bloqueado'> | null | undefined) {
    return usuario?.correoVerificado === true && usuario.bloqueado !== true;
}
type Dependencies = {
    storage: BrowserStorage;
    loadUser: (signal: AbortSignal) => Promise<Usuario>;
    endSession: () => Promise<void>;
    networkAvailable: () => boolean;
    isUnavailable: (error: unknown) => boolean;
    onChange: (state: SessionState) => void;
};
// A late /me response must never restore an account after logout or account change.
export class SessionController {
    private revision = 0;
    private request: AbortController | null = null;
    private pendingLogout = false;
    private logoutTask: Promise<void> | null = null;
    private state = INITIAL_SESSION;
    constructor(private dependencies: Dependencies) {}
    private update(state: SessionState) { this.state = state; this.dependencies.onChange(state); }
    invalidate() { this.revision++; this.request?.abort(); this.request = null; }
    private hasPendingLogout() {
        try { return this.pendingLogout || this.dependencies.storage.getItem('civigo:logout-pending') === 'true'; }
        catch { return this.pendingLogout; }
    }
    private offlineAccount(): Usuario | null {
        if (this.hasPendingLogout()) return null;
        try {
            const hint = JSON.parse(this.dependencies.storage.getItem('civigo:offline-account') || 'null');
            if (!hint || !Number.isInteger(hint.id) || hint.id <= 0 || typeof hint.nickname !== 'string' || !hint.nickname.trim()) return null;
            return { id: hint.id, nickname: hint.nickname.slice(0, 30), premium: hint.premium === true, ocultarAnuncios: hint.ocultarAnuncios === true, rol: 'USUARIO', telefono: '', correo: '', correoVerificado: false, credibilidad: null, monedas: 0 };
        } catch { return null; }
    }
    private flushLogout() {
        if (this.logoutTask) return this.logoutTask;
        if (!this.hasPendingLogout()) return Promise.resolve();
        this.pendingLogout = true;
        this.logoutTask = this.dependencies.endSession().then(() => {
            this.pendingLogout = false;
            try { this.dependencies.storage.removeItem('civigo:logout-pending'); } catch {}
        }).finally(() => { this.logoutTask = null; });
        return this.logoutTask;
    }
    async refresh() {
        this.invalidate();
        const revision = this.revision, controller = new AbortController();
        this.request = controller;
        if (!this.dependencies.networkAvailable()) { this.update({ usuario: this.offlineAccount(), loading: false, offline: true }); return; }
        try {
            await this.flushLogout();
            if (revision !== this.revision) return;
            const usuario = await this.dependencies.loadUser(controller.signal);
            if (revision !== this.revision) return;
            this.update({ usuario, loading: false, offline: false });
            try { this.dependencies.storage.setItem('civigo:offline-account', JSON.stringify({ id: usuario.id, nickname: usuario.nickname, premium: usuario.premium, ocultarAnuncios: usuario.ocultarAnuncios === true })); } catch {}
        } catch (error) {
            if (revision !== this.revision) return;
            const unavailable = this.dependencies.isUnavailable(error);
            this.update({ usuario: unavailable ? this.offlineAccount() : null, loading: false, offline: unavailable });
            if (!unavailable) try { this.dependencies.storage.removeItem('civigo:offline-account'); } catch {}
        }
    }
    async prepareLogin() {
        this.invalidate();
        if (!this.dependencies.networkAvailable()) throw new Error('Necesitas conexión para iniciar sesión.');
        // Finish queued revocation before login creates another server session.
        await this.flushLogout();
    }
    async logout() {
        const accountId = this.state.usuario?.id;
        this.invalidate(); this.pendingLogout = true;
        let persisted = false;
        try { this.dependencies.storage.setItem('civigo:logout-pending', 'true'); persisted = true; } catch {}
        try { if (accountId) this.dependencies.storage.removeItem(`civigo:rutas:${accountId}`); } catch {}
        try { this.dependencies.storage.removeItem('civigo:offline-account'); } catch {}
        this.update({ usuario: null, loading: false, offline: !this.dependencies.networkAvailable() });
        if (!this.dependencies.networkAvailable()) {
            if (!persisted) throw new Error('La sesión local se cerró. Reconecta antes de cerrar esta página para revocar también la sesión del servidor.');
            return;
        }
        try { await this.flushLogout(); }
        catch { throw new Error('La sesión local se cerró. CiviGo reintentará cerrar la sesión del servidor al recuperar la conexión.'); }
    }
}
