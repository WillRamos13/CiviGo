'use client';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { useLiveRefresh } from '@/lib/use-live-refresh';
export interface MapBusiness { id: number; nombre: string; descripcion?: string; latitud: number; longitud: number; direccion?: string; horario?: string; promocion?: string; telefono?: string; sitioWeb?: string }
type Announcement = {id: number; tipo: 'NOVEDAD' | 'NEGOCIO'; titulo: string; mensaje: string; enlace: string | null; negocio: MapBusiness | null};
export const BUSINESS_DETAILS_EVENT = 'civigo:business-details';
export default function MapAnnouncements() {
    const {usuario} = useAuth();
    const [items, setItems] = useState<Announcement[]>([]), [index, setIndex] = useState(0);
    const load = useCallback(async (signal: AbortSignal) => {
        try { const data = await api<Announcement[]>('/announcements', {signal}); if (!signal.aborted) setItems(data); }
        catch { if (!signal.aborted) setItems([]); }
    }, []);
    const refresh = useLiveRefresh(load, 60000);
    useEffect(() => { refresh(); }, [usuario?.id, usuario?.premium, usuario?.ocultarAnuncios, refresh]);
    const visible = items.filter(a => a.tipo !== 'NEGOCIO' || !(usuario?.premium && usuario.ocultarAnuncios));
    useEffect(() => { if (visible.length < 2) return; const timer = setInterval(() => setIndex(i => i + 1), 10000); return () => clearInterval(timer); }, [visible.length]);
    const current = visible.length ? visible[index % visible.length] : null;
    const content = <><Megaphone size={21} aria-hidden="true"/><span>{current ? <><strong>{current.titulo}</strong><span className="announcement-description">{current.mensaje}</span></> : 'Anuncios y novedades de CiviGo'}</span></>;
    const openBusiness = () => { if (current?.negocio) window.dispatchEvent(new CustomEvent(BUSINESS_DETAILS_EVENT, {detail: current.negocio})); };
    let url: string | null = null;
    try { if (current?.enlace) { const parsed = new URL(current.enlace, typeof window !== 'undefined' ? window.location.origin : 'https://civigo.online'); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } } catch { /* Invalid links remain plain text. */ }
    return <div className="map-announcements" aria-label="Anuncios y novedades">
        {visible.length > 1 && <button className="icon-btn" aria-label="Anuncio anterior" onClick={() => setIndex(i => (i - 1 + visible.length) % visible.length)}><ChevronLeft size={16}/></button>}
        {current?.tipo === 'NEGOCIO' && current.negocio ? <button className="announcement-content" onClick={openBusiness}>{content}</button> : url ? <a className="announcement-content" href={url} target="_blank" rel="noopener noreferrer">{content}</a> : <div className="announcement-content">{content}</div>}
        {visible.length > 1 && <button className="icon-btn" aria-label="Anuncio siguiente" onClick={() => setIndex(i => i + 1)}><ChevronRight size={16}/></button>}
    </div>;
}
