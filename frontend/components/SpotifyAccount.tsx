"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { spotifyAccount, spotifyAuthorization } from "@/lib/spotify-account";
import { registerRouteAudioGuard } from "@/lib/route-audio";
const enabled = Boolean(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim());
const controls = process.env.NEXT_PUBLIC_SPOTIFY_REMOTE_CONTROL === "true";
export default function SpotifyAccountPanel({ visible }: { visible: boolean }) {
  const state = useSyncExternalStore(
    spotifyAccount.subscribe,
    spotifyAccount.getSnapshot,
    spotifyAccount.getSnapshot,
  );
  const [error, setError] = useState(""),
    [eligible, setEligible] = useState(false);
  useEffect(() => {
    if (!state.connected) return;
    return registerRouteAudioGuard(async () => {
      await spotifyAccount.read();
      const playback = spotifyAccount.getSnapshot().playback;
      if (!playback) return false;
      if (!playback.playing) return true;
      if (!controls) return false;
      if (!(await spotifyAccount.control("pause"))) return false;
      return spotifyAccount.getSnapshot().playback?.playing === false;
    });
  }, [state.connected]);
  useEffect(() => {
    if (!visible || !state.connected) return;
    const read = () => {
      if (!document.hidden) void spotifyAccount.read();
    };
    read();
    const timer = setInterval(read, 15000);
    document.addEventListener("visibilitychange", read);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [visible, state.connected]);
  if (!enabled) return null;
  const connect = async () => {
    try {
      setError("");
      const url = await spotifyAuthorization(
        process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!.trim(),
        location.origin,
        sessionStorage,
        controls,
      );
      location.assign(url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo conectar con Spotify.",
      );
    }
  };
  return (
    <section aria-label="Mi cuenta Spotify" style={{ marginBlock: 14 }}>
      <h4>Mi cuenta Spotify</h4>
      {!state.connected ? (
        <>
          <p>
            Consulta lo que escuchas en tu dispositivo. Al conectar saldrás
            temporalmente del mapa; inicia la ruta después.
          </p>
          <label>
            <input
              type="checkbox"
              checked={eligible}
              onChange={(e) => setEligible(e.target.checked)}
            />
            Tengo 13 años o más y una cuenta de Spotify autorizada para esta
            aplicación.
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!eligible}
            onClick={() => void connect()}
          >
            Vincular Spotify
          </button>
        </>
      ) : (
        <>
          {state.playback && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBlock: 10,
              }}
            >
              {state.playback.image && (
                <Image
                  src={state.playback.image}
                  alt={`Portada de ${state.playback.name}`}
                  width={56}
                  height={56}
                  unoptimized
                  referrerPolicy="no-referrer"
                />
              )}
              <div>
                <strong>{state.playback.name}</strong>
                <p>{state.playback.artists}</p>
                {state.playback.url && (
                  <a
                    href={state.playback.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Escuchar en Spotify ↗
                  </a>
                )}
              </div>
            </div>
          )}
          {controls && (
            <div
              role="group"
              aria-label="Controles de Spotify"
              style={{ display: "flex", gap: 8 }}
            >
              {(
                [
                  ["previous", "Anterior", SkipBack],
                  [
                    state.playback?.playing ? "pause" : "play",
                    state.playback?.playing ? "Pausar" : "Reanudar",
                    state.playback?.playing ? Pause : Play,
                  ],
                  ["next", "Siguiente", SkipForward],
                ] as const
              ).map(([action, label, Icon]) => (
                <button
                  type="button"
                  className="icon-btn"
                  key={action}
                  aria-label={label}
                  disabled={state.busy || !state.playback?.device}
                  onClick={() => void spotifyAccount.control(action)}
                >
                  <Icon size={20} />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => spotifyAccount.disconnect()}
          >
            Desvincular de esta sesión
          </button>
          <small>
            La conexión se borra al recargar. También puedes revocar el acceso
            en{" "}
            <a
              href="https://www.spotify.com/account/apps/"
              target="_blank"
              rel="noopener noreferrer"
            >
              tus aplicaciones de Spotify
            </a>
            .
          </small>
        </>
      )}
      {(error || state.message) && (
        <p role="status">{error || state.message}</p>
      )}
      <small>
        Pausa Spotify para escuchar las indicaciones de voz. Si no podemos
        confirmar la pausa, las indicaciones permanecen en la pantalla.
      </small>
      <Link href="/privacidad">Privacidad de la conexión</Link>
    </section>
  );
}
