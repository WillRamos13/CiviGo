"use client";

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowRight, Bell, Map, MapPin, Pause, Play, Route, ShieldCheck, Users } from 'lucide-react';
import HomeVideo from '@/components/HomeVideo';
import CinematicCity from './CinematicCity';
import styles from './CinematicHome.module.css';

const features = [
  { Icon: Map, title: 'Tu ciudad, en contexto.', text: 'Consulta los incidentes, su ubicación y la información disponible antes de decidir.', href: '/mapa', action: 'Explorar el mapa' },
  { Icon: Route, title: 'El camino lo eliges tú.', text: 'Compara los recorridos disponibles a pie, en bicicleta o en auto.', href: '/mapa', action: 'Buscar un recorrido' },
  { Icon: ShieldCheck, title: 'Tu aporte cuenta.', text: 'Comparte lo que ocurre con una ubicación y una descripción clara.', href: '/reportar', action: 'Reportar un incidente' },
  { Icon: Bell, title: 'Mantente al tanto.', text: 'Consulta tus alertas y revisa los detalles de lo que sucede en tu entorno.', href: '/alertas', action: 'Ver alertas' },
];
const steps = [
  { Icon: Map, title: 'Mira a tu alrededor.', hint: 'Explora el mapa y abre los detalles.', label: 'EXPLORA CON CONTEXTO', heading: 'Una vista. Más información.', text: 'Acércate a una zona y consulta los incidentes disponibles.' },
  { Icon: Route, title: 'Elige cómo llegar.', hint: 'Un destino, diferentes recorridos.', label: 'TU DESTINO, TU DECISIÓN', heading: 'Encuentra tu propio camino.', text: 'Elige tu medio de transporte y compara las alternativas disponibles.' },
  { Icon: Users, title: 'Aporta a tu comunidad.', hint: 'Cuenta lo que pasa cerca de ti.', label: 'CONECTA LO QUE SABES', heading: 'Lo que sabes puede ayudar.', text: 'Describe el incidente y confirma dónde ocurrió antes de enviar tu reporte.' },
];

function DeferredFilm() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const node = host.current;
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: '180px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className={styles.filmFrame}>
    {ready ? <HomeVideo /> : <button className={styles.filmPlaceholder} onClick={() => setReady(true)} aria-label="Reproducir presentación de CiviGo">
      <Image src="/civigo-spot-poster.jpg" alt="Presentación de CiviGo: una ciudad más conectada" fill sizes="(max-width: 700px) 100vw, 80vw" />
      <span><Play size={18} aria-hidden /> Ver CiviGo en 30 segundos</span>
    </button>}
  </div>;
}

