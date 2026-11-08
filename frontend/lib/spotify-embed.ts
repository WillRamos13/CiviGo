export type SpotifyContent = { uri: string; url: string };
const contentPattern = /^(track|album|playlist|episode|show):([a-zA-Z0-9]{22})$/;

export function parseSpotifyContent(input: string): SpotifyContent | null {
  let path = input.trim().replace(/^spotify:/, '');
  if (!input.trim().startsWith('spotify:')) {
    try {
      const url = new URL(input.trim());
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return null;
      path = url.pathname.replace(/^\/(?:intl-[a-z]{2}(?:-[A-Z]{2})?\/)?/, '').replace(/\/$/, '').replace('/', ':');
    } catch { return null; }
  }
  const match = contentPattern.exec(path);
  return match ? { uri: `spotify:${match[1]}:${match[2]}`, url: `https://open.spotify.com/${match[1]}/${match[2]}` } : null;
}

export type SpotifyController = {
  play(): void; pause(): void; destroy(): void;
  addListener(event: 'playback_update', callback: (event: { data: { isPaused: boolean; isBuffering?: boolean } }) => void): void;
};
type SpotifyIframeApi = { createController(element: HTMLElement, options: { uri: string; width: string; height: number; theme: string }, callback: (controller: SpotifyController) => void): void };
declare global { interface Window { onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void } }
let apiPromise: Promise<SpotifyIframeApi> | null = null;

// No account tokens, client secret, autoplay or network request before opting in.
export function loadSpotifyEmbed(): Promise<SpotifyIframeApi> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onSpotifyIframeApiReady;
    let done = false;
    const fail = () => {
      if (done) return; done = true; clearTimeout(timeout); script.remove(); window.onSpotifyIframeApiReady = previous; apiPromise = null;
      reject(new Error('Spotify no pudo cargarse. Comprueba tu conexión o abre Spotify.'));
    };
    const timeout = setTimeout(fail, 20000);
    window.onSpotifyIframeApiReady = api => {
      if (done) return; done = true; clearTimeout(timeout); previous?.(api); resolve(api);
    };
    script.src = 'https://open.spotify.com/embed/iframe-api/v1'; script.async = true; script.onerror = fail; document.head.append(script);
  });
  return apiPromise;
}
