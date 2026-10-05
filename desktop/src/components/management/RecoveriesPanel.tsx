
import { useState } from "react";
import { api, API_URL } from "@/lib/api";
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
        participación exige correo verificado con Google.
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
                        <a
                          className="btn btn-secondary ml-3 mt-3"
                          href={`${API_URL}/uploads/${encodeURIComponent(recovery.adjuntoId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Revisar documento privado
                        </a>
                      )}
                    </div>
                    {recovery.estado === "PENDIENTE" && (
                      <div className="flex flex-wrap gap-2 self-start">
                        <button
                          className="btn btn-primary"
                          disabled={pending}
                          onClick={() =>
                            setSelection({ recovery, state: "ACEPTADA" })
                          }
                        >
                          Aprobar cambio
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={pending}
                          onClick={() =>
                            setSelection({ recovery, state: "RECHAZADA" })
                          }
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
        <section className="card mt-5 brand-border">
          <h2 className="font-bold text-lg">
            {selection.state === "ACEPTADA" ? "Aprobar" : "Rechazar"} solicitud
            #{selection.recovery.id}
          </h2>
          <p className="mt-3">
            {selection.state === "ACEPTADA"
              ? `El teléfono de la cuenta cambiará a ${selection.recovery.telefonoNuevo} y se cerrarán sus sesiones. La participación exige correo verificado con Google.`
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
      )}
    </>
  );
}

