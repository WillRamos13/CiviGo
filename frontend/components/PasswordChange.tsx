"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { post, errorMessage } from "@/lib/api";
import { useAuth } from "./AuthProvider";
export default function PasswordChange() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { refresh } = useAuth();
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.confirmacion) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await post("/users/password/change", values);
      await refresh();
      router.replace("/ingresar");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h2>Seguridad de tu cuenta</h2>
      <details>
        <summary>Cambiar contraseña</summary>
        <p>Al cambiarla se cerrarán las sesiones de todos tus dispositivos.</p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="password-actual">Contraseña actual</label>
            <input
              id="password-actual"
              type="password"
              name="actual"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </div>
          <div className="field">
            <label htmlFor="password-nueva">Nueva contraseña</label>
            <input
              id="password-nueva"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </div>
          <div className="field">
            <label htmlFor="password-confirmacion">
              Repetir nueva contraseña
            </label>
            <input
              id="password-confirmacion"
              type="password"
              name="confirmacion"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </div>
          <button className="btn btn-secondary" disabled={busy}>
            {busy ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      </details>
    </div>
  );
}
