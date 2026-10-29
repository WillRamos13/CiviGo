"use client";
import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Volume2,
  VolumeX,
  Square,
  SlidersHorizontal,
  Route as RouteIcon,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AvatarPicker } from "./NavigationAvatar";
import type { NavigationAvatar } from "@/lib/navigation-avatar";
import { formatMeters, type NavigationProgress } from "@/lib/navigation";
import { reliableSpeed, routeTimeSource } from "@/lib/navigation-presentation";
import { formatDuration } from "@/lib/duration";
import type { Ruta } from "@/lib/types";
import styles from "./NavigationGuidance.module.css";
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
  recalculate,
  onOverview,
  avatar = "arrow",
  onAvatarChange,
  avatarNotice,
}: GuidanceProps & { route: Ruta; onFinish: () => void; compact?: boolean }) {
  const [options, setOptions] = useState(false),
    [now, setNow] = useState(Date.now);
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
      className={`navigation-guidance ${styles.guidance}`}
      aria-label="Navegación del recorrido"
    >
      <div className={`next-maneuver ${styles.maneuver}`}>
        <Icon size={32} />
        <div>
          <strong>
            {progress
              ? formatMeters(progress.distanceToTurn)
              : "Esperando GPS…"}
          </strong>
          <p>
            {progress?.instruction ||
              "Permite el acceso a tu ubicación para iniciar."}
          </p>
        </div>
      </div>
      <div className={styles.metrics}>
        <div>
          <strong>
            {formatDuration(progress?.secondsRemaining ?? route.duracion)}
          </strong>
          <span>
            {formatMeters(progress?.distanceRemaining ?? route.distancia)}
            {arrival &&
              Number.isFinite(arrival.getTime()) &&
              ` · Llegada ${arrival.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" })}`}
          </span>
        </div>
        <div
          className={styles.speed}
          aria-label={
            speed === null
              ? "Velocidad GPS no disponible"
              : `Velocidad GPS ${speed} kilómetros por hora`
          }
        >
          <strong>{speed ?? "—"}</strong>
          <small>km/h</small>
        </div>
        <button className={styles.finish} onClick={onFinish}>
          <Square size={12} />
          Finalizar
        </button>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {recalculating && "Actualizando · "}
          {notice}
        </p>
      )}
      <button
        type="button"
        className={`icon-btn ${styles.optionsButton}`}
        aria-label="Opciones del recorrido"
        title="Opciones del recorrido"
        aria-expanded={options}
        onClick={() => setOptions((v) => !v)}
      >
        <SlidersHorizontal size={20} />
      </button>
      {options && (
        <aside className={styles.options} aria-label="Opciones del recorrido">
          <h3>Tu recorrido</h3>
          <div className={styles.controls}>
            <button
              className="btn btn-secondary btn-small"
              aria-label={muted ? "Activar voz" : "Silenciar voz"}
              onClick={toggleMuted}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}{" "}
              {muted ? "Activar voz" : "Silenciar voz"}
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={() =>
                window.dispatchEvent(new Event("civigo:open-assistant"))
              }
            >
              <MessageCircle size={16} />
              Asistente
            </button>
            {onOverview && (
              <button
                className="btn btn-secondary btn-small"
                onClick={onOverview}
              >
                <RouteIcon size={16} />
                Ver ruta completa
              </button>
            )}
            {recalculate && (
              <button
                className="btn btn-secondary btn-small"
                disabled={recalculating}
                onClick={() =>
                  recalculate("Actualizando el recorrido a petición tuya…")
                }
              >
                <RefreshCw size={16} />
                Recalcular
              </button>
            )}
          </div>
          {onAvatarChange && (
            <AvatarPicker value={avatar} onChange={onAvatarChange} />
          )}
          <small>{routeTimeSource(route, now)}</small>
          {route.copiaGuardada && (
            <p className="notice">
              Copia guardada. Actualiza las condiciones antes de circular.
            </p>
          )}
          {avatarNotice && <p role="status">{avatarNotice}</p>}
        </aside>
      )}
    </section>
  );
}
