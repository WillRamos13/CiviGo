import { useEffect, useMemo, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../services/api";
const pageNames: Record<string, string> = {
  map: "/mapa",
  report: "/reportar",
  reports: "/mis-reportes",
  alerts: "/alertas",
  profile: "/perfil",
  community: "/ranking",
  login: "/ingresar",
  register: "/registro",
  verify: "/verificar",
};
export function MobilePerformanceTelemetry({ page }: { page: string }) {
  const { usuario } = useAuth();
  const identity = useRef({ id: crypto.randomUUID() }),
    pageId = useMemo(() => crypto.randomUUID(), [page]);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true,
      busy = false,
      active = document.visibilityState === "visible",
      remove: (() => void) | null = null;
    const send = async () => {
      if (!alive || busy || !navigator.onLine) return;
      busy = true;
      try {
        await api("/telemetry", {
          method: "POST",
          body: JSON.stringify({
            session: identity.current.id,
            pageId,
            path: pageNames[page] || "/perfil",
            platform: "mobile",
            visible: active,
          }),
          signal: controller.signal,
          timeoutMs: 5000,
        });
      } catch {
        /* Metrics never interrupt the app. */
      } finally {
        busy = false;
      }
    };
    const visible = () => {
      active = document.visibilityState === "visible";
      void send();
    };
    if (Capacitor.isNativePlatform())
      void App.addListener("appStateChange", (state) => {
        active = state.isActive;
        void send();
      })
        .then((listener) => {
          if (alive) remove = () => void listener.remove();
          else void listener.remove();
        })
        .catch(() => {});
    document.addEventListener("visibilitychange", visible);
    void send();
    const timer = setInterval(() => {
      if (active) void send();
    }, 60000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      remove?.();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [page, usuario?.id, pageId, identity]);
  return null;
}
