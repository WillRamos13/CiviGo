"use client";
import Link from "next/link";
import { useState } from "react";
import { Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { post, errorMessage } from "@/lib/api";
export default function ContactPage() {
  const { usuario } = useAuth();
  const [subject, setSubject] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  return (
    <div className="page max-w-4xl">
      <div className="page-heading">
        <span className="badge">
          <Mail size={14} />
          Estamos para ayudarte
        </span>
        <h1>Contáctanos</h1>
        <p className="muted">
          Consultas, sugerencias, problemas con tu cuenta y propuestas para
          CiviGo.
        </p>
      </div>
      <div className="contact-layout">
        <section className="card">
          <h2>
            <MessageCircle size={20} />
            Escríbenos
          </h2>
          {usuario ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                setSuccess("");
                try {
                  const result = await post<{ id: string; mensaje: string }>(
                    "/contact",
                    { asunto: subject, mensaje: message },
                  );
                  setSuccess(`${result.mensaje} Referencia: ${result.id}`);
                  setSubject("");
                  setMessage("");
                } catch (reason) {
                  setError(errorMessage(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="contact-subject">Asunto</label>
                <input
                  id="contact-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  minLength={3}
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label htmlFor="contact-message">Tu mensaje</label>
                <textarea
                  id="contact-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={6}
                />
              </div>
              {error && (
                <p className="notice notice-error" role="alert">
                  {error}
                </p>
              )}
              {success && (
                <p className="notice notice-success" role="status">
                  {success}
                </p>
              )}
              <button
                className="btn btn-primary"
                disabled={busy || !usuario.correoVerificado}
              >
                {busy ? "Enviando…" : "Enviar consulta"}
              </button>
              {!usuario.correoVerificado && (
                <p>Verifica tu Gmail en tu perfil para enviar la consulta.</p>
              )}
            </form>
          ) : (
            <>
              <p>
                Ingresa para que podamos asociar la consulta a tu cuenta y
                atenderla.
              </p>
              <Link className="btn btn-primary" href="/ingresar">
                Ingresar
              </Link>
            </>
          )}
        </section>
        <aside className="card">
          <ShieldCheck size={28} />
          <h2>Tu información, protegida</h2>
          <p>
            El equipo de administración recibe tu consulta de forma privada. No
            compartas contraseñas, códigos de verificación ni datos de tarjetas.
          </p>
          <p>
            Para avisar de un hecho en tu entorno, usa{" "}
            <Link href="/reportar">Reportar incidente</Link>.
          </p>
          <p className="muted">Este canal no atiende emergencias.</p>
        </aside>
      </div>
    </div>
  );
}
