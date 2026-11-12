"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import {
  CITY_LANDMARKS,
  type CitySceneData,
  type LandmarkId,
} from "@/lib/city-scene";
import type { IcaCityController } from "./create-ica-city";
import styles from "./CinematicCity.module.css";

export default function CinematicCity() {
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<IcaCityController | null>(null);
  const [selected, setSelected] = useState<LandmarkId | null>(null),
    [paused, setPaused] = useState(false);
  const selectedRef = useRef(selected),
    pausedRef = useRef(paused);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const landmark = CITY_LANDMARKS.find((item) => item.id === selected);
  useEffect(() => {
    selectedRef.current = selected;
    controller.current?.select(selected);
  }, [selected]);
  useEffect(() => {
    pausedRef.current = paused;
    controller.current?.setPaused(paused);
  }, [paused]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const device = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const lightweight = () =>
      motion.matches ||
      device.connection?.saveData ||
      (device.deviceMemory ?? 8) <= 2 ||
      (navigator.hardwareConcurrency || 8) <= 2;
    const abort = new AbortController();
    let disposed = false,
      visible = false,
      loading = false,
      idle: number | undefined;
    const lose = () => {
      if (disposed) return;
      controller.current?.dispose();
      controller.current = null;
      setReady(false);
      setFailed(true);
    };
    const mount = async () => {
      if (
        disposed ||
        !visible ||
        lightweight() ||
        loading ||
        controller.current
      )
        return;
      loading = true;
      try {
        const [{ createIcaCity }, response] = await Promise.all([
          import("./create-ica-city"),
          fetch("/home/ica-city.json", { signal: AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]) }),
        ]);
        if (!response.ok) throw Error("city-data");
        const data = (await response.json()) as CitySceneData;
        if (disposed || lightweight() || !visible) return;
        controller.current = createIcaCity(
          node,
          data,
          (id) => setSelected(id),
          lose,
        );
        controller.current.select(selectedRef.current);
        controller.current.setPaused(pausedRef.current);
        controller.current.setVisible(visible);
        setReady(true);
        setFailed(false);
      } catch {
        if (!disposed && !abort.signal.aborted) setFailed(true);
      } finally {
        loading = false;
      }
    };
    const schedule = () => {
      if (idle !== undefined || lightweight()) return;
      if (typeof window.requestIdleCallback === "function")
        idle = window.requestIdleCallback(
          () => {
            idle = undefined;
            void mount();
          },
          { timeout: 1500 },
        );
      else
        idle = window.setTimeout(() => {
          idle = undefined;
          void mount();
        }, 200);
    };
    const preference = () => {
      if (lightweight()) {
        controller.current?.dispose();
        controller.current = null;
        setReady(false);
      } else if (visible) schedule();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        controller.current?.setVisible(visible);
        if (visible) schedule();
      },
      { rootMargin: "100px" },
    );
    observer.observe(node);
    motion.addEventListener("change", preference);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      motion.removeEventListener("change", preference);
      if (idle !== undefined) {
        window.cancelIdleCallback?.(idle);
        clearTimeout(idle);
      }
      controller.current?.dispose();
      controller.current = null;
    };
  }, [attempt]);
  const target = landmark ? `/mapa?lugar=${landmark.id}` : "/mapa";
  return (
    <div className={styles.experience}>
      <div
        className={styles.scene}
        data-city-ready={ready}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSelected(null);
        }}
      >
        <Image
          className={styles.fallback}
          src="/home/ica-city-plan.svg"
          alt="Plano de calles y huellas de edificios del centro de Ica y Huacachina"
          fill
          sizes="100vw"
          priority
          unoptimized
        />
        <div
          ref={host}
          className={styles.canvas}
          aria-label="Maqueta 3D de Ica. Selecciona un lugar con los botones de abajo."
        />
        <div className={styles.sceneTop}>
          <span>ICA, DESDE OTRA PERSPECTIVA</span>
          {ready && (
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              aria-label={
                paused
                  ? "Reanudar movimiento de la maqueta"
                  : "Pausar movimiento de la maqueta"
              }
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          )}
        </div>
        {ready && selected && (
          <div
            className={styles.controls}
            role="group"
            aria-label="Explorar el volumen seleccionado"
          >
            <button
              type="button"
              onClick={() => controller.current?.rotate(-0.35)}
              aria-label="Girar a la izquierda"
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              onClick={() => controller.current?.rotate(0.35)}
              aria-label="Girar a la derecha"
            >
              <RotateCw size={17} />
            </button>
            <button
              type="button"
              onClick={() => controller.current?.zoom(-0.12)}
              aria-label="Acercar modelo"
            >
              <Plus size={17} />
            </button>
            <button
              type="button"
              onClick={() => controller.current?.zoom(0.12)}
              aria-label="Alejar modelo"
            >
              <Minus size={17} />
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              Volver a Ica <X size={16} />
            </button>
          </div>
        )}
        <div className={styles.caption}>
          <span>
            {ready ? "Maqueta interactiva" : "Vista ligera"} · Huellas de OSM
          </span>
          <span>
            Volúmenes de referencia. Fachadas y alturas por completar.
          </span>
          {failed && (
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((v) => v + 1);
              }}
            >
              Reintentar 3D
            </button>
          )}
        </div>
      </div>
      <div
        className={styles.destinations}
        role="group"
        aria-label="Seleccionar un atractivo de Ica"
      >
        {CITY_LANDMARKS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={selected === item.id}
            aria-controls="ica-landmark-detail"
            onClick={() => setSelected(selected === item.id ? null : item.id)}
          >
            <MapPin size={14} aria-hidden />
            {item.name}
          </button>
        ))}
      </div>
      <div id="ica-landmark-detail" aria-live="polite">
        {landmark && (
          <article className={styles.detail}>
            {landmark.photo && (
              <div className={styles.photo}>
                <Image
                  src={landmark.photo}
                  alt={landmark.photoAlt ?? landmark.name}
                  fill
                  sizes="(max-width:600px) 100vw, 200px"
                />
              </div>
            )}
            <div className={styles.description}>
              <h2>{landmark.name}</h2>
              <p>{landmark.description}</p>
              <small>
                <MapPin size={13} aria-hidden />
                {landmark.address}
              </small>
              <a
                href={landmark.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Información del lugar <ArrowUpRight size={13} />
              </a>
            </div>
            <div className={styles.actions}>
              <Link href={target}>
                Ver en el mapa <ArrowUpRight size={15} />
              </Link>
              <Link href={`${target}&recorrido=1`}>
                Cómo llegar <ArrowUpRight size={15} />
              </Link>
              <button type="button" onClick={() => setSelected(null)}>
                Cerrar detalle <X size={15} />
              </button>
            </div>
          </article>
        )}
      </div>
      <a
        className={styles.attribution}
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
      >
        © OpenStreetMap contributors · ODbL
      </a>
    </div>
  );
}
