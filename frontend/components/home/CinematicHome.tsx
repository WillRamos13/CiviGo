"use client";

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Bike, Car, ChevronRight, Compass, Footprints, Gift, MapPin, Play, Route, Users } from 'lucide-react';
import HomeVideo from '@/components/HomeVideo';
import CinematicCity from './CinematicCity';
import styles from './CinematicHome.module.css';

const steps = [
  { title: 'Mira lo que pasa.', hint: 'Un mapa para entender tu entorno.', label: '01 / EXPLORA', heading: 'Antes de salir, mira tu ciudad.', text: 'Consulta los incidentes disponibles, abre sus detalles y filtra lo que quieres ver. Tú decides con qué información moverte.', action: 'Explorar el mapa', href: '/mapa', Icon: Compass },
  { title: 'Encuentra tu camino.', hint: 'A pie, en bicicleta o en auto.', label: '02 / ELIGE', heading: 'Un destino. Tu forma de llegar.', text: 'Busca un lugar, elige cómo te mueves y compara el tiempo, la distancia y el riesgo registrado de los recorridos disponibles.', action: 'Buscar un recorrido', href: '/mapa', Icon: Route },
  { title: 'Haz que se sepa.', hint: 'Lo que ves puede ayudar a alguien.', label: '03 / COMPARTE', heading: 'La ciudad también se cuenta contigo.', text: 'Describe qué ocurrió, confirma el lugar y adjunta tus pruebas. Consulta después el estado de tu aporte desde Mis reportes.', action: 'Reportar un incidente', href: '/reportar', Icon: Users },
] as const;
const transport = [
  { name: 'A pie', Icon: Footprints, text: 'Para las vueltas del día a día. Encuentra tu destino y compara los caminos a pie.' },
  { name: 'Bicicleta', Icon: Bike, text: 'La ciudad a tu ritmo. Elige bicicleta y consulta las alternativas disponibles para pedalear.' },
  { name: 'Auto', Icon: Car, text: 'Más contexto al volante. Revisa la duración estimada y la información del recorrido antes de salir.' },
] as const;

function DeferredFilm() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const node = host.current;
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className={styles.filmFrame}>
    {ready ? <HomeVideo /> : <button type="button" className={styles.filmPlaceholder} onClick={() => setReady(true)} aria-label="Reproducir presentación de CiviGo">
      <Image src="/civigo-spot-poster.jpg" alt="Presentación de CiviGo" fill sizes="(max-width: 700px) 100vw, 75vw" />
      <span><Play size={18} aria-hidden /> Reproducir presentación</span>
    </button>}
  </div>;
}

