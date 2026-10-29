"use client";
import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  LocateFixed,
  Volume2,
  VolumeX,
  Square,
  LoaderCircle,
  SlidersHorizontal,
  Layers,
  Route as RouteIcon,
  Compass,
  MessageCircle,
  TriangleAlert,
} from "lucide-react";
import { AvatarPicker } from "./NavigationAvatar";
import type { NavigationAvatar } from "@/lib/navigation-avatar";
import { formatMeters, type NavigationProgress } from "@/lib/navigation";
import type { Ruta } from "@/lib/types";
import { reliableSpeed, routeTimeSource } from "@/lib/navigation-presentation";
import { useEffect, useState } from "react";
import styles from "./NavigationGuidance.module.css";
import { formatDuration } from "@/lib/duration";
export type GuidanceProps = {
  progress: NavigationProgress | null;
  notice: string;
  recalculating: boolean;
  muted: boolean;
  toggleMuted: () => void;
  recenter: () => void;
  recalculate?: (reason: string) => void;
  avatar?: NavigationAvatar;
  onAvatarChange?: (avatar: NavigationAvatar) => void;
  onLayers?: () => void;
  onOverview?: () => void;
  onNorth?: () => void;
  avatarNotice?: string;
};
export default function NavigationGuidance({
  route,
  onFinish,
  progress,
  notice,
  recalculating,
  muted,
  toggleMuted,
  recenter,
  recalculate,
  compact = false,
  avatar = "arrow",
  onAvatarChange,
  onLayers,
  onOverview,
  onNorth,
  avatarNotice,
}: GuidanceProps & { route: Ruta; onFinish: () => void; compact?: boolean }) {
  const [options, setOptions] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const Icon =
    progress?.maneuver === "izquierda"
      ? CornerUpLeft
      : progress?.maneuver === "derecha"
        ? CornerUpRight
        : ArrowUp;
  const arrival = progress?.updatedAt
    ? new Date(progress.updatedAt + progress.secondsRemaining * 1000)
    : route.llegadaEstimada
      ? new Date(route.llegadaEstimada)
      : null;
  const speed = reliableSpeed(progress?.position, now);
  return (
    <section
      className={`navigation-guidance ${styles.guidance} ${compact ? styles.compact : ""}`}
      aria-label="Navegación del recorrido"
      data-compact={compact}
    >
      {route.copiaGuardada && (
        <p className="navigation-notice">
          Copia guardada: tiempos y condiciones anteriores. Se intentará
          actualizar desde tu ubicación cuando haya conexión.
        </p>
      )}
      <div className={`next-maneuver ${styles.maneuver}`}>
        <Icon size={30} aria-hidden="true" />
        <div title={progress?.instruction}>
          <strong>
            {progress
              ? formatMeters(progress.distanceToTurn)
              : "Esperando GPS…"}
          </strong>
          <p>
            {progress?.instruction ??
              "Permite el acceso a tu ubicación para iniciar."}
          </p>
        </div>
      </div>
      <div className={styles.metrics}>
        <div className={styles.remaining}>
          <strong>
            {formatDuration(progress?.secondsRemaining ?? route.duracion)}
          </strong>
          <span>
            {formatMeters(progress?.distanceRemaining ?? route.distancia)} ·{" "}
            {arrival && Number.isFinite(arrival.getTime())
              ? `Llegada ${arrival.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" })}`
              : "Llegada pendiente del GPS"}
          </span>
        </div>
        <div
          className={styles.speed}
          aria-label={
            speed === null
              ? "Velocidad GPS no disponible"
              : `Velocidad GPS ${speed} kilómetros por hora`
          }
          title={
            speed === null
              ? "Se necesita una lectura GPS reciente y precisa."
              : undefined
          }
        >
          <strong>{speed ?? "—"}</strong>
          <small>km/h</small>
        </div>
        <button type="button" className={styles.finish} onClick={onFinish}>
          <Square size={12} aria-hidden="true" />
          Finalizar
        </button>
      </div>
      <small className={styles.source}>{routeTimeSource(route, now)}</small>
      {notice && (
        <p className={styles.notice} role="status">
          {recalculating && <LoaderCircle size={13} className="spin" />}
          {notice}
        </p>
      )}
      <div className={`navigation-actions ${styles.controls}`}>
        <button
          type="button"
          className="icon-btn"
          aria-label={muted ? "Activar voz" : "Silenciar voz"}
          onClick={toggleMuted}
        >
          {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={recenter}
        >
          <LocateFixed size={14} />
          Centrar
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Abrir asistente de CiviGo"
          onClick={() =>
            window.dispatchEvent(new Event("civigo:open-assistant"))
          }
        >
          <MessageCircle size={18} />
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          aria-expanded={options}
          onClick={() => setOptions((value) => !value)}
        >
          <SlidersHorizontal size={15} />
          Opciones
        </button>
      </div>
      {options && (
        <div className={styles.options} aria-label="Opciones del recorrido">
          <div className={styles.controls}>
            {onLayers && (
              <button
                className="btn btn-secondary btn-small"
                onClick={onLayers}
              >
                <Layers size={14} />
                Capas y ambiente
              </button>
            )}
            {onOverview && (
              <button
                className="btn btn-secondary btn-small"
                onClick={onOverview}
              >
                <RouteIcon size={14} />
                Ver ruta completa
              </button>
            )}
            {onNorth && (
              <button className="btn btn-secondary btn-small" onClick={onNorth}>
                <Compass size={14} />
                Orientar al norte
              </button>
            )}
            {recalculate && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={recalculating}
                onClick={() =>
                  recalculate("Actualizando el recorrido a petición tuya…")
                }
              >
                <LoaderCircle size={14} />
                Recalcular
              </button>
            )}
            <a
              className="btn btn-secondary btn-small"
              href="/reportar"
              target="_blank"
              rel="noopener noreferrer"
              title="Abre el formulario en otra pestaña y conserva la navegación"
            >
              <TriangleAlert size={14} />
              Reportar incidente ↗
            </a>
          </div>
          {onAvatarChange && (
            <AvatarPicker value={avatar} onChange={onAvatarChange} />
          )}
          {avatarNotice && (
            <p className="notice" role="status">
              {avatarNotice}
            </p>
          )}
          <small className="muted">
            La voz requiere que el navegador la admita. Reportar abre otra
            pestaña para mantener el recorrido. Detente en un lugar seguro antes
            de cambiar opciones.
          </small>
        </div>
      )}
      {!compact && (
        <small className="muted">
          Mantén esta página abierta durante el recorrido.
        </small>
      )}
    </section>
  );
}
