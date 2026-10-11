"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { post, errorMessage } from "@/lib/api";
export default function PasswordRecovery() {
  const [token, setToken] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false);
  const initialToken = useRef<string | null>(null);
  useEffect(() => {
    const value =
      initialToken.current ??
      new URLSearchParams(window.location.hash.slice(1)).get("token") ??
      "";
    initialToken.current = value;
    window.history.replaceState(null, "", window.location.pathname);
    const timer = setTimeout(() => {
      setToken(value);
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    if (token && form.get("password") !== form.get("confirmacion")) {
      setError("Las contraseñas no coinciden.");
      setBusy(false);
      return;
    }
    try {
      const result = await post<{ mensaje: string }>(
        token ? "/users/password/reset" : "/users/password/forgot",
        token
          ? { token, password: form.get("password") }
          : { correo: form.get("correo") },
      );
      setMessage(result.mensaje);
      if (token) {
        setDone(true);
        setToken("");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page auth-page">
      <div className="card">
        <h1>Recuperar contraseña</h1>
        <p>
          Te enviaremos un enlace privado a tu correo. Es válido durante 15
          minutos.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice notice-success" role="status">
            {message}
          </p>
        )}
        {ready && !done && (
          <form onSubmit={submit}>
            {token ? (
              <>
                <div className="field">
                  <label htmlFor="nueva">Nueva contraseña</label>
                  <input
                    id="nueva"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={128}
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirmar">Repetir contraseña</label>
                  <input
                    id="confirmar"
                    name="confirmacion"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={128}
                  />
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="correo">Correo de tu cuenta</label>
                <input
                  id="correo"
                  name="correo"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </div>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy
                ? "Procesando…"
                : token
                  ? "Guardar contraseña"
                  : "Enviar enlace"}
            </button>
          </form>
        )}
        <p>
          <Link href="/ingresar">Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
