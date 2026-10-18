import { api, post, patch, ApiError, advanceApiSession, invalidateAuthenticatedSession } from './api';
import { StorageService, discardRecoveredReportPhotos } from './native';
import { clearReportDraft } from './reportDraft';
import type { Usuario } from '../types';

export interface SessionState {
  usuario: Usuario | null;
  loading: boolean;
  offline: boolean;
}

export const INITIAL_SESSION: SessionState = { usuario: null, loading: true, offline: false };
const ACCOUNT_KEY = 'civigo:offline-account';
const LOGOUT_KEY = 'civigo:logout-pending';

export function canParticipate(usuario: Pick<Usuario, 'correoVerificado' | 'bloqueado'> | null | undefined): boolean {
  return usuario?.correoVerificado === true && usuario.bloqueado !== true;
}

type SessionStorage = Pick<typeof StorageService, 'get' | 'set' | 'remove'>;

/** A durable boolean queues cookie revocation; credentials never enter Preferences. */
export class SessionRevocation {
  private pending = false;
  private revision = 0;
  private mutations: Promise<unknown> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    readonly storage: SessionStorage,
    private endSession: () => Promise<unknown>,
    private networkAvailable: () => boolean
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation);
    this.mutations = next.catch(() => {});
    return next;
  }

  store<T>(operation: (storage: SessionStorage) => Promise<T>): Promise<T> {
    const next = this.writes.then(() => operation(this.storage));
    this.writes = next.catch(() => {});
    return next;
  }

  async hasPending(): Promise<boolean> {
    if (this.pending) return true;
    const stored = await this.store(async storage => (await storage.get(LOGOUT_KEY)) === 'true');
    return this.pending || stored;
  }

  markLogout(): Promise<void> {
    this.pending = true;
    this.revision++;
    advanceApiSession();
    return this.store(async storage => {
      await storage.set(LOGOUT_KEY, 'true');
      await storage.remove(ACCOUNT_KEY);
    });
  }

  private async revoke(): Promise<void> {
    while (await this.hasPending()) {
      this.pending = true;
      if (!this.networkAvailable()) throw new Error('Necesitas conexión para terminar de cerrar la sesión anterior.');
      const revision = this.revision;
      try { await this.endSession(); }
      catch (error) {
        // A 401 proves the old HttpOnly cookie no longer authenticates.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      if (revision !== this.revision) continue;
      await this.store(async storage => {
        if (revision === this.revision) {
          await storage.remove(LOGOUT_KEY);
          this.pending = false;
        }
      });
    }
  }

  flush(): Promise<void> { return this.serial(() => this.revoke()); }

  authenticate<T>(operation: () => Promise<T>, action = 'iniciar sesión'): Promise<T> {
    const revision = this.revision;
    const canceledMessage = action === 'iniciar sesión' ? 'El inicio de sesión fue cancelado.' : 'La operación fue cancelada.';
    return this.serial(async () => {
      if (!this.networkAvailable()) throw new Error(`Necesitas conexión para ${action}.`);
      await this.revoke();
      if (revision !== this.revision) throw new Error(canceledMessage);
      const result = await operation();
      // Logout may occur while Set-Cookie is still in flight. Its queued
      // revocation runs after this response, so that cookie cannot revive it.
      if (revision !== this.revision) throw new Error(canceledMessage);
      advanceApiSession();
      return result;
    });
  }
}

let currentNetworkStatus: boolean | null = null;
export function updateAuthNetworkStatus(connected: boolean) { currentNetworkStatus = connected; }

export const sessionRevocation = new SessionRevocation(
  StorageService,
  () => post('/users/logout', {}, { timeoutMs: 10000 }),
  () => currentNetworkStatus ?? (typeof navigator === 'undefined' || navigator.onLine !== false)
);

type SessionDependencies = {
  revocation?: SessionRevocation;
  loadUser?: (signal: AbortSignal) => Promise<Usuario>;
};

export class SessionController {
  private revision = 0;
  private request: AbortController | null = null;
  private state = INITIAL_SESSION;
  private revocation: SessionRevocation;
  private loadUser: (signal: AbortSignal) => Promise<Usuario>;

  constructor(
    private onChange: (state: SessionState) => void,
    private networkAvailable: () => boolean,
    dependencies: SessionDependencies = {}
  ) {
    this.revocation = dependencies.revocation || sessionRevocation;
    this.loadUser = dependencies.loadUser || (async signal => (await api<{ usuario: Usuario }>('/users/me', { signal })).usuario);
  }

