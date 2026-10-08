"use client";
import { useEffect, useRef } from "react";
import type { MapBusiness } from "./MapAnnouncements";

function safeWebsite(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function BusinessDetailsDialog({
  business,
  onClose,
}: {
  business: MapBusiness | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null),
    close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!business) return;
    const previousOverflow = document.body.style.overflow,
      previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),a[href]",
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("keydown", keyboard);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [business]);
  if (!business) return null;
  const website = safeWebsite(business.sitioWeb);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={panel}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Ficha del negocio"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h2>{business.nombre}</h2>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Cerrar ficha"
          >
            ×
          </button>
        </div>
        <div className="card">
          <span className="badge">Negocio participante · Demostración</span>
          <p style={{ marginTop: 15 }}>{business.descripcion}</p>
          <p>
            <strong>Dirección:</strong> {business.direccion || "No indicada"}
          </p>
          <p>
            <strong>Horario:</strong> {business.horario || "No indicado"}
          </p>
          {business.promocion && (
            <div className="notice">{business.promocion}</div>
          )}
          {business.telefono && (
            <p>
              <strong>Contacto:</strong> {business.telefono}
            </p>
          )}
          {website && (
            <p>
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-small"
              >
                Visitar sitio del negocio ↗
              </a>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
