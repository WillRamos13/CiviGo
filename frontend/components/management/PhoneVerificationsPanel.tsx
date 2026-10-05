"use client";

import { useState } from "react";
import { post, errorMessage, formatDate } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Feedback, RemoteStatus, useRemote } from "./common";

interface PhoneRequest {
  id: number;
  creadoEn: string;
  expiresAt: string;
  usuario: { id: number; nickname: string; telefono: string };
}

function Approval({ request, approved }: { request: PhoneRequest; approved: () => void }) {
  const { usuario, refresh } = useAuth();
  const [sender, setSender] = useState("");
  const [code, setCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !reviewed) return;
    setBusy(true);
    setError("");
    try {
      await post(`/admin/phone-verifications/${request.id}/approve`, { codigo: code, telefonoRemitente: sender });
      if (usuario?.id === request.usuario.id) await refresh();
      approved();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <form className="card" onSubmit={submit}>
    <h3>{request.usuario.nickname}</h3>
    <p>Número registrado: <strong>{request.usuario.telefono}</strong></p>
    <p className="muted">Solicitado: {formatDate(request.creadoEn)}. Vence: {formatDate(request.expiresAt)}.</p>
    <Feedback error={error} />
    <label className="field">Número que envió el mensaje en WhatsApp
      <input required type="tel" autoComplete="off" maxLength={30} value={sender} onChange={e => setSender(e.target.value)} placeholder="Copia el número del remitente, con +51" disabled={busy} />
    </label>
    <label className="field">Código recibido en ese mensaje
      <input required autoComplete="off" maxLength={64} value={code} onChange={e => setCode(e.target.value)} placeholder="Copia el código completo de 24 caracteres" disabled={busy} />
    </label>
    <label className="flex gap-2 items-start mb-4">
      <input type="checkbox" required checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} />
      <span>Comprobé en WhatsApp el número real del remitente y que el código pertenece a su mensaje. El nombre del contacto y las capturas reenviadas no bastan.</span>
    </label>
    <button className="btn btn-primary" disabled={busy || !reviewed || !sender.trim() || !code.trim()}>{busy ? "Aprobando…" : "Aprobar teléfono"}</button>
  </form>;
}

export default function PhoneVerificationsPanel() {
  const { data, loading, error, reload } = useRemote<PhoneRequest[]>("/admin/phone-verifications");
  const [success, setSuccess] = useState("");
  return <section>
    <div className="card">
      <h2>Verificaciones por WhatsApp</h2>
      <p className="muted">Revisa los mensajes recibidos en el WhatsApp de CiviGo. La aprobación habilita la participación de esa cuenta y queda registrada en la actividad administrativa.</p>
      <button className="btn btn-secondary" disabled={loading} onClick={reload}>Actualizar solicitudes</button>
    </div>
    <Feedback success={success} />
    <RemoteStatus loading={loading} error={error} retry={reload} />
    {data && !loading && !error && (data.length ? data.map(request => <Approval key={request.id} request={request} approved={() => { setSuccess("Teléfono aprobado después de revisar el mensaje."); reload(); }} />) : <p className="notice">No hay verificaciones pendientes.</p>)}
  </section>;
}
