import { useEffect, useRef, useState } from "react";
import { api, post, distance } from "../services/api";
import { distanceToRoute } from "../services/placeDiscovery";
import { isUsableFix } from "../services/navigation";
import type { LocationFix, Ruta } from "../types";
export type NearbyBusiness = {
  id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  descripcion?: string;
  direccion?: string;
  horario?: string;
  telefono?: string;
  banner?: { url: string; alt?: string } | null;
};
export function useNearbyBusiness(
  active: boolean,
  position: LocationFix | null,
  route: Ruta | null,
  owner: number | null,
  hidden: boolean,
  foreground = true,
) {
  const [ad, setAd] = useState<NearbyBusiness | null>(null),
    [revision, setRevision] = useState(0),
    businesses = useRef<NearbyBusiness[]>([]),
    seen = useRef(new Set<number>()),
    trip = useRef(""),
    last = useRef<LocationFix | null>(null),
    travel = useRef(150),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    config = useRef({
      anuncioMetros: 50,
      intervaloAnuncioMetros: 150,
      duracionAnuncioSegundos: 15,
    });
  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => {
    setAd(null);
    businesses.current = [];
    seen.current.clear();
    last.current = null;
    travel.current = 150;
    if (!active || !owner || hidden) return;
    trip.current = crypto.randomUUID();
    const controller = new AbortController();
    void Promise.all([
      api<NearbyBusiness[]>("/businesses", { signal: controller.signal }),
      api<{ config: Record<string, unknown> }>("/catalog", {
        signal: controller.signal,
      }),
    ])
      .then(([rows, catalog]) => {
        if (controller.signal.aborted) return;
        businesses.current = rows;
        for (const key of Object.keys(
          config.current,
        ) as (keyof typeof config.current)[]) {
          const value = Number(catalog.config[key]);
          if (Number.isFinite(value) && value > 0) config.current[key] = value;
        }
        setRevision((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      pause();
    };
  }, [active, owner, hidden]);
  useEffect(() => {
    if (
      !foreground ||
      !active ||
      !owner ||
      hidden ||
      !route ||
      !isUsableFix(position) ||
      (position.accuracy ?? Infinity) > 60 ||
      Date.now() - (position.timestamp ?? 0) > 15000
    )
      return;
    const separation = distanceToRoute(position, route);
    if (separation === null || separation > 100) return;
    if (last.current) {
      const step = distance(last.current, position);
      if (step > 2 && step < 500) travel.current += step;
    }
    last.current = position;
    if (ad || travel.current < config.current.intervaloAnuncioMetros) return;
    const business = businesses.current
      .filter(
        (row) =>
          !seen.current.has(row.id) &&
          distance(position, row) <= config.current.anuncioMetros,
      )
      .sort((a, b) => distance(position, a) - distance(position, b))[0];
    if (!business) return;
    seen.current.add(business.id);
    travel.current = 0;
    setAd(business);
    void post("/businesses/" + business.id + "/impressions", {
      latitud: position.latitud,
      longitud: position.longitud,
      recorridoId: trip.current,
    }).catch(() => {});
    pause();
    timer.current = setTimeout(
      () => setAd(null),
      Math.max(15, config.current.duracionAnuncioSegundos) * 1000,
    );
  }, [foreground, active, position, route, owner, hidden, revision, ad]);
  useEffect(() => {
    if (!foreground) pause();
  }, [foreground]);
  return {
    ad,
    close: () => {
      pause();
      setAd(null);
    },
    pause,
  };
}
