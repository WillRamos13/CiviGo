import { useEffect, useState } from "react";
import {
  NavigationAvatarPreferenceController,
  DEFAULT_NAVIGATION_AVATAR,
  type NavigationAvatar,
} from "./navigation-avatar";
export function useNavigationAvatar(owner: number | null) {
  const [controller] = useState(
    () => new NavigationAvatarPreferenceController(),
  );
  const [avatar, setAvatar] = useState<NavigationAvatar>(
      DEFAULT_NAVIGATION_AVATAR,
    ),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const c = controller;
    c.setOwner(owner);
    let active = true;
    void c
      .load()
      .then((value) => {
        if (active) setAvatar(value ?? DEFAULT_NAVIGATION_AVATAR);
      })
      .catch(() => {
        if (active) setNotice("No se pudo cargar el icono guardado.");
      });
    return () => {
      active = false;
      c.setOwner(null);
    };
  }, [owner, controller]);
  const change = (value: NavigationAvatar) => {
    setAvatar(value);
    setNotice("");
    void controller
      .save(value)
      .catch(() =>
        setNotice(
          "El icono se aplicó, pero no se pudo guardar en este navegador.",
        ),
      );
  };
  return { avatar, change, notice };
}