  private update(state: SessionState) { this.state = state; this.onChange(state); }

  invalidate() { this.revision++; this.request?.abort(); this.request = null; }

  expire() {
    const accountId = this.state.usuario?.id;
    this.invalidate();
    advanceApiSession();
    this.update({ usuario: null, loading: false, offline: false });
    void this.revocation.store(async storage => {
      let cachedId: number | undefined;
      try { cachedId = JSON.parse((await storage.get(ACCOUNT_KEY)) || 'null')?.id; } catch {}
      await storage.remove(ACCOUNT_KEY);
      await clearReportDraft(accountId ?? cachedId, storage);
      await discardRecoveredReportPhotos(accountId ?? cachedId);
    }).catch(() => {});
  }

  async getOfflineAccount(): Promise<Usuario | null> {
    try {
      if (await this.revocation.hasPending()) return null;
      const hint = await this.revocation.store(async storage => JSON.parse((await storage.get(ACCOUNT_KEY)) || 'null'));
      if (!hint || !Number.isInteger(hint.id) || hint.id <= 0 || typeof hint.nickname !== 'string' || !hint.nickname.trim()) return null;
      // A cached display name never grants email verification or agent powers.
      return {
        id: hint.id, nickname: hint.nickname.slice(0, 30), premium: hint.premium === true,
        ocultarAnuncios: hint.ocultarAnuncios === true, rol: 'USUARIO', telefono: '', correo: '',
        correoVerificado: false, credibilidad: null, monedas: 0,
      };
    } catch { return null; }
  }

  async recover() {
    if (this.request) return;
    if (this.state.offline || await this.revocation.hasPending()) await this.refresh();
  }

  async refresh() {
    this.invalidate();
    const revision = this.revision;
    const controller = new AbortController();
    this.request = controller;
    try {
      if (!this.networkAvailable()) {
        const usuario = await this.getOfflineAccount();
        if (revision === this.revision) this.update({ usuario, loading: false, offline: true });
        return;
      }
      // Never ask /me with a cookie the user already asked to revoke.
      await this.revocation.flush();
      if (revision !== this.revision) return;
      const usuario = await this.loadUser(controller.signal);
      if (revision !== this.revision) return;
      this.update({ usuario, loading: false, offline: false });
      await this.revocation.store(async storage => {
        if (revision !== this.revision) return;
        await storage.set(ACCOUNT_KEY, JSON.stringify({
          id: usuario.id, nickname: usuario.nickname, premium: usuario.premium,
          ocultarAnuncios: usuario.ocultarAnuncios === true,
        }));
      }).catch(() => {});
    } catch (error) {
      if (revision !== this.revision) return;
      const unavailable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      const usuario = unavailable ? await this.getOfflineAccount() : null;
      if (revision !== this.revision) return;
      this.update({ usuario, loading: false, offline: unavailable });
      if (!unavailable) await this.revocation.store(storage => storage.remove(ACCOUNT_KEY)).catch(() => {});
    } finally { if (revision === this.revision) this.request = null; }
  }

  async logout() {
    const accountId = this.state.usuario?.id;
    this.invalidate();
    const persisted = this.revocation.markLogout();
    const clearedDraft = this.revocation.store(storage => clearReportDraft(accountId, storage));
    const clearedPhoto = discardRecoveredReportPhotos(accountId);
    // This is synchronous: even a slow or unreachable server closes the UI now.
    this.update({ usuario: null, loading: false, offline: !this.networkAvailable() });
    try { await Promise.all([persisted, clearedDraft, clearedPhoto]); }
    catch { throw new Error('La sesión local se cerró. Reconecta antes de cerrar la app para revocar la sesión del servidor.'); }
    if (!this.networkAvailable()) return;
    try { await this.revocation.flush(); }
    catch { throw new Error('La sesión local se cerró. Se reintentará el cierre del servidor al recuperar la conexión.'); }
  }
}

async function confirmCookieSession(expected: Usuario): Promise<Usuario> {
  try {
    const response = await api<{ usuario: Usuario }>('/users/me');
    if (!response.usuario || response.usuario.id !== expected.id)
      throw new ApiError('No se pudo confirmar tu sesión en este dispositivo. Inténtalo nuevamente.', 401, 'SESSION_NOT_PERSISTED');
    return response.usuario;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw new ApiError('Tu dispositivo no pudo conservar la sesión. Revisa que permita las cookies de CiviGo e inténtalo nuevamente.', 401, 'SESSION_NOT_PERSISTED');
    throw error;
  }
}