export default function CinematicHome() {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = steps[step];
  const StepIcon = active.Icon;
  const changeStep = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 :
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % steps.length :
        event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : null;
    if (next === null) return;
    event.preventDefault(); setStep(next); tabs.current[next]?.focus();
  };
  return <div className={styles.landing}>
    <section id="inicio" className={styles.masthead} aria-labelledby="home-title">
      <div className={styles.mastheadCopy}><div><h1 id="home-title">Civi<span>Go</span></h1><p className={styles.slogan}>Tu ciudad más segura</p></div><div className={styles.actions}><Link href="/mapa" className={styles.primary} data-home-action="hero_map">Explorar mapa <ArrowUpRight size={19} aria-hidden /></Link><a href="#experiencia" className={styles.textLink}>Ver cómo funciona <ArrowDown size={16} aria-hidden /></a></div></div>
      <CinematicCity />
    </section>
    <section id="experiencia" className={styles.experience} aria-labelledby="experience-title">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>MENOS SUPOSICIONES. MÁS CONTEXTO.</span><h2 id="experience-title">La información también<br />te ayuda a <em>llegar.</em></h2></div><p>Del primer vistazo al siguiente paso.<br />Así se vive CiviGo.</p></div>
      <div className={styles.experienceLayout}>
        <div className={styles.stepList} role="tablist" aria-label="Cómo funciona CiviGo" aria-orientation="vertical">
          {steps.map((item, index) => <button type="button" key={item.title} role="tab" id={`home-step-${index}`} aria-controls="home-step-panel" aria-selected={step === index} tabIndex={step === index ? 0 : -1} ref={node => { tabs.current[index] = node; }} onClick={() => setStep(index)} onKeyDown={event => changeStep(event, index)}><span className={styles.stepNumber}>0{index + 1}</span><span className={styles.stepText}><strong>{item.title}</strong><small>{item.hint}</small></span><ArrowUpRight size={19} aria-hidden /></button>)}
          <Link className={styles.understatedLink} href="/registro">Tu ciudad empieza contigo. Crear cuenta <ArrowRight size={15} aria-hidden /></Link>
        </div>
        <div className={styles.preview} id="home-step-panel" role="tabpanel" aria-labelledby={`home-step-${step}`} tabIndex={0} data-home-step={step}>
          <Image src="/home/ica-streets.svg" alt="Calles del centro de Ica y ubicación de la Plaza de Armas, Luren y la UTP" fill sizes="(max-width: 700px) 100vw, 55vw" unoptimized className={styles.streetMap} />
          <span className={styles.previewLabel}><span className={styles.statusDot} /> ICA / VISTA GUIADA</span>
          <span className={styles.mapCompass} aria-hidden>N<Compass size={23} /></span>
          <div className={styles.previewCard}><span className={styles.previewIcon}><StepIcon size={22} aria-hidden /></span><small>{active.label}</small><h3>{active.heading}</h3><p>{active.text}</p><Link href={active.href} className={styles.previewAction}>{active.action} <ArrowUpRight size={17} aria-hidden /></Link></div>
          <small className={styles.previewNote}>Vista de presentación. Consulta los reportes actuales en el mapa.</small>
        </div>
      </div>
    </section>
    <section className={styles.mobility} aria-labelledby="mobility-title">
      <div className={styles.mobilityIntro}><span className={styles.eyebrow}>TU RITMO. TU RECORRIDO.</span><h2 id="mobility-title">Una ciudad.<br /><em>Tres maneras de ir.</em></h2><p>Al trabajo, a clases o de vuelta a casa.<br />Elige cómo quieres moverte.</p></div>
      <div className={styles.mobilityContent}><div className={styles.transport} role="group" aria-label="Formas de recorrer Ica">{transport.map(({ name, Icon }, index) => <button type="button" key={name} aria-pressed={mode === index} onClick={() => setMode(index)}><Icon size={28} strokeWidth={1.5} aria-hidden /><span>{name}</span>{mode === index && <span className={styles.selectedDot} aria-hidden />}</button>)}</div><p className={styles.transportText} aria-live="polite">{transport[mode].text}</p><Link href="/mapa" className={styles.mobilityLink}>Elegir mi destino <ArrowRight size={18} aria-hidden /></Link></div>
    </section>
    <section className={styles.film} aria-label="Conoce CiviGo"><div className={styles.filmHeading}><span className={styles.eyebrow}><Play size={13} aria-hidden /> CIVIGO EN 30 SEGUNDOS</span><h2>Esto es <em>moverse con contexto.</em></h2></div><DeferredFilm /></section>
    <section id="nuestra-ciudad" className={styles.community} aria-labelledby="community-title">
      <div className={styles.communityPhoto}><Image src="/home/ica-plaza.webp" alt="La Plaza de Armas de Ica, sus árboles, la fuente y la vida de la ciudad" fill sizes="(max-width: 700px) 100vw, 45vw" /><span><MapPin size={14} aria-hidden /> PLAZA DE ARMAS · ICA</span></div>
      <div className={styles.communityCopy}><span className={styles.eyebrow}>LO MEJOR DE ICA ES SU GENTE.</span><h2 id="community-title">El mapa lo vemos todos.<br /><em>La comunidad<br />la hacemos juntos.</em></h2><p>Un reporte bien ubicado. Un detalle que faltaba. Una confirmación a tiempo. Los pequeños aportes también cambian cómo conocemos nuestra ciudad.</p><Link href="/ranking" className={styles.textLink}>Conocer a la comunidad <ArrowUpRight size={17} aria-hidden /></Link><div className={styles.rewardNote}><span><Gift size={23} aria-hidden /></span><p><strong>Participar también tiene recompensas.</strong><br />Conoce los puntos y los canjes disponibles.</p><Link href="/recompensas" aria-label="Ver las recompensas de CiviGo"><ArrowUpRight size={21} aria-hidden /></Link></div></div>
    </section>
    <section className={styles.questions} aria-labelledby="questions-title"><div><span className={styles.eyebrow}>ANTES DE EMPEZAR</span><h2 id="questions-title">Las cosas claras.</h2></div><div className={styles.questionList}>
      <details><summary>¿Qué puedo consultar en el mapa?<ChevronRight size={17} aria-hidden /></summary><p>Incidentes disponibles, detalles de lugares y alternativas para tus recorridos. Los filtros te permiten elegir tipos de incidente y años.</p></details>
      <details><summary>¿Necesito una cuenta para reportar?<ChevronRight size={17} aria-hidden /></summary><p>Sí. Inicia sesión y verifica tu correo para enviar tus aportes. Desde Mis reportes puedes consultar su evaluación y aportar más información.</p></details>
      <details><summary>¿La ruta con menor riesgo garantiza seguridad?<ChevronRight size={17} aria-hidden /></summary><p>No. CiviGo compara la información registrada y disponible. Los reportes pueden estar pendientes de revisión y la ausencia de reportes no garantiza seguridad.</p></details>
    </div></section>
    <section className={styles.closing} aria-labelledby="closing-title"><div className={styles.closingMark} aria-hidden><MapPin size={46} strokeWidth={1.2} /></div><span className={styles.eyebrow}>NOS ENCONTRAMOS EN EL CAMINO.</span><h2 id="closing-title">Hay una ciudad ahí fuera.<br /><em>Vamos a conocerla mejor.</em></h2><div className={styles.actions}><Link href="/mapa" className={styles.primary} data-home-action="closing_map">Vamos al mapa <ArrowUpRight size={18} aria-hidden /></Link><Link href="/registro" className={styles.secondary}>Ser parte de CiviGo <ArrowRight size={17} aria-hidden /></Link></div></section>
    <footer className={styles.footer}><Link href="#inicio" className={styles.wordmark} aria-label="CiviGo · Volver al inicio"><MapPin size={23} aria-hidden /><strong>Civi<span>Go</span></strong></Link><span>De Ica. Para conectar Ica.</span><Link href="/privacidad">Privacidad</Link><Link href="/contactanos">Hablemos <ArrowUpRight size={14} aria-hidden /></Link><details className={styles.credits}><summary>Créditos visuales</summary><p>Huacachina: <a href="https://commons.wikimedia.org/wiki/File:Overview_of_Huacachina.jpg" target="_blank" rel="noopener noreferrer">Havardtl</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Plaza de Armas: <a href="https://commons.wikimedia.org/wiki/File:Plaza_de_armas_de_Ica.jpg" target="_blank" rel="noopener noreferrer">Txolo</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>. Fotografías recortadas y convertidas a WebP. Calles y huellas: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>, ODbL. Alturas y fachadas pendientes de documentación.</p></details></footer>
  </div>;
}
