// Public-client OAuth: the only persisted value is a short-lived, one-use PKCE transaction.
export const SPOTIFY_TRANSACTION_KEY = "civigo.spotify.pkce";
const MAX_TRANSACTION_AGE = 10 * 60 * 1000;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Transaction = {
  state: string;
  verifier: string;
  createdAt: number;
  redirectUri: string;
  clientId: string;
};
export type SpotifyPlayback = {
  playing: boolean;
  name: string;
  artists: string;
  image: string | null;
  url: string | null;
  device: string | null;
};
export type SpotifySnapshot = {
  connected: boolean;
  playback: SpotifyPlayback | null;
  message: string;
  busy: boolean;
};
const safeUrl = (value: unknown, host: string) => {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" &&
      (u.hostname === host || u.hostname.endsWith("." + host))
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export function spotifyRedirect(origin: string) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.hostname === "127.0.0.1")
  )
    throw Error("Spotify requiere HTTPS o 127.0.0.1 para la conexión local.");
  return url.origin + "/integraciones/spotify";
}
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
export async function spotifyAuthorization(
  clientId: string,
  origin: string,
  storage: StorageLike,
  controls = false,
  now = Date.now(),
) {
  if (!/^[a-zA-Z0-9]{16,100}$/.test(clientId))
    throw Error("La conexión con Spotify no está configurada.");
  const transaction: Transaction = {
    state: random(),
    verifier: random(),
    createdAt: now,
    redirectUri: spotifyRedirect(origin),
    clientId,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(transaction.verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  storage.setItem(SPOTIFY_TRANSACTION_KEY, JSON.stringify(transaction));
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: transaction.redirectUri,
    state: transaction.state,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: controls
      ? "user-read-playback-state user-modify-playback-state"
      : "user-read-playback-state",
  }).toString();
  return url.href;
}
export function consumeSpotifyTransaction(
  callback: string,
  storage: StorageLike,
  now = Date.now(),
): Transaction & { code: string } {
  const raw = storage.getItem(SPOTIFY_TRANSACTION_KEY);
  storage.removeItem(SPOTIFY_TRANSACTION_KEY);
  const url = new URL(callback);
  let tx: Transaction;
  try {
    tx = JSON.parse(raw ?? "null");
  } catch {
    throw Error("La conexión caducó. Vuelve a vincular Spotify.");
  }
  if (
    !tx ||
    typeof tx.state !== "string" ||
    typeof tx.verifier !== "string" ||
    !/^[a-f0-9]{64}$/.test(tx.verifier) ||
    typeof tx.createdAt !== "number" ||
    now - tx.createdAt < 0 ||
    now - tx.createdAt > MAX_TRANSACTION_AGE ||
    url.searchParams.get("state") !== tx.state ||
    url.origin + url.pathname !== tx.redirectUri
  )
    throw Error("La conexión caducó o no pertenece a esta sesión.");
  if (url.searchParams.has("error"))
    throw Error("No se autorizó la conexión con Spotify.");
  const code = url.searchParams.get("code");
  if (!code || code.length > 1500)
    throw Error("Spotify no devolvió una autorización válida.");
  return { ...tx, code };
}
export function spotifyPlayback(value: unknown): SpotifyPlayback | null {
  const data = value as {
    is_playing?: boolean;
    item?: {
      name?: string;
      artists?: { name?: string }[];
      show?: { name?: string };
      album?: { images?: { url?: string }[] };
      images?: { url?: string }[];
      external_urls?: { spotify?: string };
    };
    device?: { id?: string };
  };
  if (!data?.item || typeof data.item.name !== "string") return null;
  return {
    playing: data.is_playing === true,
    name: data.item.name.slice(0, 250),
    artists: (
      data.item.artists
        ?.map((a) => a.name)
        .filter(Boolean)
        .join(", ") ||
      data.item.show?.name ||
      "Spotify"
    ).slice(0, 250),
    image: safeUrl(
      (data.item.album?.images ?? data.item.images)?.[0]?.url,
      "scdn.co",
    ),
    url: safeUrl(data.item.external_urls?.spotify, "open.spotify.com"),
    device: typeof data.device?.id === "string" ? data.device.id : null,
  };
}
export class SpotifyAccount {
  private token = "";
  private refreshToken = "";
  private expires = 0;
  private clientId = "";
  private epoch = 0;
  private retryAt = 0;
  private refreshRequest: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SpotifySnapshot = {
    connected: false,
    playback: null,
    message: "",
    busy: false,
  };
  constructor(
    private request: typeof fetch = (...args) => fetch(...args),
    private clock = () => Date.now(),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(value: Partial<SpotifySnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    this.listeners.forEach((fn) => fn());
  }
  disconnect() {
    this.epoch++;
    this.token = "";
    this.refreshToken = "";
    this.expires = 0;
    this.clientId = "";
    this.retryAt = 0;
    this.refreshRequest = null;
    this.publish({
      connected: false,
      playback: null,
      message: "Cuenta desvinculada de esta sesión.",
      busy: false,
    });
  }
  private async tokens(body: URLSearchParams, epoch: number) {
    const response = await this.request(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15000),
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw Error(
        "Spotify no pudo autorizar la sesión. Vuelve a vincular tu cuenta.",
      );
    const data = await response.json();
    if (epoch !== this.epoch) return;
    if (
      typeof data.access_token !== "string" ||
      data.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw Error("Spotify devolvió una sesión no válida.");
    this.token = data.access_token;
    this.refreshToken =
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : this.refreshToken;
    this.expires = this.clock() + Math.min(data.expires_in, 3600) * 1000;
    this.publish({ connected: true, message: "" });
  }
  async complete(transaction: Transaction & { code: string }) {
    const epoch = ++this.epoch;
    this.clientId = transaction.clientId;
    await this.tokens(
      new URLSearchParams({
        client_id: this.clientId,
        grant_type: "authorization_code",
        code: transaction.code,
        redirect_uri: transaction.redirectUri,
        code_verifier: transaction.verifier,
      }),
      epoch,
    );
    if (epoch === this.epoch) await this.read();
  }
  private async access() {
    if (!this.token) throw Error("Vincula tu cuenta de Spotify.");
    if (this.clock() < this.expires - 30000) return;
    if (!this.refreshToken) {
      this.disconnect();
      throw Error("La sesión de Spotify caducó. Vuelve a vincularla.");
    }
    if (!this.refreshRequest) {
      const epoch = this.epoch;
      const pending = this.tokens(
        new URLSearchParams({
          client_id: this.clientId,
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
        }),
        epoch,
      );
      this.refreshRequest = pending;
      void pending
        .finally(() => {
          if (this.refreshRequest === pending) this.refreshRequest = null;
        })
        .catch(() => {});
    }
    await this.refreshRequest;
  }
  private async api(method: string, path: string) {
    if (this.clock() < this.retryAt)
      throw Error("Spotify pidió esperar antes de volver a consultar.");
    const epoch = this.epoch;
    await this.access();
    if (epoch !== this.epoch) throw Error("La sesión de Spotify cambió.");
    const response = await this.request(
      "https://api.spotify.com/v1/me/player" + path,
      {
        method,
        headers: { Authorization: "Bearer " + this.token },
        signal: AbortSignal.timeout(12000),
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (epoch !== this.epoch) return null;
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      this.retryAt =
        this.clock() +
        Math.min(Math.max(Number.isFinite(seconds) ? seconds : 30, 1), 3600) *
          1000;
      throw Error("Spotify pidió esperar antes de volver a consultar.");
    }
    if (response.status === 401) {
      this.disconnect();
      throw Error("Vuelve a vincular tu cuenta de Spotify.");
    }
    if (response.status === 403)
      throw Error(
        "Spotify no permite esta acción para tu cuenta. Revisa Premium y el acceso autorizado de la aplicación.",
      );
    if (response.status === 404)
      throw Error("Abre Spotify y elige un dispositivo para reproducir.");
    if (!response.ok) throw Error("Spotify no pudo completar la acción.");
    return response.status === 204 ? null : response;
  }
  async read() {
    const epoch = this.epoch;
    try {
      const response = await this.api("GET", "");
      const playback = response ? spotifyPlayback(await response.json()) : null;
      if (epoch === this.epoch)
        this.publish({
          playback,
          message: playback
            ? ""
            : "Abre Spotify y empieza a reproducir para ver la canción actual.",
        });
    } catch (e) {
      if (epoch === this.epoch)
        this.publish({
          message:
            e instanceof Error ? e.message : "No se pudo consultar Spotify.",
        });
    }
  }
  async control(action: "play" | "pause" | "next" | "previous") {
    if (this.snapshot.busy) return false;
    const epoch = this.epoch;
    this.publish({ busy: true, message: "" });
    try {
      await this.api(
        action === "next" || action === "previous" ? "POST" : "PUT",
        "/" + action,
      );
      if (epoch !== this.epoch) return false;
      await this.read();
      return true;
    } catch (e) {
      if (epoch === this.epoch)
        this.publish({
          message:
            e instanceof Error ? e.message : "No se pudo completar la acción.",
        });
      return false;
    } finally {
      if (epoch === this.epoch) this.publish({ busy: false });
    }
  }
}
export const spotifyAccount = new SpotifyAccount();
if (typeof window !== "undefined")
  window.addEventListener("civigo:account-changed", () =>
    spotifyAccount.disconnect(),
  );
