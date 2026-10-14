'use client';
import { useState } from 'react';
import { Megaphone, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { API_URL } from '@/lib/api';
import { announcementImagePath, announcementLink, BUSINESS_DETAILS_EVENT } from '@/lib/announcements';
import { useAnnouncements } from '@/lib/use-announcements';
import styles from './MapAnnouncements.module.css';
export type { MapBusiness } from '@/lib/announcements';
export { BUSINESS_DETAILS_EVENT } from '@/lib/announcements';
export default function MapAnnouncements() {
    const { current, count, setPaused, previous, next } = useAnnouncements('CABECERA');
    const [failedImage, setFailedImage] = useState('');
    const imageKey = current?.imagen ? `${current.id}:${current.imagen.id}` : '';
    const imagePath = current?.imagen && failedImage !== imageKey ? announcementImagePath(current.id, current.imagen.id) : null;
    const content = <>{imagePath && current?.imagen ? <span className={styles.media}><Image key={imageKey} className={`announcement-image ${styles.image}`} src={API_URL + imagePath} alt={current.imagen.alt || current.titulo} width={600} height={60} unoptimized onError={() => setFailedImage(imageKey)}/></span> : <Megaphone size={21} aria-hidden="true"/>}<span className={imagePath && !current?.mensaje ? 'sr-only' : `announcement-text ${imagePath ? styles.text : ''}`}>{current ? <><strong className={imagePath ? styles.title : undefined}>{current.titulo}</strong><span className="announcement-description">{current.mensaje}</span></> : 'Anuncios y novedades de CiviGo'}</span></>;
    const openBusiness = () => { if (current?.negocio) window.dispatchEvent(new CustomEvent(BUSINESS_DETAILS_EVENT, {detail: current.negocio})); };
    const url = announcementLink(current?.enlace, typeof window !== 'undefined' ? window.location.origin : 'https://civigo.online');
    const contentClass = `announcement-content${imagePath ? ` announcement-media-content ${styles.content}` : ''}`;
    return <div className={`map-announcements${imagePath ? ' map-announcements-media' : ''}`} aria-label="Anuncios y novedades" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
        {count > 1 && <button className="icon-btn" aria-label="Anuncio anterior" onClick={previous}><ChevronLeft size={16}/></button>}
        {current?.tipo === 'NEGOCIO' && current.negocio ? <button className={contentClass} onClick={openBusiness}>{content}</button> : url ? <a className={contentClass} href={url} target="_blank" rel="noopener noreferrer">{content}</a> : <div className={contentClass}>{content}</div>}
        {count > 1 && <button className="icon-btn" aria-label="Anuncio siguiente" onClick={next}><ChevronRight size={16}/></button>}
    </div>;
}
