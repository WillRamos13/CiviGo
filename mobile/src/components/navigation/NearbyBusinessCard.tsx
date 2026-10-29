"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Store,
  Image as ImageIcon,
  Clock3,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { resolveApiUrl } from "../../services/api";
type Business = {
  nombre: string;
  direccion?: string;
  descripcion?: string;
  horario?: string;
  telefono?: string;
  banner?: { url: string; alt?: string } | null;
};
export default function NearbyBusinessCard({
  business,
  onClose,
  onDetails,
  onInteract,
}: {
  business: Business;
  onClose: () => void;
  onDetails: () => void;
  onInteract?: () => void;
}) {
  const [tab, setTab] = useState(0),
    [failed, setFailed] = useState(false),
    start = useRef(0);
  return createPortal(
    <aside
      className="nearby-business-card"
      aria-label={`Negocio cercano: ${business.nombre}`}
      onFocusCapture={onInteract}
      onPointerDown={(event) => {
        onInteract?.();
        start.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (Math.abs(event.clientX - start.current) > 45)
          setTab(event.clientX < start.current ? 1 : 0);
      }}
    >
      <header>
        <small>
          <Store size={12} />
          PUBLICIDAD · CERCA DE TI
        </small>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cerrar recomendación"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div role="tablist" aria-label="Tarjeta del negocio">
        <button role="tab" aria-selected={tab === 0} onClick={() => setTab(0)}>
          <Store size={13} />
          Información
        </button>
        <button role="tab" aria-selected={tab === 1} onClick={() => setTab(1)}>
          <ImageIcon size={13} />
          Publicidad
        </button>
      </div>
      <div className="business-card-slides">
        <div
          className="business-card-track"
          style={{ transform: `translateX(-${tab * 100}%)` }}
        >
          <section
            role="tabpanel"
            aria-label="Información del negocio"
            aria-hidden={tab !== 0}
            inert={tab !== 0}
          >
            <h3>{business.nombre}</h3>
            <p>{business.descripcion}</p>
            {business.direccion && (
              <small>
                <MapPin size={12} />
                {business.direccion}
              </small>
            )}
            {business.horario && (
              <small>
                <Clock3 size={12} />
                {business.horario}
              </small>
            )}
            <button className="btn btn-quiet btn-small" onClick={onDetails}>
              Ver negocio <ChevronRight size={14} />
            </button>
          </section>
          <section
            role="tabpanel"
            aria-label="Publicidad del negocio"
            aria-hidden={tab !== 1}
            inert={tab !== 1}
          >
            {business.banner && !failed ? (
              <button
                type="button"
                onClick={onDetails}
                aria-label={`Ver publicidad de ${business.nombre}`}
              >
                <img
                  src={resolveApiUrl(
                    business.banner.url.replace(/^\/api(?=\/)/, ""),
                  )}
                  alt={business.banner.alt || business.nombre}
                  width={620}
                  height={350}
                  onError={() => setFailed(true)}
                />
              </button>
            ) : (
              <div className="business-card-empty">
                <Store size={30} />
                <strong>{business.nombre}</strong>
                <span>
                  {business.descripcion || "Conoce este negocio de tu ciudad."}
                </span>
              </div>
            )}
          </section>
        </div>
      </div>
      <footer>
        <span className={tab === 0 ? "active" : ""} />
        <span className={tab === 1 ? "active" : ""} />
        <small>Desliza para ver más</small>
      </footer>
    </aside>,
    document.fullscreenElement ?? document.body,
  );
}
