"use client";
import { useEffect, useRef, useState } from "react";
import Image from 'next/image';
import Link from 'next/link';
import {API_URL} from '@/lib/api';
import {metersBetween,formatMeters} from '@/lib/navigation';
import type {Posicion} from '@/lib/types';
import { createPortal } from "react-dom";
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
  currentPosition,
}: {
  business: MapBusiness | null;
  onClose: () => void;
  currentPosition?:Posicion|null;
}) {
  const [failedImage,setFailedImage]=useState('');
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
  const banner=business.banner?.url;
  const safeBanner=banner&&/^\/(?:api\/)?announcements\/[1-9]\d*\/image$/.test(banner)?API_URL+banner.replace(/^\/api(?=\/)/,''):null;
  const navigationLink='/mapa?negocio='+business.id;
  return createPortal(
    <div className="modal-backdrop" style={{zIndex:2100}} onClick={onClose}>
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
          <span className="badge">{business.demo===true?'Negocio de demostración':'Negocio participante'}</span>
          {safeBanner&&failedImage!==safeBanner&&<figure style={{margin:'15px 0'}}><Image src={safeBanner} alt={business.banner?.alt||`Publicidad de ${business.nombre}`} width={700} height={350} unoptimized style={{width:'100%',height:'auto',maxHeight:240,objectFit:'contain',borderRadius:12}} onError={()=>setFailedImage(safeBanner)}/><figcaption className="muted">Publicidad del establecimiento</figcaption></figure>}
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
          {currentPosition&&Number.isFinite(business.latitud)&&Number.isFinite(business.longitud)&&<p>Distancia en línea recta: {formatMeters(metersBetween(currentPosition,business))}</p>}
          <Link href={navigationLink} className="btn btn-primary btn-small" onClick={()=>{window.dispatchEvent(new CustomEvent('civigo:choose-business',{detail:business.id}));onClose();}}>Elegir como destino</Link>
          <small className="muted" style={{display:'block',marginTop:12}}>Los datos son proporcionados por el establecimiento. Los símbolos 3D son ilustrativos.</small>
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
    </div>, document.fullscreenElement ?? document.body
  );
}
