'use client';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { api, API_URL } from '@/lib/api';
import { announcementImagePath, announcementLink } from '@/lib/announcements';
import { useAuth } from './AuthProvider';
import { useLiveRefresh } from '@/lib/use-live-refresh';
export interface MapBusiness { id: number; nombre: string; descripcion?: string; latitud: number; longitud: number; direccion?: string; horario?: string; promocion?: string; telefono?: string; sitioWeb?: string }
type Announcement = {id: number; tipo: 'NOVEDAD' | 'NEGOCIO'; titulo: string; mensaje: string; enlace: string | null; negocio: MapBusiness | null; imagen?: {id: string; alt: string} | null};
export const BUSINESS_DETAILS_EVENT = 'civigo:business-details';
export default function MapAnnouncements() {
    const {usuario} = useAuth();
    const [items, setItems] = useState<Announcement[]>([]), [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false), [failedImage, setFailedImage] = useState('');
    const load = useCallback(async (signal: AbortSignal) => {
        try { const data = await api<Announcement[]>('/announcements', {signal}); if (!signal.aborted) setItems(data); }
        catch { if (!signal.aborted) setItems([]); }
    }, []);
    const refresh = useLiveRefresh(load, 60000);
    useEffect(() => { refresh(); }, [usuario?.id, usuario?.premium, usuario?.ocultarAnuncios, refresh]);
    const visible = items.filter(a => a.tipo !== 'NEGOCIO' || !(usuario?.premium && usuario.ocultarAnuncios));
    useEffect(() => { if (visible.length < 2 || paused) return; const timer = setInterval(() => setIndex(i => i + 1), 10000); return () => clearInterval(timer); }, [visible.length, paused]);
    const current = visible.length ? visible[index % visible.length] : null;
    const imageKey = current?.imagen ? `${current.id}:${current.imagen.id}` : '';
    const imagePath = current?.imagen && failedImage !== imageKey ? announcementImagePath(current.id, current.imagen.id) : null;
    const content = <>{imagePath && current?.imagen ? <Image key={imageKey} className="announcement-image" src={API_URL + imagePath} alt={current.imagen.alt || current.titulo} width={600} height={60} unoptimized onError={() => setFailedImage(imageKey)}/> : <Megaphone size={21} aria-hidden="true"/>}<span className={imagePath && !current?.mensaje ? 'sr-only' : 'announcement-text'}>{current ? <><strong>{current.titulo}</strong><span className="announcement-description">{current.mensaje}</span></> : 'Anuncios y novedades de CiviGo'}</span></>;
    const openBusiness = () => { if (current?.negocio) window.dispatchEvent(new CustomEvent(BUSINESS_DETAILS_EVENT, {detail: current.negocio})); };
    const url = announcementLink(current?.enlace, typeof window !== 'undefined' ? window.location.origin : 'https://civigo.online');
    const contentClass = `announcement-content${imagePath ? ' announcement-media-content' : ''}`;
    return <div className={`map-announcements${imagePath ? ' map-announcements-media' : ''}`} aria-label="Anuncios y novedades" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
        {visible.length > 1 && <button className="icon-btn" aria-label="Anuncio anterior" onClick={() => setIndex(i => (i - 1 + visible.length) % visible.length)}><ChevronLeft size={16}/></button>}
        {current?.tipo === 'NEGOCIO' && current.negocio ? <button className={contentClass} onClick={openBusiness}>{content}</button> : url ? <a className={contentClass} href={url} target="_blank" rel="noopener noreferrer">{content}</a> : <div className={contentClass}>{content}</div>}
        {visible.length > 1 && <button className="icon-btn" aria-label="Anuncio siguiente" onClick={() => setIndex(i => i + 1)}><ChevronRight size={16}/></button>}
    </div>;
}
