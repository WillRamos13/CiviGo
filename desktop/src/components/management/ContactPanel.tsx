import { useState } from "react";
import { api } from "@/lib/api";
import { useRemote, RemoteStatus, Feedback, message, dateTime } from "./common";
type Contact = {
  id: string;
  clave: string;
  nickname: string;
  correo: string;
  asunto: string;
  mensaje: string;
  estado: string;
  creadoEn: string;
};
export default function ContactPanel() {
  const { data, error, loading, reload } =
    useRemote<Contact[]>("/admin/contact");
  const [failure, setFailure] = useState(""),
    [busy, setBusy] = useState("");
  return (
    <section className="card">
      <div className="card-header">
        <h2>Consultas de Contáctanos</h2>
        <button className="btn btn-secondary" onClick={reload}>
          Actualizar
        </button>
      </div>
      <RemoteStatus loading={loading} error={error} retry={reload} />
      <Feedback error={failure} />
      {data?.length === 0 && <p>No hay consultas recibidas.</p>}
      {data?.map((row) => (
        <article className="contact-admin-message" key={row.id}>
          <div className="card-header">
            <h3>{row.asunto}</h3>
            <span className="badge">{row.estado}</span>
          </div>
          <small>
            {row.nickname} · {row.correo} · {dateTime(row.creadoEn)}
          </small>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.mensaje}</p>
          {row.estado === "PENDIENTE" && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={async () => {
                setBusy(row.id);
                setFailure("");
                try {
                  await api("/admin/contact", {
                    method: "PATCH",
                    body: JSON.stringify({ clave: row.clave }),
                  });
                  reload();
                } catch (reason) {
                  setFailure(message(reason));
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy === row.id ? "Guardando…" : "Marcar atendido"}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
