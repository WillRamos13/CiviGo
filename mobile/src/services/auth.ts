import { api, post, patch, ApiError } from './api';
import { StorageService } from './native';
import type { Usuario } from '../types';

export interface SessionState {
  usuario: Usuario | null;
  loading: boolean;
  offline: boolean;
}

export const INITIAL_SESSION: SessionState = {
  usuario: null,
  loading: true,
  offline: false,
};

export function canParticipate(
  usuario: Pick<Usuario, 'correoVerificado' | 'bloqueado'> | null | undefined
): boolean {
  return usuario?.correoVerificado === true && usuario.bloqueado !== true;
}

export class SessionController {
  private revision = 0;
  private request: AbortController | null = null;
  private pendingLogout = false;
  private state = INITIAL_SESSION;
  private onChange: (state: SessionState) => void;
  private networkAvailable: () => boolean;

  constructor(
    onChange: (state: SessionState) => void,
    networkAvailable: () => boolean
  ) {
    this.onChange = onChange;
    this.networkAvailable = networkAvailable;
  }

  private update(state: SessionState) {
    this.state = state;
    this.onChange(state);
  }

  invalidate() {
    this.revision++;
    this.request?.abort();
    this.request = null;
  }

  async getOfflineAccount(): Promise<Usuario | null> {
    try {
      const hint = JSON.parse((await StorageService.get('civigo:offline-account')) || 'null');
      if (!hint || !Number.isInteger(hint.id) || !hint.nickname) return null;
      return {
        id: hint.id,
        nickname: hint.nickname,
        premium: !!hint.premium,
        ocultarAnuncios: !!hint.ocultarAnuncios,
        rol: hint.rol || 'USUARIO',
        telefono: '',
        correo: hint.correo || '',
        correoVerificado: !!hint.correoVerificado,
        credibilidad: null,
        monedas: hint.monedas || 0,
      };
    } catch {
      return null;
    }
  }

  async refresh() {
    this.invalidate();
    const revision = this.revision;
    const controller = new AbortController();
    this.request = controller;

    if (!this.networkAvailable()) {
      this.request = null;
      const offline = await this.getOfflineAccount();
      this.update({ usuario: offline, loading: false, offline: true });
      return;
    }

    try {
      const data = await api<{ usuario: Usuario }>('/users/me', {
        signal: controller.signal,
      });
      if (revision !== this.revision) return;
      const usuario = data.usuario;
      this.update({ usuario, loading: false, offline: false });

      await StorageService.set(
        'civigo:offline-account',
        JSON.stringify({
          id: usuario.id,
          nickname: usuario.nickname,
          premium: usuario.premium,
          ocultarAnuncios: usuario.ocultarAnuncios,
          rol: usuario.rol,
          correo: usuario.correo,
          correoVerificado: usuario.correoVerificado,
          monedas: usuario.monedas,
        })
      );
    } catch (error) {
      if (revision !== this.revision) return;
      const offline = await this.getOfflineAccount();
      const isNetError = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      this.update({
        usuario: isNetError ? offline : null,
        loading: false,
        offline: isNetError,
      });
      if (!isNetError) {
        await StorageService.remove('civigo:offline-account');
      }
    } finally {
      if (revision === this.revision) this.request = null;
    }
  }

  async logout() {
    this.invalidate();
    try {
      await post('/users/logout');
    } catch {
      // Ignore network errors on logout
    }
    await StorageService.remove('civigo:offline-account');
    this.update({ usuario: null, loading: false, offline: !this.networkAvailable() });
  }
}

export const AuthService = {
  async login(correo: string, password: string): Promise<Usuario> {
    const res = await post<{ usuario: Usuario }>('/users/login', { correo, password });
    return res.usuario;
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
    const res = await post<{ usuario: Usuario }>('/users/register', data);
    return res.usuario;
  },

  async forgotPassword(correo: string): Promise<{ mensaje: string }> {
    return post<{ mensaje: string }>('/users/password/forgot', { correo });
  },

  async resetPassword(token: string, password: string): Promise<{ mensaje: string }> {
    return post<{ mensaje: string }>('/users/password/reset', { token, password });
  },

  async changePassword(actual: string, password: string): Promise<{ mensaje: string }> {
    return post<{ mensaje: string }>('/users/password/change', { actual, password });
  },

  async updateNickname(nickname: string): Promise<Usuario> {
    const res = await patch<{ usuario: Usuario }>('/users/me', { nickname });
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
    return post('/users/email/google/request');
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
  }): Promise<unknown> {
    return post('/users/recovery', data);
  },
};
