import { StorageService } from './native';

const SPOTIFY_NAV_KEY = 'civigo:spotify_nav_enabled';

export interface SpotifyTrackInfo {
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  isPlaying: boolean;
}

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
  },

  /**
   * Open the native Spotify app or web player fallback.
   */
  openSpotify(uri?: string): void {
    const target = uri || 'spotify:';
    try {
      window.location.href = target;
      // Fallback if app doesn't open
      setTimeout(() => {
        window.open('https://open.spotify.com', '_blank');
      }, 800);
    } catch {
      window.open('https://open.spotify.com', '_blank');
    }
  },
};
