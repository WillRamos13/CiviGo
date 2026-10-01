"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { dateTime, Feedback, message, RemoteStatus, useRemote } from "./common";

interface AuditEntry {
  id: number;
  usuarioId: number | null;
  accion: string;
  entidad: string;
  entidadId: string | null;
  datos?: Record<string, unknown> | null;
  creadoEn: string;
}
interface LifecycleResult {
  reminders: number;
  expired: number;
  reduced: number;
}
const entities: Record<string, string> = {
  User: "Cuenta",
  Incident: "Antecedente histórico",
  USUARIO: "Cuenta",
  INCIDENTE: "Incidente",
  CONFIG: "Configuración",
  APELACION: "Apelación",
  RECUPERACION: "Recuperación",
  CANJE: "Canje",
  RANKING: "Ranking mensual",
  CATEGORIA: "Categoría",
  TIPO: "Tipo de incidente",
  NEGOCIO: "Negocio",
  RECOMPENSA: "Recompensa",
  HISTORICO: "Importación histórica",
};
const actions: Record<string, string> = {
  AJUSTAR_PARTICIPACION: "Ajuste de participación y monedas",
  IMPORTAR_HISTORICOS: "Importación de antecedentes históricos",
  ACTUALIZAR: "Actualización",
  CREAR: "Creación",
  VALIDAR: "Validación",
  GRAVEDAD: "Corrección de gravedad",
  FALSO: "Declaración de falsedad",
  ANULAR_PUNTOS_FALSO: "Retirada de puntos por falsedad",
  RETIRAR_PUNTOS: "Revisión de puntos por falsedad",
  RESOLVER: "Resolución",
  REABRIR: "Reapertura",
  ACEPTADA: "Solicitud aceptada",
  RECHAZADA: "Solicitud rechazada",
  APROBADO_DEMO: "Canje de demostración aprobado",
  CANCELADO: "Canje cancelado",
  CERRAR: "Cierre del mes",
  IMPORTAR: "Importación",
};

export default function AuditPanel() {
  const { data, loading, error, reload } =
    useRemote<AuditEntry[]>("/admin/audit");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function process() {
    if (pending) return;
    setPending(true);
    setFailure("");
    setSuccess("");
    try {
      const result = await api<LifecycleResult>("/admin/lifecycle/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSuccess(
        `Revisión completada: ${result.reminders} recordatorios enviados, ${result.reduced} pesos actualizados y ${result.expired} reportes retirados por vencimiento.`,
      );
      reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="card">
        <h2 className="font-bold text-xl">Revisar plazos de reportes</h2>
        <p className="muted">
          Los delitos individuales tienen recordatorio al primer día, reducción
          de peso al tercero y revisión del vencimiento al séptimo. Las pruebas
          entregadas dentro del plazo esperan la evaluación del personal.
        </p>
        <Feedback error={failure} success={success} />
        <button
          className="btn btn-secondary"
          disabled={pending}
          onClick={process}
        >
          {pending ? "Revisando…" : "Revisar plazos ahora"}
        </button>
        <p className="muted text-sm mt-3">
          Los recordatorios por correo se envían cuando el servicio
          correspondiente está configurado.
        </p>
      </section>
      <section className="card">
        <div className="flex flex-wrap justify-between gap-3 mb-4">
          <h2 className="font-bold text-xl">
            Actividad administrativa reciente
          </h2>
          <button className="btn btn-secondary" onClick={reload}>
            Actualizar
          </button>
        </div>
        <RemoteStatus loading={loading} error={error} retry={reload} />
        {data &&
          !loading &&
          !error &&
          (data.length === 0 ? (
            <p className="muted">
              Todavía no hay decisiones administrativas registradas.
            </p>
          ) : (
            <div className="divide-y">
              {data.map((entry) => (
                <article key={entry.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {actions[entry.accion] ??
                          entry.accion.toLowerCase().replaceAll("_", " ")}{" "}
                        ·{" "}
                        {entities[entry.entidad] ??
                          entry.entidad.toLowerCase().replaceAll("_", " ")}
                        {entry.entidadId ? ` #${entry.entidadId}` : ""}
                      </h3>
                      <p className="muted text-sm mt-1">
                        {dateTime(entry.creadoEn)} ·{" "}
                        {entry.usuarioId
                          ? `Cuenta administrativa #${entry.usuarioId}`
                          : "Proceso del sistema"}
                      </p>
                    </div>
                    <span className="badge self-start">
                      Registro #{entry.id}
                    </span>
                  </div>
                  {typeof entry.datos?.motivo === "string" && (
                    <p className="mt-2 whitespace-pre-wrap">
                      {entry.datos.motivo}
                    </p>
                  )}
                  {typeof entry.datos?.respuesta === "string" && (
                    <p className="mt-2 whitespace-pre-wrap">
                      Respuesta: {entry.datos.respuesta}
                    </p>
                  )}
                  {typeof entry.datos?.nivelRiesgo === "number" && (
                    <p className="muted mt-2">
                      Gravedad evaluada: {entry.datos.nivelRiesgo}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ))}
      </section>
    </>
  );
}
