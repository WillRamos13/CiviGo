"use client";

import { useState } from "react";
import Link from "next/link";
import { api, API_URL } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import IncidentIcon from "@/components/IncidentIcon";
import { incidentEvaluationLabel } from "@/lib/incidents";
import {
  dateTime,
  Feedback,
  message,
  number,
  RemoteStatus,
  stateLabel,
  useRemote,
} from "./common";

interface Evidence {
  id: string;
  nombre: string;
  mimeType: string;
  privado: boolean;
  tipo?: string;
}
interface ReportContribution {
  id: number;
  descripcion: string;
  estado: string;
  fechaCreacion: string;
  usuario?: { nickname?: string; nombreUsuario?: string };
  adjuntos?: Evidence[];
}
interface IncidentReview {
  id: number;
  tipo: string;
  tipoId?: number | null;
  tipoNombre?: string;
  tipoSlug?: string;
  descripcion: string;
  distrito?: string | null;
  latitud: number;
  longitud: number;
  estado: string;
  nivelRiesgo: number | null;
  individual: boolean;
  publicado: boolean;
  validacion: number;
  fechaCreacion: string;
  fechaEvento: string;
  totalReportes: number;
  evaluacion?: string;
  motivoRetiro?: string | null;
  reportes?: ReportContribution[];
  flags?: { id: number; tipo: string; motivo: string; estado: string }[];
  revisiones?: {
    id: number;
    accion: string;
    motivo: string;
    creadoEn: string;
    usuario?: { nickname?: string; nombreUsuario?: string };
  }[];
}
interface ReviewCatalog {
  categorias: {
    id: number;
    nombre: string;
    tipos: { id: number; nombre: string }[];
  }[];
}
type Action =
  | "VALIDAR"
  | "GRAVEDAD"
  | "FALSO"
  | "RESOLVER"
  | "REABRIR"
  | "CLASIFICAR"
  | "RETIRAR_PUNTOS";
const actions: { value: Action; label: string; permission: string }[] = [
  { value: "VALIDAR", label: "Validar incidente", permission: "revisar" },
  { value: "GRAVEDAD", label: "Corregir gravedad", permission: "revisar" },
  {
    value: "CLASIFICAR",
    label: "Clasificar o cambiar tipo",
    permission: "revisar",
  },
  { value: "FALSO", label: "Declarar falso", permission: "revisar" },
  { value: "RESOLVER", label: "Marcar resuelto", permission: "resolver" },
  { value: "REABRIR", label: "Reabrir incidente", permission: "reabrir" },
  {
    value: "RETIRAR_PUNTOS",
    label: "Retirar puntos por falsedad",
    permission: "admin",
  },
];