export const AuthService = {
  async login(correo: string, password: string): Promise<Usuario> {
    return sessionRevocation.authenticate(async () => {
      let response: { usuario: Usuario };
      try { response = await post<{ usuario: Usuario }>('/users/login', { correo, password }); }
      catch (error) {
        if (error instanceof ApiError && error.code === 'ACCOUNT_BLOCKED') {
          // Backend creates a restricted session so blocked accounts can appeal.
          const current = await api<{ usuario: Usuario }>('/users/me');
          if (current.usuario?.correo?.trim().toLowerCase() !== correo.trim().toLowerCase() || current.usuario.bloqueado !== true)
            throw new ApiError('No se pudo confirmar tu sesión en este dispositivo. Inténtalo nuevamente.', 401, 'SESSION_NOT_PERSISTED');
          advanceApiSession();
        }
        throw error;
      }
      return confirmCookieSession(response.usuario);
    });
  },

  async register(data: {
    nombre: string;
    apellidos: string;
    nickname: string;
    correo: string;
    telefono: string;
    fechaNacimiento: string;
    password: string;
  }): Promise<Usuario> {
    return sessionRevocation.authenticate(async () => {
      const response = await post<{ usuario: Usuario }>('/users/register', data);
      return confirmCookieSession(response.usuario);
    });
  },

  async forgotPassword(correo: string): Promise<{ mensaje: string }> {
    return post<{ mensaje: string }>('/users/password/forgot', { correo });
  },

  async resetPassword(token: string, password: string): Promise<{ mensaje: string }> {
    // Reset clears the browser cookie too. A later login must wait for that
    // response before it can install and confirm a new session cookie.
    return sessionRevocation.authenticate(async () => {
      const result = await post<{ mensaje: string }>('/users/password/reset', { token, password });
      invalidateAuthenticatedSession();
      await sessionRevocation.store(storage => storage.remove(ACCOUNT_KEY)).catch(() => {});
      return result;
    }, 'restablecer la contraseña');
  },

  async changePassword(actual: string, password: string, signal?: AbortSignal): Promise<{ mensaje: string }> {
    const assertRequested = () => {
      if (signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    };
    assertRequested();
    return sessionRevocation.authenticate(async () => {
      assertRequested();
      // Once dispatched, keep the queue until the cookie-clearing response
      // finishes. Leaving the profile only cancels its UI operation; aborting
      // this request could release a later login before Set-Cookie arrives.
      const result = await post<{ mensaje: string }>('/users/password/change', { actual, password });
      invalidateAuthenticatedSession();
      await sessionRevocation.store(storage => storage.remove(ACCOUNT_KEY)).catch(() => {});
      return result;
    }, 'cambiar la contraseña');
  },

  async updateNickname(nickname: string, signal?: AbortSignal): Promise<Usuario> {
    const res = await patch<{ usuario: Usuario }>('/users/me', { nickname }, { signal });
    return res.usuario;
  },

  async updateAdPreference(ocultarAnuncios: boolean): Promise<Usuario> {
    const res = await patch<{ usuario: Usuario }>('/users/me', { ocultarAnuncios });
    return res.usuario;
  },

  async requestGoogleEmail(): Promise<{
    challengeId: string;
    projectId: string;
    expiresAt: string;
  }> {
    const response = await post<{ challengeId: string; projectId: string; expiresAt: string; usuario?: Usuario }>('/users/email/google/request');
    if (response.usuario?.correoVerificado) throw new ApiError('Tu correo ya está verificado.', 409, 'EMAIL_ALREADY_VERIFIED');
    return response;
  },

  async verifyGoogleEmail(challengeId: string, idToken: string): Promise<Usuario> {
    const res = await post<{ usuario: Usuario }>('/users/email/google/verify', {
      challengeId,
      idToken,
    });
    return res.usuario;
  },

  async requestPhoneRecovery(data: {
    telefonoNuevo: string;
    motivo: string;
    adjuntoId?: string;
  }, signal?: AbortSignal): Promise<unknown> {
    return post('/users/recovery', data, { signal });
  },
};
