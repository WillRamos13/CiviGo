import type { Usuario } from './lib/types';
export type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: { message: string; status: number; code?: string } };
declare global {
  interface Window {
    civigoDesktop: {
      login: (value: { correo: string; password: string }) => Promise<BridgeResult<Usuario>>;
      session: () => Promise<BridgeResult<Usuario | null>>;
      logout: () => Promise<BridgeResult<void>>;
      request: (value: { route: string; method: string; body?: string; requestId?: string }) => Promise<BridgeResult<unknown>>;
      cancelRead: (requestId: string) => Promise<BridgeResult<void>>;
      upload: (value: { name: string; mimeType: string; bytes: Uint8Array; privado: boolean; tipo: string }) => Promise<BridgeResult<unknown>>;
      download: (id: string) => Promise<BridgeResult<{ guardado?: boolean; cancelado?: boolean }>>;
      openPublic: (path: string) => Promise<BridgeResult<void>>;
      onSession: (listener: (user: Usuario | null) => void) => () => void;
    };
  }
}
