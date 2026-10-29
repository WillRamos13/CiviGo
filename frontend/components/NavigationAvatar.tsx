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
}> = ({ value, onChange, disabled = false }) => (
  <fieldset className="navigation-avatar-picker" disabled={disabled}>
    <legend>Icono de navegación</legend>
    <div
      role="radiogroup"
      aria-label="Icono de navegación"
      onKeyDown={(event) => {
        const index = NAVIGATION_AVATARS.findIndex(
          (avatar) => avatar.id === navigationAvatarBase(value),
        );
        let next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
          next = (index + 1) % NAVIGATION_AVATARS.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
          next =
            (index + NAVIGATION_AVATARS.length - 1) % NAVIGATION_AVATARS.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = NAVIGATION_AVATARS.length - 1;
        else return;
        if (disabled) return;
        event.preventDefault();
        event.currentTarget
          .querySelectorAll<HTMLButtonElement>('[role="radio"]')
          [next]?.focus();
        const nextBase = NAVIGATION_AVATARS[next].id;
        onChange(
          isVehicleModel(nextBase)
            ? `${nextBase}:${navigationAvatarColor(value)}`
            : nextBase,
        );
      }}
    >
      {NAVIGATION_AVATARS.map((avatar) => (
        <button
          key={avatar.id}
          type="button"
          role="radio"
          aria-checked={navigationAvatarBase(value) === avatar.id}
          tabIndex={navigationAvatarBase(value) === avatar.id ? 0 : -1}
          onClick={() =>
            onChange(
              isVehicleModel(avatar.id)
                ? `${avatar.id}:${navigationAvatarColor(value)}`
                : avatar.id,
            )
          }
          data-navigation-avatar={avatar.id}
        >
          <NavigationAvatarIcon
            avatar={
              isVehicleModel(avatar.id)
                ? `${avatar.id}:${navigationAvatarColor(value)}`
                : avatar.id
            }
          />
          <span>{avatar.label}</span>
        </button>
      ))}
    </div>
    {isVehicleModel(navigationAvatarBase(value)) && (
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
                `${navigationAvatarBase(value)}:${color.id}` as NavigationAvatar,
              )
            }
          />
        ))}
      </div>
    )}
    <small className="navigation-avatar-help">
      El icono no cambia el modo de transporte.
    </small>
  </fieldset>
);
