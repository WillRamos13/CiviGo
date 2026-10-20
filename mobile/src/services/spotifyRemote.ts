import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SpotifyRemoteCapabilities { platform: string; configured: boolean; installed: boolean; connected: boolean; sdkVersion?: string; }
export interface SpotifyTrack { name: string; artist: string; uri: string; durationMs: number; artwork?: string; }
export interface SpotifyPlaybackState { connected: boolean; paused: boolean; positionMs: number; updatedAt: number; canSkipNext: boolean; canSkipPrevious: boolean; track: SpotifyTrack | null; }
export type SpotifyCommand = 'pause' | 'resume' | 'next' | 'previous';
export interface SpotifyRemoteDriver {
  supported(): boolean;
  capabilities(): Promise<SpotifyRemoteCapabilities>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  connect(options: { userInitiated: boolean }): Promise<unknown>;
  disconnect(): Promise<void>;
  command(options: { action: SpotifyCommand }): Promise<void>;
  getState(): Promise<unknown>;
  addListener(name: 'playerState', listener: (state: unknown) => void): Promise<PluginListenerHandle>;
}
type NativeSpotifyRemote = Omit<SpotifyRemoteDriver, 'supported'>;
const native = registerPlugin<NativeSpotifyRemote>('SpotifyRemote');
const nativeDriver: SpotifyRemoteDriver = {
  supported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SpotifyRemote'),
  capabilities: () => native.capabilities(), setEnabled: options => native.setEnabled(options), connect: options => native.connect(options),
  disconnect: () => native.disconnect(), command: options => native.command(options), getState: () => native.getState(), addListener: (name, listener) => native.addListener(name, listener),
};
export const disconnectedSpotifyState = (): SpotifyPlaybackState => ({ connected: false, paused: true, positionMs: 0, updatedAt: 0, canSkipNext: false, canSkipPrevious: false, track: null });

export function parseSpotifyState(value: unknown): SpotifyPlaybackState {
  if (!value || typeof value !== 'object') throw new Error('Spotify no devolvió un estado válido.');
  const state = value as Record<string, unknown>;
  if (typeof state.connected !== 'boolean') throw new Error('Spotify no devolvió un estado válido.');
  if (!state.connected) return disconnectedSpotifyState();
  if (typeof state.paused !== 'boolean' || typeof state.positionMs !== 'number' || !Number.isFinite(state.positionMs) || state.positionMs < 0 ||
      typeof state.updatedAt !== 'number' || !Number.isFinite(state.updatedAt) || state.updatedAt < 0 ||
      typeof state.canSkipNext !== 'boolean' || typeof state.canSkipPrevious !== 'boolean') throw new Error('Spotify no devolvió un estado válido.');
  let track: SpotifyTrack | null = null;
  if (state.track != null) {
    if (typeof state.track !== 'object') throw new Error('Spotify no devolvió una pista válida.');
    const item = state.track as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 500 ||
        typeof item.artist !== 'string' || item.artist.length > 500 || typeof item.uri !== 'string' || !/^spotify:(track|episode):[a-zA-Z0-9]+$/.test(item.uri) ||
        typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0) throw new Error('Spotify no devolvió una pista válida.');
    const artwork = typeof item.artwork === 'string' && item.artwork.length <= 100000 && /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+=*$/.test(item.artwork) ? item.artwork : undefined;
    track = { name: item.name, artist: item.artist, uri: item.uri, durationMs: item.durationMs, ...(artwork ? { artwork } : {}) };
  }
  return { connected: true, paused: state.paused, positionMs: state.positionMs, updatedAt: state.updatedAt, canSkipNext: state.canSkipNext, canSkipPrevious: state.canSkipPrevious, track };
}

