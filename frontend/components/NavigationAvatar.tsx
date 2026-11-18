import React, { useEffect, useState } from "react";
import Image from "next/image";
import {
  NAVIGATION_ARCADE_AVATARS,
  NAVIGATION_VEHICLE_COLORS,
  hasVehiclePreview,
  isArcadeAvatar,
  navigationAvatarShapes,
  navigationAvatarBase,
  navigationAvatarColor,
  isVehicleModel,
  type NavigationAvatar,
} from "@/lib/navigation-avatar";
const primary = [
  { id: "arrow", label: "Flecha" },
  { id: "car", label: "Auto" },
  { id: "motorcycle", label: "Moto" },
  { id: "bicycle", label: "Bicicleta" },
  { id: "walking", label: "A pie" },
  { id: "arcade", label: "Arcade" },
] as const;
export const NavigationAvatarIcon: React.FC<{ avatar: NavigationAvatar }> = ({
  avatar,
}) => {
  const [preview, setPreview] = useState<{ avatar: NavigationAvatar; url: string }>();
  useEffect(() => {
    if (!hasVehiclePreview(avatar)) return;
    let active = true;
    void import("@/lib/navigation-vehicle-preview").then(({ vehiclePreview }) => {
      if (!active) return;
      const url = vehiclePreview(avatar, "picker");
      if (url) setPreview({ avatar, url });
    }).catch(() => {});
    return () => { active = false; };
  }, [avatar]);

  if (preview?.avatar === avatar) {
    return <Image src={preview.url} width={48} height={48} alt="" unoptimized
      className="navigation-avatar-glyph navigation-vehicle-preview" />;
  }
  return <svg viewBox="0 0 40 40" className="navigation-avatar-glyph" aria-hidden="true">
    {navigationAvatarShapes(avatar).map((shape, index) =>
      React.createElement(shape.tag, { ...shape.attrs, key: index }),
    )}
  </svg>;
};
export const AvatarPicker: React.FC<{
  value: NavigationAvatar;
  onChange: (avatar: NavigationAvatar) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const base = navigationAvatarBase(value),
    car = base === "car" || isVehicleModel(base),
    chosen = car ? "car" : isArcadeAvatar(base) ? "arcade" : base;
  const choose = (id: (typeof primary)[number]["id"]) => {
    if (id === "car") {
      onChange(`${isVehicleModel(base) ? base : "sedan"}:${navigationAvatarColor(value)}`);
    } else if (id === "arcade") {
      onChange(isArcadeAvatar(base) ? base : NAVIGATION_ARCADE_AVATARS[0].id);
    } else {
      onChange(id);
    }
  };
  return (
    <fieldset className="navigation-avatar-picker" disabled={disabled}>
      <legend>Tu icono en el mapa</legend>
      <div
        role="radiogroup"
        aria-label="Icono de navegación"
        onKeyDown={(event) => {
          const index = primary.findIndex((item) => item.id === chosen);
          let next = index;
          if (["ArrowRight", "ArrowDown"].includes(event.key))
            next = (index + 1) % primary.length;
          else if (["ArrowLeft", "ArrowUp"].includes(event.key))
            next = (index + primary.length - 1) % primary.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = primary.length - 1;
          else return;
          if (disabled) return;
          event.preventDefault();
          event.currentTarget
            .querySelectorAll<HTMLButtonElement>('[role="radio"]')
            [next]?.focus();
          choose(primary[next].id);
        }}
      >
        {primary.map((item) => (
          <button
            type="button"
            key={item.id}
            role="radio"
            aria-checked={chosen === item.id}
            tabIndex={chosen === item.id ? 0 : -1}
            onClick={() => choose(item.id)}
            data-navigation-avatar={item.id}
          >
            <NavigationAvatarIcon
              avatar={item.id === "arcade"
                ? isArcadeAvatar(base) ? base : NAVIGATION_ARCADE_AVATARS[0].id
                : item.id === "car" && car ? value : item.id}
            />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {car && (
        <>
          <label className="field">
            Modelo de auto
            <select
              aria-label="Modelo de auto"
              value={isVehicleModel(base) ? base : "sedan"}
              onChange={(event) =>
                onChange(
                  `${event.target.value}:${navigationAvatarColor(value)}` as NavigationAvatar,
                )
              }
            >
              {[
                ["compact", "Compacto"],
                ["sedan", "Sedán"],
                ["suv", "SUV"],
                ["sport", "Deportivo"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div
            className="navigation-vehicle-colors"
            role="group"
            aria-label="Color del vehículo"
          >
            {NAVIGATION_VEHICLE_COLORS.map((color) => (
              <button
                type="button"
                key={color.id}
                aria-label={color.label}
                aria-pressed={navigationAvatarColor(value) === color.id}
                title={color.label}
                style={{ "--vehicle-color": color.hex } as React.CSSProperties}
                onClick={() =>
                  onChange(
                    `${isVehicleModel(base) ? base : "sedan"}:${color.id}`,
                  )
                }
              />
            ))}
          </div>
        </>
      )}
      {chosen === "arcade" && (
        <div className="navigation-arcade-avatars" role="group" aria-label="Modelos arcade">
          {NAVIGATION_ARCADE_AVATARS.map((item) => (
            <button type="button" key={item.id} aria-pressed={base === item.id}
              data-navigation-avatar={item.id} onClick={() => onChange(item.id)}>
              <NavigationAvatarIcon avatar={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <small className="navigation-avatar-help">
        El icono no cambia tu transporte.
      </small>
    </fieldset>
  );
};