function ReviewDetail({
  incident,
  done,
  close,
}: {
  incident: IncidentReview;
  done: () => void;
  close: () => void;
}) {
  const { usuario } = useAuth();
  const admin = usuario?.rol.toUpperCase() === "ADMIN";
  const canEvidence = admin || usuario?.permisos?.includes("evidencia");
  const allowedActions = actions.filter(
    (action) =>
      (admin || usuario?.permisos?.includes(action.permission)) &&
      (action.value !== "RETIRAR_PUNTOS" ||
        (admin && incident.estado === "FALSO")) &&
      (incident.estado !== "FALSO" || action.value === "RETIRAR_PUNTOS") &&
      (!incident.individual ||
        !["VALIDAR", "FALSO"].includes(action.value) ||
        canEvidence),
  );
  const [action, setAction] = useState<Action>(
    allowedActions[0]?.value ?? "VALIDAR",
  );
  const [severity, setSeverity] = useState(incident.nivelRiesgo ?? 1);
  const [typeId, setTypeId] = useState(incident.tipoId ?? 0);
  const catalog = useRemote<ReviewCatalog>("/catalog");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (action === "CLASIFICAR")
        await api(`/admin/incidents/${incident.id}/classify`, {
          method: "POST",
          body: JSON.stringify({ tipoId: typeId, motivo: reason.trim() }),
        });
      else
        await api(`/admin/incidents/${incident.id}/review`, {
          method: "POST",
          body: JSON.stringify({
            accion: action,
            nivelRiesgo: ["VALIDAR", "GRAVEDAD"].includes(action)
              ? severity
              : undefined,
            motivo: reason.trim(),
          }),
        });
      done();
    } catch (failure: unknown) {
      setError(message(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card mt-5 brand-border" aria-labelledby="review-title">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h2
            id="review-title"
            className="incident-title-with-icon text-xl font-bold"
          >
            <IncidentIcon
              tipo={incident.tipoNombre ?? incident.tipo}
              slug={incident.tipoSlug}
            />
            <span>
              {incident.tipoNombre ?? incident.tipo} · #{incident.id}
            </span>
          </h2>
          <p className="muted mt-1">
            {incident.distrito ?? "Distrito sin asignar"} ·{" "}
            {dateTime(incident.fechaCreacion)}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={pending}
          onClick={close}
        >
          Cerrar detalle
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <span className="badge">{stateLabel(incident.estado)}</span>
        <span className="badge">{incidentEvaluationLabel(incident)}</span>
        <span className="badge">
          {incident.publicado
            ? "Visible en el mapa"
            : "Pendiente de publicación"}
        </span>
        <span className="badge">
          {incident.individual ? "Delito individual" : "Incidente comunitario"}
        </span>
      </div>
      <p className="my-4 whitespace-pre-wrap">
        {incident.descripcion || "Sin descripción adicional."}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="muted text-sm">Gravedad del incidente</p>
          <strong>{incident.nivelRiesgo ?? "Por evaluar"}</strong>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="muted text-sm">Peso de validación</p>
          <strong>{number(incident.validacion * 100)} %</strong>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="muted text-sm">Aportes agrupados</p>
          <strong>{incident.totalReportes}</strong>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="muted text-sm">Fecha del hecho</p>
          <strong className="text-sm">{dateTime(incident.fechaEvento)}</strong>
        </div>
      </div>
      <p className="muted text-sm mt-3">La evaluación por IA es preliminar: no certifica la autenticidad de las imágenes ni del hecho. El peso de validación es un factor del cálculo de riesgo, no una probabilidad de que el reporte sea verdadero. Revisa las pruebas y las confirmaciones antes de validar.</p>
      {incident.motivoRetiro && (
        <p className="notice mt-4">
          Motivo de retirada: {incident.motivoRetiro}
        </p>
      )}
      <Link
        className="btn btn-secondary mt-4"
        href={`/incidentes/${incident.id}`}
      >
        Ver conversación y detalle ciudadano
      </Link>
      {!!incident.flags?.length && (
        <section className="mt-5">
          <h3 className="font-bold">Avisos recibidos</h3>
          <ul className="divide-y mt-2">
            {incident.flags.map((flag) => (
              <li key={flag.id} className="py-3">
                <span className="badge mr-2">{stateLabel(flag.tipo)}</span>
                <span>{flag.motivo}</span>
                <p className="muted text-sm mt-1">{stateLabel(flag.estado)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!incident.reportes?.length && (
        <section className="mt-5">
          <h3 className="font-bold">Reportes y documentación</h3>
          <div className="divide-y">
            {incident.reportes.map((report) => (
              <article key={report.id} className="py-4">
                <h4 className="font-semibold">
                  Reporte #{report.id} ·{" "}
                  {report.usuario?.nickname ??
                    report.usuario?.nombreUsuario ??
                    "Autor registrado"}
                </h4>
                <p className="muted text-sm">
                  {dateTime(report.fechaCreacion)} · {report.estado === "EN_REVISION" ? "En revisión humana" : stateLabel(report.estado)}
                </p>
                {report.estado === "EN_REVISION" && <p className="notice notice-warning mt-2">Este aporte requiere revisión humana. El estado del incidente agrupado no valida este reporte.</p>}
                <p className="mt-2 whitespace-pre-wrap">{report.descripcion}</p>
                <ul className="flex flex-wrap gap-2 mt-3">
                  {report.adjuntos?.map((attachment) => (
                    <li key={attachment.id}>
                      {attachment.privado && !canEvidence ? (
                        <span className="badge">
                          Documento privado · permiso requerido
                        </span>
                      ) : (
                        <a
                          className="btn btn-secondary text-sm"
                          href={`${API_URL}/uploads/${encodeURIComponent(attachment.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {attachment.privado
                            ? "Prueba privada: "
                            : "Adjunto: "}
                          {attachment.nombre}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}
      <form onSubmit={submit} className="mt-6 border-t pt-5">
        <h3 className="font-bold text-lg mb-4">Registrar decisión</h3>
        <Feedback error={error} />
        {allowedActions.length === 0 ? (
          <p className="notice">
            {incident.estado === "FALSO"
              ? "La declaración de falsedad se reconsidera mediante una apelación. Solo un administrador puede evaluar la retirada de puntos."
              : "El administrador debe asignarte permisos para registrar una decisión."}
          </p>
        ) : (
          <>
            <div className="grid-2">
              <label className="field">
                Decisión
                <select
                  value={action}
                  onChange={(event) => setAction(event.target.value as Action)}
                >
                  {allowedActions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {["VALIDAR", "GRAVEDAD"].includes(action) && (
                <label className="field">
                  Gravedad evaluada
                  <select
                    value={severity}
                    onChange={(event) =>
                      setSeverity(Number(event.target.value))
                    }
                  >
                    {[1, 2, 3, 4, 5].map((level) => (
                      <option key={level} value={level}>
                        Nivel {level}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {action === "CLASIFICAR" && (
              <div className="mt-4">
                <RemoteStatus
                  loading={catalog.loading}
                  error={catalog.error}
                  retry={catalog.reload}
                />
                <label className="field">
                  Tipo correcto
                  <select
                    required
                    value={typeId || ""}
                    onChange={(event) => setTypeId(Number(event.target.value))}
                  >
                    <option value="">Seleccionar tipo</option>
                    {catalog.data?.categorias.map((category) => (
                      <optgroup key={category.id} label={category.nombre}>
                        {category.tipos.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <p className="muted text-sm">
                  La clasificación queda registrada. Un incidente con varios
                  autores no puede convertirse en un delito individual.
                </p>
              </div>
            )}
            <label className="field mt-4">
              Motivo de la decisión
              <textarea
                required
                minLength={5}
                maxLength={2000}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe qué revisaste y el fundamento de la decisión."
              />
            </label>
            {action === "FALSO" && (
              <p className="notice notice-error mt-3">
                Declarar un reporte falso afecta la credibilidad de sus autores.
                Registra esta decisión después de revisar la información y las
                pruebas disponibles. Los puntos se conservan hasta que un
                administrador decida retirarlos en una revisión separada.
              </p>
            )}
            {action === "RETIRAR_PUNTOS" && (
              <p className="notice notice-warning mt-3">
                Retirarás los puntos de reportes, confirmaciones y pruebas de
                este incidente declarado falso. Justifica la decisión después de
                revisar los aportes. Las monedas de meses ya cerrados se revisan
                mediante un ajuste administrativo de participación; esta acción
                no modifica sus premios liquidados.
              </p>
            )}
            <p className="muted text-sm mt-3">
              La evaluación del agente prevalece sobre evaluaciones automáticas
              posteriores. La decisión y su motivo quedan registrados.
            </p>
            <button className="btn btn-primary mt-4" disabled={pending}>
              {pending ? "Guardando decisión…" : "Guardar decisión"}
            </button>
          </>
        )}
      </form>
      {!!incident.revisiones?.length && (
        <section className="mt-6 border-t pt-5">
          <h3 className="font-bold">Historial de revisión</h3>
          <div className="divide-y mt-3">
            {incident.revisiones.map((review) => (
              <article key={review.id} className="py-3">
                <p className="font-medium">
                  {stateLabel(review.accion)} ·{" "}
                  {review.usuario?.nickname ??
                    review.usuario?.nombreUsuario ??
                    "Personal autorizado"}
                </p>
                <p className="muted text-sm">{dateTime(review.creadoEn)}</p>
                <p className="mt-1">{review.motivo}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

export default function IncidentReviewPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const { data, error, loading, reload } =
    useRemote<IncidentReview[]>("/admin/incidents");
  const [status, setStatus] = useState("TODOS");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<IncidentReview | null>(null);
  const [success, setSuccess] = useState("");
  const incidents = (data ?? []).filter((incident) => {
    const matchesStatus =
      status === "TODOS" ||
      (status === "REVISION"
        ? incident.evaluacion === "PENDIENTE" || incident.reportes?.some(report => report.estado === "EN_REVISION")
        : status === "PUBLICADOS"
        ? incident.publicado
        : status === "SIN_PUBLICAR"
          ? !incident.publicado
          : status === "ACTIVO"
            ? incident.publicado &&
              ["ACTIVO", "VALIDADO", "PENDIENTE"].includes(incident.estado)
            : incident.estado === status);
    return (
      matchesStatus &&
      `${incident.tipoNombre ?? incident.tipo} ${incident.descripcion} ${incident.distrito ?? ""} ${incident.id}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  return (
    <>
      <div className="grid-2 mb-5">
        <label className="field">
          Buscar incidente
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tipo, distrito, descripción o número"
          />
        </label>
        <label className="field">
          Mostrar
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="TODOS">Todos</option>
            <option value="REVISION">Pendientes de revisión</option>
            <option value="SIN_PUBLICAR">Pendientes de publicación</option>
            <option value="PUBLICADOS">Visibles en el mapa</option>
            <option value="ACTIVO">Activos</option>
            <option value="RESUELTO">Resueltos</option>
            <option value="FALSO">Declarados falsos</option>
          </select>
        </label>
      </div>
      <Feedback success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {!loading && !error && data && (
        <section className="card">
          <div className="flex justify-between gap-3 mb-4">
            <h2 className="font-bold text-xl">Incidentes en tu ámbito</h2>
            <button className="btn btn-secondary" onClick={reload}>
              Actualizar
            </button>
          </div>
          {incidents.length === 0 ? (
            <p className="muted py-5">
              No hay incidentes que coincidan con estos filtros.
            </p>
          ) : (
            <div className="divide-y">
              {incidents.map((incident) => (
                <article
                  className="py-4 first:pt-0 last:pb-0"
                  key={incident.id}
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="incident-title-with-icon font-bold">
                        <IncidentIcon
                          tipo={incident.tipoNombre ?? incident.tipo}
                          slug={incident.tipoSlug}
                        />
                        <span>
                          {incident.tipoNombre ?? incident.tipo} · #
                          {incident.id}
                        </span>
                      </h3>
                      <p className="muted text-sm mt-1">
                        {incident.distrito ?? "Sin distrito asignado"} ·{" "}
                        {dateTime(incident.fechaCreacion)}
                      </p>
                      <p className="mt-2 line-clamp-2">
                        {incident.descripcion}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <span className="badge">
                          {stateLabel(incident.estado)}
                        </span>
                        <span className="badge">
                          {incidentEvaluationLabel(incident)}
                        </span>
                        {incident.reportes?.some(report => report.estado === 'EN_REVISION') && <span className="badge">Aportes en revisión humana</span>}
                        <span className="badge">
                          Gravedad {incident.nivelRiesgo ?? "por evaluar"}
                        </span>
                        <span className="badge">
                          {number(incident.validacion * 100)} % de peso de validación
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary self-start"
                      onClick={() => {
                        setSelected(incident);
                        setSuccess("");
                      }}
                    >
                      Revisar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {selected && (
        <ReviewDetail
          key={selected.id}
          incident={selected}
          close={() => setSelected(null)}
          done={() => {
            setSelected(null);
            setSuccess(
              "La decisión quedó registrada y el incidente se actualizó.",
            );
            reload();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}
