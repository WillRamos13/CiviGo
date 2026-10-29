"use client";
import { useEffect, useId, useRef, useState } from "react";
import { post, ApiError, errorMessage } from "@/lib/api";
type Challenge = {
  challengeId?: string;
  alreadyVerified?: boolean;
  resendAfterSeconds?: number;
};
export default function EmailCodeVerification({
  correo,
  onVerified,
  disabled = false,
}: {
  correo: string;
  onVerified: () => Promise<void>;
  disabled?: boolean;
}) {
  const field = useId(),
    request = useRef<AbortController | null>(null),
    alive = useRef(true);
  const [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState<"send" | "confirm" | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [retryAt, setRetryAt] = useState(0),
    [clock, setClock] = useState(Date.now);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      request.current?.abort();
    };
  }, []);
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  const run = async (mode: "send" | "confirm") => {
    if (
      disabled ||
      request.current ||
      (mode === "confirm" && (!challenge || !/^\d{6}$/.test(code)))
    )
      return;
    const c = new AbortController();
    request.current = c;
    setBusy(mode);
    setError("");
    setMessage("");
    try {
      if (mode === "send") {
        const data = await post<Challenge>(
          "/users/email/code/request",
          {},
          { signal: c.signal },
        );
        if (c.signal.aborted || !alive.current) return;
        if (data.alreadyVerified) {
          await onVerified();
          return;
        }
        if (!data.challengeId)
          throw new Error(
            "No se recibió una solicitud válida. Inténtalo de nuevo.",
          );
        setChallenge(data.challengeId);
        setCode("");
        setClock(Date.now());
        setRetryAt(
          Date.now() + Math.max(60, data.resendAfterSeconds || 60) * 1000,
        );
        setMessage(
          "Código enviado. Revisa tu bandeja de entrada y Spam. Vence en 10 minutos.",
        );
      } else {
        await post(
          "/users/email/code/confirm",
          { challengeId: challenge, codigo: code },
          { signal: c.signal },
        );
        if (c.signal.aborted || !alive.current) return;
        await onVerified();
        if (alive.current && !c.signal.aborted)
          setMessage("Tu Gmail está verificado. Ya puedes participar.");
      }
    } catch (reason) {
      if (alive.current && !c.signal.aborted) {
        setError(errorMessage(reason));
        if (
          reason instanceof ApiError &&
          reason.code === "EMAIL_CODE_COOLDOWN"
        ) {
          setRetryAt(Date.now() + 60000);
          setClock(Date.now());
        }
      }
    } finally {
      if (request.current === c) {
        request.current = null;
        if (alive.current) setBusy(null);
      }
    }
  };
  return (
    <section
      aria-label="Verificar Gmail con código"
      style={{
        margin: "18px 0",
        padding: "16px 0",
        borderBlock: "1px solid var(--line)",
      }}
    >
      <h3>Recibir un código en mi Gmail</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Lo enviaremos a {correo}. También puedes verificar con tu cuenta de
        Google.
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
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || !!busy || remaining > 0}
        onClick={() => void run("send")}
      >
        {busy === "send"
          ? "Enviando código…"
          : remaining > 0
            ? `Reenviar en ${remaining} s`
            : challenge
              ? "Enviar otro código"
              : "Enviar código a mi Gmail"}
      </button>
      {challenge && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run("confirm");
          }}
          style={{ marginTop: 16 }}
        >
          <div className="field">
            <label htmlFor={field}>Código de seis dígitos</label>
            <input
              id={field}
              name="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={12}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
              disabled={disabled || !!busy}
              aria-describedby={`${field}-help`}
            />
            <small id={`${field}-help`} className="muted">
              Usa el código del último correo recibido. No lo compartas.
            </small>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={disabled || !!busy || code.length !== 6}
          >
            {busy === "confirm" ? "Verificando…" : "Verificar código"}
          </button>
        </form>
      )}
    </section>
  );
}