/** No optimistic playback: only SDK states change track/paused in the UI. */
export class SpotifyRemoteController {
  private revision = 0;
  private listener: PluginListenerHandle | null = null;
  private enabled = false;
  private connecting = false;
  private state = disconnectedSpotifyState();
  private observers = new Set<(state: SpotifyPlaybackState) => void>();
  constructor(private driver: SpotifyRemoteDriver = nativeDriver) {}
  subscribe(listener: (state: SpotifyPlaybackState) => void): () => void { this.observers.add(listener); return () => this.observers.delete(listener); }
  snapshot() { return this.state; }
  private emit(state: SpotifyPlaybackState) { this.state = state; this.observers.forEach(listener => listener(state)); }
  async capabilities(): Promise<SpotifyRemoteCapabilities> {
    if (!this.driver.supported()) return { platform: 'unsupported', configured: false, installed: false, connected: false };
    const value = await this.driver.capabilities();
    if (!value || typeof value.configured !== 'boolean' || typeof value.installed !== 'boolean' || typeof value.connected !== 'boolean') throw new Error('No se pudo comprobar la conexión con Spotify.');
    return value;
  }
  async connect(explicitUserAction: boolean): Promise<void> {
    if (!explicitUserAction) throw new Error('Conecta Spotify con su botón para autorizarlo.');
    if (this.connecting) throw new Error('Ya hay una conexión con Spotify en curso.');
    const owned = ++this.revision;
    this.connecting = true; this.enabled = true;
    try {
      const previousListener = this.listener; this.listener = null;
      if (previousListener) await previousListener.remove();
      if (owned !== this.revision) return;
      const capabilities = await this.capabilities();
      if (owned !== this.revision) return;
      if (!capabilities.configured) throw new Error('La integración de Spotify todavía no está configurada.');
      if (!capabilities.installed) throw new Error('Instala e inicia sesión en la aplicación oficial de Spotify.');
      await this.driver.setEnabled({ enabled: true });
      if (owned !== this.revision) return;
      const listener = await this.driver.addListener('playerState', value => {
        if (owned !== this.revision || !this.enabled) return;
        try { this.emit(parseSpotifyState(value)); } catch { this.emit(disconnectedSpotifyState()); }
      });
      if (owned !== this.revision) { await listener.remove(); return; }
      this.listener = listener;
      const value = await this.driver.connect({ userInitiated: true });
      if (owned === this.revision && this.enabled) {
        const received = parseSpotifyState(value);
        if (received.updatedAt >= this.state.updatedAt) this.emit(received);
      }
    } catch (error) {
      if (owned !== this.revision) return;
      await this.disconnect().catch(() => {});
      throw error;
    } finally { if (owned === this.revision) this.connecting = false; }
  }
  async command(action: SpotifyCommand): Promise<void> {
    if (!['pause', 'resume', 'next', 'previous'].includes(action)) throw new Error('El control de Spotify no es válido.');
    if (!this.enabled || !this.state.connected || !this.state.track) throw new Error('Conecta Spotify para usar sus controles.');
    if (action === 'next' && !this.state.canSkipNext || action === 'previous' && !this.state.canSkipPrevious) throw new Error('Spotify no permite este control en la pista actual.');
    const owned = this.revision;
    await this.driver.command({ action });
    if (owned !== this.revision) return;
    // A successful command does not imply that playback changed. The official
    // subscription supplies the next observed state, without a pretend toggle.
  }
  async disconnect(): Promise<void> {
    this.revision++; this.enabled = false; this.connecting = false;
    const listener = this.listener; this.listener = null;
    this.emit(disconnectedSpotifyState());
    const operations: Promise<unknown>[] = [];
    if (listener) operations.push(listener.remove());
    if (this.driver.supported()) operations.push(this.driver.disconnect());
    await Promise.allSettled(operations);
  }
}

/** Used on explicit opt-out even if no player view is currently mounted. */
export async function disableNativeSpotify(): Promise<void> {
  if (nativeDriver.supported()) await nativeDriver.setEnabled({ enabled: false });
}
