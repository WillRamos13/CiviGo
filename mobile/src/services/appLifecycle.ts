import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { subscribeAsync } from './native-lifecycle';

type Listener = () => void;
export interface ActivityDriver {
  visible(): boolean;
  subscribeVisibility(callback: () => void): () => void;
  subscribeNative?: (callback: (active: boolean) => void) => () => void;
}

/** One shared lifecycle registration, even with several retained React views. */
export class AppActivityStore {
  private listeners = new Set<Listener>();
  private nativeActive = true;
  private active: boolean;
  private dispose: (() => void) | null = null;
  constructor(private driver: ActivityDriver) { this.active = driver.visible(); }
  getSnapshot = () => this.active;
  private update = () => {
    const next = this.nativeActive && this.driver.visible();
    if (next === this.active) return;
    this.active = next;
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    if (!this.dispose) {
      const stopVisibility = this.driver.subscribeVisibility(this.update);
      const stopNative = this.driver.subscribeNative?.(active => { this.nativeActive = active; this.update(); });
      this.dispose = () => { stopVisibility(); stopNative?.(); };
      this.update();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.dispose?.(); this.dispose = null; this.nativeActive = true; }
    };
  };
}

const appActivity = new AppActivityStore({
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  subscribeVisibility: callback => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  },
  subscribeNative: Capacitor.isNativePlatform() ? callback => subscribeAsync(async isActive => {
    let revision = 0;
    const handle = await App.addListener('appStateChange', state => { revision++; if (isActive()) callback(state.isActive); });
    const version = revision;
    void App.getState().then(state => { if (isActive() && revision === version) callback(state.isActive); })
      .catch(() => { /* Visibility events still provide a safe foreground fallback. */ });
    return () => handle.remove();
  }) : undefined,
});

export const subscribeAppActivity = appActivity.subscribe;
export const getAppActivity = appActivity.getSnapshot;
