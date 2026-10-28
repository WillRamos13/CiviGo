"use client";
import { useEffect, useState } from "react";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearance,
  type MapAppearance,
} from "@/lib/map-appearance";
export function useMapAppearance() {
  const [appearance, setAppearance] =
    useState<MapAppearance>(DEFAULT_APPEARANCE);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        setAppearance(
          parseAppearance(
            JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null"),
          ),
        );
      } catch {
        /* Storage is optional. */
      }
    });
    return () => {
      active = false;
    };
  }, []);
  const change = (next: MapAppearance) => {
    setAppearance(next);
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    } catch {
      /* Map remains usable without persistence. */
    }
  };
  return { appearance, change };
}
export default function MapAppearanceControl({
  value,
  onChange,
}: {
  value: MapAppearance;
  onChange: (next: MapAppearance) => void;
}) {
  return (
    <fieldset className="map-appearance-control">
      <legend>Vista y ambiente</legend>
      <label>
        Vista del mapa
        <select
            aria-label="Vista del mapa"
            value={value.mode}
          onChange={(event) =>
            onChange({
              ...value,
              mode: event.target.value as MapAppearance["mode"],
            })
          }
        >
          <option value="2d">2D</option>
          <option value="3d">3D · edificios</option>
        </select>
      </label>
      <label>
        Ambiente del mapa
        <select
            aria-label="Ambiente del mapa"
            value={value.light}
          onChange={(event) =>
            onChange({
              ...value,
              light: event.target.value as MapAppearance["light"],
            })
          }
        >
          <option value="auto">Automático · hora de Ica</option>
          <option value="dawn">Amanecer</option>
          <option value="day">Día</option>
          <option value="dusk">Atardecer</option>
          <option value="night">Noche</option>
        </select>
      </label>
      <small>
        El detalle 3D depende de los datos disponibles en cada zona.
      </small>
    </fieldset>
  );
}