export default function CinematicHome() {
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = steps[step];
  const StepIcon = active.Icon;
  useEffect(() => {
    const node = root.current;
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-revealed', 'true'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    node.querySelectorAll('[data-home-section]').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const changeStep = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 :
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % steps.length :
        event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : null;
    if (next === null) return;
    event.preventDefault(); setStep(next); tabs.current[next]?.focus();
  };
  return <div ref={root} className={styles.landing} data-motion={paused ? 'off' : 'on'}>
    <section className={styles.hero} id="inicio" aria-labelledby="home-title">
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}><i /> ICA, CONECTADA POR SU GENTE</span>
        <h1 id="home-title">Tu ciudad.<br />Tu camino.<br /><em>Otra perspectiva.</em></h1>
        <p>Lo que pasa cerca de ti importa.<br />Descubre tu entorno y elige cómo recorrerlo.</p>
        <div className={styles.actions}><Link href="/mapa" className={styles.primary} data-home-action="hero_map">Explora Ica <ArrowRight size={18} aria-hidden /></Link><a href="#plataforma" className={styles.textLink}>Conoce CiviGo <ArrowDown size={16} aria-hidden /></a></div>
        <small className={styles.heroNote}>Una ciudad. Muchas formas de conectar.</small>
      </div>
      <div className={styles.cityStage}>
        <CinematicCity paused={paused} />
        <div className={styles.cityLabel}><i /> Ica, Perú <span>14° S · 75° O</span></div>
        <span className={styles.illustrationLabel}>ESCENA ILUSTRATIVA · NO ES UN MAPA EN VIVO</span>
        <button className={styles.motionControl} onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? 'Reanudar animaciones de la portada' : 'Pausar animaciones de la portada'}>{paused ? <Play size={17} aria-hidden /> : <Pause size={17} aria-hidden />}</button>
      </div>
      <a className={styles.scrollHint} href="#plataforma"><span /> DESLIZA PARA DESCUBRIR</a>
    </section>
    <section id="plataforma" className={styles.section} data-home-section>
      <div className={styles.sectionIndex}><span>01 / LA PLATAFORMA</span><span>INFORMACIÓN QUE NOS CONECTA</span></div>
      <div className={styles.twoColumns}><div><span className={styles.eyebrow}>MÁS CERCA. MÁS CONECTADOS.</span><h2>Una mejor forma<br />de <em>leer tu ciudad.</em></h2></div><div className={styles.manifestoCopy}><p>CiviGo reúne reportes ciudadanos, información del entorno y recorridos en un mismo lugar.</p><p>Conocer lo que pasa alrededor te ayuda a decidir con más contexto. Y compartir lo que sabes también puede ayudar a alguien más.</p><Link href="/registro" className={styles.textLink}>Súmate a CiviGo <ArrowRight size={17} aria-hidden /></Link></div></div>
      <div className={styles.purposeStrip}><span><Map size={20} aria-hidden /> Explora tu entorno</span><span><Route size={20} aria-hidden /> Encuentra tu camino</span><span><Users size={20} aria-hidden /> Comparte con tu comunidad</span></div>
    </section>
    <section id="funciones" className={`${styles.section} ${styles.functions}`} data-home-section>
      <div className={styles.sectionIndex}><span>02 / LO QUE PUEDES HACER</span><span>EXPLORA · ELIGE · COMPARTE</span></div>
      <div className={styles.sectionHeading}><h2>Lo cotidiano,<br /><em>con más información.</em></h2><p>Herramientas para entender tu entorno.<br />Desde tu celular o computadora.</p></div>
      <div className={styles.featureGrid}>{features.map(({ Icon, title, text, href, action }, index) => <Link key={title} href={href} className={styles.feature} data-home-action={`feature_${index}`}><div className={styles.featureTop}><span><Icon size={24} aria-hidden /></span><small>0{index + 1}</small></div><h3>{title}</h3><p>{text}</p><span className={styles.featureLink}>{action} <ArrowRight size={17} aria-hidden /></span></Link>)}</div>
    </section>
    <section id="pasos" className={`${styles.section} ${styles.how}`} data-home-section>
      <div className={styles.sectionIndex}><span>03 / ASÍ DE SIMPLE</span><span>EMPIEZA A TU RITMO</span></div>
      <div className={styles.twoColumns}><div><h2>Del mapa<br /><em>a tu día a día.</em></h2><div className={styles.stepList} role="tablist" aria-label="Cómo funciona CiviGo" aria-orientation="vertical">
        {steps.map((item, index) => <button key={item.title} type="button" role="tab" id={`home-step-${index}`} aria-controls="home-step-panel" aria-selected={step === index} tabIndex={step === index ? 0 : -1} ref={node => { tabs.current[index] = node; }} onClick={() => setStep(index)} onKeyDown={event => changeStep(event, index)}><span>0{index + 1}</span><div><strong>{item.title}</strong><small>{item.hint}</small></div><ArrowRight size={18} aria-hidden /></button>)}
      </div></div><div className={styles.stepScene} id="home-step-panel" role="tabpanel" aria-labelledby={`home-step-${step}`} tabIndex={0}><div className={styles.stepGrid} aria-hidden /><div className={styles.stepRing} aria-hidden /><div className={styles.floatingPin} aria-hidden><StepIcon size={38} /></div><div className={styles.stepInfo}><small>{active.label}</small><strong>{active.heading}</strong><p>{active.text}</p></div><span className={styles.sampleCaption}>VISTA CONCEPTUAL</span></div></div>
    </section>
    <section className={`${styles.section} ${styles.film}`} aria-label="Conoce CiviGo" data-home-section><div className={styles.sectionIndex}><span>04 / CIVIGO EN MOVIMIENTO</span><span>CONOCE LA EXPERIENCIA</span></div><DeferredFilm /><div className={styles.filmCaption}><span><Route size={18} aria-hidden /> Tu ciudad se mueve contigo.</span><Link href="/registro">Súmate a CiviGo <ArrowRight size={16} aria-hidden /></Link></div></section>
    <section className={`${styles.section} ${styles.ica}`} data-home-section><span className={styles.eyebrow}>HECHO PARA NUESTRA CIUDAD</span><h2>Ica es mucho más<br />que un punto<br /><em>en el mapa.</em></h2><p>Son nuestros caminos, nuestros encuentros y nuestra gente.<br />Conectemos lo que sabemos. Construyamos comunidad.</p><div className={styles.coordinate}>ICA, PERÚ <span>PROVINCIA DE ICA</span></div><div className={styles.icaOrbit} aria-hidden /></section>
    <section className={`${styles.section} ${styles.closing}`} data-home-section><span className={styles.eyebrow}>EL SIGUIENTE PASO ES TUYO</span><h2>Sal a tu ciudad.<br /><em>Con otra perspectiva.</em></h2><div className={styles.actions}><Link href="/mapa" className={styles.primary} data-home-action="closing_map">Vamos al mapa <ArrowRight size={18} aria-hidden /></Link><Link href="/registro" className={styles.secondary}>Crear mi cuenta <ArrowRight size={18} aria-hidden /></Link></div><Link href="/ranking" className={styles.textLink}>Conoce a la comunidad <Users size={16} aria-hidden /></Link></section>
    <footer className={styles.footer}><Link href="#inicio" className={styles.wordmark} aria-label="CiviGo · Volver al inicio"><MapPin size={25} aria-hidden /><strong>Civi<span>Go</span></strong></Link><span>Tu ciudad, mejor conectada.</span><Link href="/contactanos">Contáctanos ↗</Link></footer>
  </div>;
}
