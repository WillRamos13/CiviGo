"use client";
import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { api } from "@/lib/api";
// Only coarse page names and numerical performance samples are sent. Never URLs
// with query parameters, precise locations, form values or message contents.
export default function PerformanceTelemetry() {
  const path = usePathname(),
    { usuario } = useAuth();
  const sessionState = useRef({ id: crypto.randomUUID() }),
    pageId = useMemo(() => ({ path, id: crypto.randomUUID() }), [path]).id;
  const measurement = useRef({
    path,
    active: true,
    vitals: {} as Record<string, number>,
    observers: [] as PerformanceObserver[],
  });
  useEffect(() => {
    const vitals = measurement.current.vitals,
      observers = measurement.current.observers;
    let shiftStart = 0,
      lastShift = 0,
      shiftScore = 0;
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (nav && nav.responseStart > 0) vitals.ttfb = nav.responseStart;
    if (typeof PerformanceObserver !== "undefined")
      for (const type of ["largest-contentful-paint", "layout-shift"]) {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const item of list.getEntries()) {
              if (type === "largest-contentful-paint")
                vitals.lcp = item.startTime;
              else {
                const shift = item as PerformanceEntry & {
                  hadRecentInput?: boolean;
                  value?: number;
                };
                if (!shift.hadRecentInput) {
                  if (
                    item.startTime - lastShift > 1000 ||
                    item.startTime - shiftStart > 5000
                  ) {
                    shiftStart = item.startTime;
                    shiftScore = 0;
                  }
                  lastShift = item.startTime;
                  shiftScore += shift.value || 0;
                  vitals.cls = Math.max(vitals.cls || 0, shiftScore);
                }
              }
            }
          });
          observer.observe({ type, buffered: true });
          observers.push(observer);
        } catch {}
      }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [measurement]);
  useEffect(() => {
    if (path !== measurement.current.path) {
      measurement.current.active = false;
      measurement.current.observers.forEach((observer) =>
        observer.disconnect(),
      );
    }
    const controller = new AbortController();
    let busy = false,
      stopped = false;
    const send = async (includeVitals = false) => {
      if (stopped || busy || !navigator.onLine) return;
      busy = true;
      try {
        await api("/telemetry", {
          method: "POST",
          body: JSON.stringify({
            session: sessionState.current.id,
            pageId,
            path,
            platform: "web",
            visible: document.visibilityState === "visible",
            ...(includeVitals &&
            measurement.current.active &&
            Object.keys(measurement.current.vitals).length
              ? { vitals: measurement.current.vitals }
              : {}),
          }),
          signal: controller.signal,
          timeoutMs: 5000,
        });
      } catch {
        /* Instrumentation must never affect the user flow. */
      } finally {
        busy = false;
      }
    };
    const onVisibility = () => {
      void send(document.visibilityState !== "visible");
    };
    void send();
    const sample = setTimeout(() => void send(true), 10000),
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void send(true);
      }, 60000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(sample);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [path, usuario?.id, pageId, sessionState, measurement]);
  return null;
}
