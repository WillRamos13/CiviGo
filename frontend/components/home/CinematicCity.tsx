"use client";

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { CityController } from './create-city';
import styles from './CinematicCity.module.css';

export default function CinematicCity({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<CityController | null>(null);
  const pausedRef = useRef(paused);
  const [ready, setReady] = useState(false);
  useEffect(() => { pausedRef.current = paused; controller.current?.setPaused(paused); }, [paused]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    let disposed = false, visible = false, loading = false, idle: number | undefined;
    const lightweight = () => motion.matches || device.connection?.saveData || (device.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2;
    const mount = async () => {
      if (disposed || !visible || lightweight() || loading || controller.current) return;
      loading = true;
      try {
        const { createCity } = await import('./create-city');
        if (disposed || lightweight() || !visible) return;
        controller.current = createCity(node, () => { if (!disposed) setReady(false); });
        controller.current.setPaused(pausedRef.current);
        controller.current.setVisible(visible);
        setReady(true);
      } catch { /* The SVG remains available if WebGL or its chunk is unavailable. */ }
      finally { loading = false; }
    };
    const schedule = () => {
      if (idle !== undefined || lightweight()) return;
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => { idle = undefined; void mount(); }, { timeout: 1800 });
      else idle = window.setTimeout(() => { idle = undefined; void mount(); }, 350);
    };
    const preference = () => {
      if (lightweight()) { controller.current?.dispose(); controller.current = null; setReady(false); }
      else if (visible) schedule();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      controller.current?.setVisible(visible);
      if (visible) schedule();
    }, { rootMargin: '100px' });
    observer.observe(node);
    motion.addEventListener('change', preference);
    return () => {
      disposed = true; observer.disconnect(); motion.removeEventListener('change', preference);
      if (idle !== undefined) { if ('cancelIdleCallback' in window) window.cancelIdleCallback(idle); else clearTimeout(idle); }
      controller.current?.dispose(); controller.current = null;
    };
  }, []);
  return <div className={styles.scene} data-city-ready={ready} role="img" aria-label="Ciudad tridimensional ilustrativa inspirada en Ica, con calles, una plaza y marcadores azules">
    <Image className={styles.fallback} src="/home/city-fallback.svg" alt="" fill sizes="(max-width: 700px) 100vw, 70vw" priority unoptimized />
    <div ref={host} className={styles.canvas} aria-hidden />
  </div>;
}
