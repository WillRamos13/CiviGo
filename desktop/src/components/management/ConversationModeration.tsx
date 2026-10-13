"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { dateTime, Feedback, message, RemoteStatus, useRemote } from "./common";

interface ConversationMessage {
  id: number;
  mensaje: string;
  creadoEn: string;
  usuario?: { nickname?: string };
  retirado: boolean;
}

export default function ConversationModeration({ incidentId, done }: { incidentId: number; done: () => void }) {
  const messages = useRemote<ConversationMessage[]>(`/admin/incidents/${incidentId}/messages`);
  const [selected, setSelected] = useState<ConversationMessage | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setError("");
    try {
      await api(`/admin/incidents/${incidentId}/messages/${selected.id}/moderate`, {
        method: "POST",
        body: JSON.stringify({ accion: selected.retirado ? "RESTAURAR" : "RETIRAR", motivo: reason.trim() }),
      });
      setSelected(null);
      setReason("");
      messages.reload();
      done();
    } catch (failure: unknown) { setError(message(failure)); }
    finally { setPending(false); }
  }
  return <section className="mt-6 border-t pt-5">
    <h3 className="font-bold">Moderar conversación</h3>
    <p className="muted text-sm mt-2">Retira mensajes inapropiados o restaura los retirados. Cada cambio requiere un motivo y queda registrado. No modifica los reportes ni sanciona a sus autores.</p>
    <RemoteStatus loading={messages.loading} error={messages.error} retry={messages.reload} />
    <Feedback error={error} />
    {!messages.loading && !messages.error && messages.data && <div className="divide-y mt-3">
      {!messages.data.length && <p className="muted text-sm">Todavía no hay mensajes.</p>}
      {messages.data.map(row => <article key={row.id} className="py-3">
        <strong>{row.usuario?.nickname ?? "Ciudadano"}</strong>
        <p className="muted text-sm">{dateTime(row.creadoEn)}</p>
        <p className="whitespace-pre-wrap mt-1">{row.mensaje}</p>
        <button type="button" className="btn btn-secondary mt-2" disabled={pending} onClick={() => { setSelected(row); setReason(""); setError(""); }}>
          {row.retirado ? "Restaurar mensaje" : "Retirar mensaje"}
        </button>
      </article>)}
    </div>}
    {selected && <form onSubmit={submit} className="mt-4 rounded-xl border p-4">
      <p className="font-semibold">{selected.retirado ? "Restaurar" : "Retirar"} el mensaje de {selected.usuario?.nickname ?? "Ciudadano"}</p>
      <label className="field mt-3">Motivo de moderación<textarea required minLength={5} maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="actions mt-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Guardando…" : "Confirmar moderación"}</button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setSelected(null)}>Cancelar</button>
      </div>
    </form>}
  </section>;
}
