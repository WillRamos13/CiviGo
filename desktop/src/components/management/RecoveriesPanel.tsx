
import { useState } from "react";
import EditorPanel from "@/components/EditorPanel";
import { api } from "@/lib/api";
import AttachmentDownload from "@/components/AttachmentDownload";
import {
  dateTime,
  Feedback,
  message,
  RemoteStatus,
  stateLabel,
  useRemote,
} from "./common";

interface Recovery {
  id: number;
  usuario?: { nickname?: string; nombreUsuario?: string; correo?: string };
  telefonoNuevo: string;
  motivo: string;
  adjuntoId?: string | null;
  estado: string;
  creadoEn: string;
}

export default function RecoveriesPanel() {
  const { data, loading, error, reload } =
    useRemote<Recovery[]>("/admin/recoveries");
  const [selection, setSelection] = useState<{
    recovery: Recovery;
    state: "ACEPTADA" | "RECHAZADA";
  } | null>(null);
  const [editorOpening, setEditorOpening] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function decide() {
    if (!selection || pending) return;
    setPending(true);
    setFailure("");
    try {
      await api(`/admin/recoveries/${selection.recovery.id}`, {
        method: "POST",
        body: JSON.stringify({ estado: selection.state }),
      });
      setSuccess("La revisión de recuperación quedó registrada.");
      setSelection(null);
      reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="notice mb-5">
        La revisión de documentos de identidad está reservada a administradores.
        Una recuperación aprobada cierra las sesiones de la cuenta. La
        participación exige correo verificado.
      </p>
      <Feedback error={failure} success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {data && !loading && !error && (
        <section className="card">
          <h2 className="text-xl font-bold mb-4">
            Recuperaciones y cambios de teléfono
          </h2>
          {data.length === 0 ? (
            <p className="muted">No hay solicitudes pendientes.</p>
          ) : (
            <div className="divide-y">
              {data.map((recovery) => (
                <article key={recovery.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">
                        @
                        {recovery.usuario?.nickname ??
                          recovery.usuario?.nombreUsuario ??
                          "Usuario registrado"}
                      </h3>
                      <p className="muted text-sm mt-1">
                        {dateTime(recovery.creadoEn)} ·{" "}
                        {recovery.usuario?.correo}
                      </p>
                      <p className="mt-2">
                        Nuevo teléfono: {recovery.telefonoNuevo}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap">
                        {recovery.motivo}
                      </p>
                      <span className="badge mt-3">
                        {stateLabel(recovery.estado)}
                      </span>
                      {recovery.adjuntoId && (
                        <AttachmentDownload id={recovery.adjuntoId} className="btn btn-secondary mt-3">
                          Descargar documento privado
                        </AttachmentDownload>
                      )}
                    </div>
                    {recovery.estado === "PENDIENTE" && (
                      <div className="flex flex-wrap gap-2 self-start">
                        <button
                          className="btn btn-primary"
                          disabled={pending}
                          onClick={() => { setSelection({ recovery, state: "ACEPTADA" }); setEditorOpening(value => value + 1); }}
                        >
                          Aprobar cambio
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={pending}
                          onClick={() => { setSelection({ recovery, state: "RECHAZADA" }); setEditorOpening(value => value + 1); }}
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {selection && (
        <EditorPanel label={`Revisar recuperación ${selection.recovery.id}`} selectionKey={`${selection.recovery.id}:${selection.state}:${editorOpening}`}>
        <section className="card mt-5 brand-border">
          <h2 className="font-bold text-lg">
            {selection.state === "ACEPTADA" ? "Aprobar" : "Rechazar"} solicitud
            #{selection.recovery.id}
          </h2>
          <p className="mt-3">
            {selection.state === "ACEPTADA"
              ? `El teléfono de la cuenta cambiará a ${selection.recovery.telefonoNuevo} y se cerrarán sus sesiones. La participación exige correo verificado.`
              : "La cuenta conservará su teléfono actual."}
          </p>
          <div className="flex gap-3 mt-5">
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={decide}
            >
              {pending ? "Guardando…" : "Registrar decisión"}
            </button>
            <button
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => setSelection(null)}
            >
              Cancelar
            </button>
          </div>
        </section>
        </EditorPanel>
      )}
    </>
  );
}

