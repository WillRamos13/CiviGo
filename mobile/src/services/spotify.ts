import { StorageService } from './native';

const SPOTIFY_NAV_KEY = 'civigo:spotify_nav_enabled';
const preferenceListeners = new Set<(enabled: boolean) => void>();

export const SpotifyService = {
  /**
   * Check if the user has enabled Spotify integration during navigation.
   * Disabled by default (returns false unless explicitly set to 'true').
   */
  async isEnabled(): Promise<boolean> {
    try {
      const val = await StorageService.get(SPOTIFY_NAV_KEY);
      return val === 'true';
    } catch {
      return false;
    }
  },

  /**
   * Persist user's preference for Spotify integration.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await StorageService.set(SPOTIFY_NAV_KEY, enabled ? 'true' : 'false');
    preferenceListeners.forEach(listener => listener(enabled));
  },

  subscribe(listener: (enabled: boolean) => void): () => void {
    preferenceListeners.add(listener);
    return () => preferenceListeners.delete(listener);
  },

  /**
   * Open the native Spotify app or web player fallback.
   */
  openSpotify(): void {
    window.open('https://open.spotify.com', '_blank', 'noopener,noreferrer');
  },
};
