"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import {
  dateTime,
  Feedback,
  message,
  RemoteStatus,
  stateLabel,
  useRemote,
} from "./common";

interface Appeal {
  id: number;
  motivo: string;
  estado: string;
  respuesta?: string | null;
  creadoEn: string;
  usuario?: { nickname?: string; nombreUsuario?: string };
  reporte?: {
    id: number;
    tipo: string;
    descripcion: string;
    estado: string;
    incidenteId?: number | null;
  };
}

function AppealForm({
  appeal,
  saved,
  cancel,
}: {
  appeal: Appeal;
  saved: () => void;
  cancel: () => void;
}) {
  const [state, setState] = useState("ACEPTADA");
  const [response, setResponse] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api(`/admin/appeals/${appeal.id}`, {
        method: "POST",
        body: JSON.stringify({ estado: state, respuesta: response.trim() }),
      });
      saved();
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="card mt-5 brand-border" onSubmit={submit}>
      <h2 className="text-xl font-bold">Revisar apelación #{appeal.id}</h2>
      <p className="whitespace-pre-wrap my-4">{appeal.motivo}</p>
      <Feedback error={error} />
      <label className="field">
        Resultado
        <select
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="ACEPTADA">Aceptar apelación</option>
          <option value="RECHAZADA">Rechazar apelación</option>
        </select>
      </label>
      <label className="field mt-4">
        Respuesta al usuario
        <textarea
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="Explica la revisión y las medidas tomadas."
        />
      </label>
      <p className="notice mt-4">
        Aceptar una apelación requiere revisar la decisión original y los
        efectos en el incidente y la credibilidad del usuario.
      </p>
      <div className="flex gap-3 mt-5">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Guardando…" : "Registrar respuesta"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={cancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function AppealsPanel() {
  const { data, loading, error, reload } =
    useRemote<Appeal[]>("/admin/appeals");
  const [selected, setSelected] = useState<Appeal | null>(null);
  const [success, setSuccess] = useState("");
  return (
    <>
      <Feedback success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {data && !loading && !error && (
        <section className="card">
          <h2 className="font-bold text-xl mb-4">Solicitudes de revisión</h2>
          {data.length === 0 ? (
            <p className="muted">No hay apelaciones registradas.</p>
          ) : (
            <div className="divide-y">
              {data.map((appeal) => (
                <article key={appeal.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        Reporte #{appeal.reporte?.id ?? "—"} · @
                        {appeal.usuario?.nickname ??
                          appeal.usuario?.nombreUsuario ??
                          "Usuario registrado"}
                      </h3>
                      <p className="muted text-sm mt-1">
                        {dateTime(appeal.creadoEn)} · {appeal.reporte?.tipo}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap">
                        {appeal.motivo}
                      </p>
                      <span className="badge mt-2">
                        {stateLabel(appeal.estado)}
                      </span>
                      {appeal.respuesta && (
                        <p className="notice mt-3">
                          Respuesta: {appeal.respuesta}
                        </p>
                      )}
                    </div>
                    {appeal.estado === "PENDIENTE" && (
                      <button
                        className="btn btn-primary self-start"
                        onClick={() => {
                          setSelected(appeal);
                          setSuccess("");
                        }}
                      >
                        Revisar apelación
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {selected && (
        <AppealForm
          key={selected.id}
          appeal={selected}
          cancel={() => setSelected(null)}
          saved={() => {
            setSelected(null);
            setSuccess("La respuesta quedó registrada.");
            reload();
          }}
        />
      )}
    </>
  );
}
