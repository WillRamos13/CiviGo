"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  consumeSpotifyTransaction,
  spotifyAccount,
} from "@/lib/spotify-account";
let completing: Promise<void> | null = null;
export default function SpotifyCallback() {
  const [message, setMessage] = useState(
    "Completando la conexión con Spotify…",
  );
  useEffect(() => {
    let current = true;
    if (!completing) {
      const callback = location.href;
      history.replaceState(history.state, "", location.pathname);
      completing = Promise.resolve()
        .then(() => consumeSpotifyTransaction(callback, sessionStorage))
        .then((tx) => spotifyAccount.complete(tx));
    }
    void completing
      .then(() => {
        if (current)
          setMessage(
            "Spotify está conectado para esta sesión. Puedes volver al mapa.",
          );
      })
      .catch((e) => {
        if (current)
          setMessage(
            e instanceof Error ? e.message : "No se pudo vincular Spotify.",
          );
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <section className="card">
      <h1>Conexión con Spotify</h1>
      <p role="status">{message}</p>
      <Link href="/mapa" className="btn btn-primary">
        Volver al mapa
      </Link>
    </section>
  );
}
