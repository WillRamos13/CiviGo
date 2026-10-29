import React from "react";
import {
  NAVIGATION_AVATARS,
  NAVIGATION_VEHICLE_COLORS,
  navigationAvatarShapes,
  navigationAvatarBase,
  navigationAvatarColor,
  isVehicleModel,
  type NavigationAvatar,
} from "@/lib/navigation-avatar";
const primary = NAVIGATION_AVATARS.filter((item) =>
  ["arrow", "car", "motorcycle", "bicycle", "walking"].includes(item.id),
);
export const NavigationAvatarIcon: React.FC<{ avatar: NavigationAvatar }> = ({
  avatar,
}) => (
  <svg
    viewBox="0 0 40 40"
    className="navigation-avatar-glyph"
    aria-hidden="true"
  >
    {navigationAvatarShapes(avatar).map((shape, index) =>
      React.createElement(shape.tag, { ...shape.attrs, key: index }),
    )}
  </svg>
);
export const AvatarPicker: React.FC<{
  value: NavigationAvatar;
  onChange: (avatar: NavigationAvatar) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const base = navigationAvatarBase(value),
    car = base === "car" || isVehicleModel(base),
    chosen = car ? "car" : base;
  const choose = (id: (typeof primary)[number]["id"]) =>
    onChange(
      id === "car"
        ? `${isVehicleModel(base) ? base : "sedan"}:${navigationAvatarColor(value)}`
        : id,
    );
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
              avatar={item.id === "car" && car ? value : item.id}
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
      <small className="navigation-avatar-help">
        El icono no cambia tu transporte.
      </small>
    </fieldset>
  );
};
