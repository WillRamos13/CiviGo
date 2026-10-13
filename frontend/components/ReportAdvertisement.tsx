'use client';
import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ExternalLink, Megaphone } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { announcementImagePath, announcementLink, BUSINESS_DETAILS_EVENT } from '@/lib/announcements';
import { useAnnouncements } from '@/lib/use-announcements';
import styles from './ReportAdvertisement.module.css';

export default function ReportAdvertisement() {
  const { current, count, setPaused, previous, next } = useAnnouncements('REPORTAR');
  const [failedImage, setFailedImage] = useState('');
  const imageKey = current?.imagen ? `${current.id}:${current.imagen.id}` : '';
  const imagePath = current?.imagen && failedImage !== imageKey ? announcementImagePath(current.id, current.imagen.id) : null;
  const link = announcementLink(current?.enlace, typeof window !== 'undefined' ? window.location.origin : 'https://civigo.online');
  const openBusiness = () => {
    if (current?.negocio) window.dispatchEvent(new CustomEvent(BUSINESS_DETAILS_EVENT, { detail: current.negocio }));
  };
  const content = current ? <>
    {imagePath && current.imagen && <Image key={imageKey} className={styles.image} src={API_URL + imagePath} alt={current.imagen.alt || current.titulo} width={700} height={900} unoptimized onError={() => setFailedImage(imageKey)}/>}
    <span className={styles.copy}><strong>{current.titulo}</strong>{current.mensaje && <span>{current.mensaje}</span>}{(link || current.negocio) && <span className={styles.action}>{current.negocio ? 'Conocer el negocio' : 'Ver más'}<ExternalLink size={15} aria-hidden="true"/></span>}</span>
  </> : <div className={styles.empty}><Megaphone size={26} aria-hidden="true"/><p>Anuncios y novedades de CiviGo</p></div>;
  return <section className={styles.panel} aria-label="Anuncios de Reportar" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <div className={styles.heading}><span>{current?.tipo === 'NEGOCIO' ? 'Publicidad' : 'Anuncios y novedades'}</span>{count > 1 && <div className={styles.controls}><button type="button" aria-label="Banner anterior" onClick={previous}><ChevronLeft size={17}/></button><button type="button" aria-label="Banner siguiente" onClick={next}><ChevronRight size={17}/></button></div>}</div>
    {current?.tipo === 'NEGOCIO' && current.negocio ? <button type="button" className={styles.content} onClick={openBusiness}>{content}</button> : link ? <a className={styles.content} href={link} target="_blank" rel="noopener noreferrer">{content}</a> : <div className={styles.content}>{content}</div>}
  </section>;
}
