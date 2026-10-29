const Preferences = {
  async get({ key }: { key: string }) {
    return {
      value: typeof window === "undefined" ? null : localStorage.getItem(key),
    };
  },
  async set({ key, value }: { key: string; value: string }) {
    localStorage.setItem(key, value);
  },
};

export type NavigationVehicleModel = "compact" | "sedan" | "suv" | "sport";
export type NavigationVehicleColor =
  "blue" | "teal" | "red" | "yellow" | "silver";
export type NavigationAvatarBase =
  | "arrow"
  | "car"
  | "motorcycle"
  | "bicycle"
  | "walking"
  | NavigationVehicleModel;
export type NavigationAvatar =
  NavigationAvatarBase | `${NavigationVehicleModel}:${NavigationVehicleColor}`;
export const DEFAULT_NAVIGATION_AVATAR: NavigationAvatar = "arrow";
export const NAVIGATION_AVATARS: readonly {
  id: NavigationAvatarBase;
  label: string;
}[] = [
  { id: "arrow", label: "Flecha" },
  { id: "car", label: "Auto" },
  { id: "motorcycle", label: "Moto" },
  { id: "bicycle", label: "Bicicleta" },
  { id: "walking", label: "A pie" },
  { id: "compact", label: "Compacto" },
  { id: "sedan", label: "Sedán" },
  { id: "suv", label: "SUV" },
  { id: "sport", label: "Deportivo" },
];
export const NAVIGATION_VEHICLE_COLORS: readonly {
  id: NavigationVehicleColor;
  label: string;
  hex: string;
}[] = [
  { id: "blue", label: "Azul", hex: "#087cff" },
  { id: "teal", label: "Turquesa", hex: "#10b9ac" },
  { id: "red", label: "Rojo", hex: "#ef4848" },
  { id: "yellow", label: "Amarillo", hex: "#f5bf28" },
  { id: "silver", label: "Plata", hex: "#c1d0df" },
];
export function navigationAvatarBase(
  value: NavigationAvatar,
): NavigationAvatarBase {
  return value.split(":")[0] as NavigationAvatarBase;
}
export function navigationAvatarColor(
  value: NavigationAvatar,
): NavigationVehicleColor {
  return (value.split(":")[1] || "blue") as NavigationVehicleColor;
}
export function isVehicleModel(value: string): value is NavigationVehicleModel {
  return ["compact", "sedan", "suv", "sport"].includes(value);
}
export function navigationAvatarLabel(value: NavigationAvatar): string {
  const base = navigationAvatarBase(value),
    label =
      NAVIGATION_AVATARS.find((option) => option.id === base)?.label ||
      "Flecha";
  return isVehicleModel(base)
    ? `${label} · ${NAVIGATION_VEHICLE_COLORS.find((color) => color.id === navigationAvatarColor(value))?.label || "Azul"}`
    : label;
}

export function isNavigationAvatar(value: unknown): value is NavigationAvatar {
  if (typeof value !== "string") return false;
  if (NAVIGATION_AVATARS.some((avatar) => avatar.id === value)) return true;
  const parts = value.split(":"),
    [base, color] = parts;
  return (
    parts.length === 2 &&
    isVehicleModel(base) &&
    NAVIGATION_VEHICLE_COLORS.some((item) => item.id === color)
  );
}

export interface NavigationAvatarPreferences {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
}
const preferenceQueues = new WeakMap<
  NavigationAvatarPreferences,
  Promise<void>
>();

/** Share a queue across controllers/remounts using the same Preferences driver. */
function enqueue<T>(
  driver: NavigationAvatarPreferences,
  operation: () => Promise<T>,
): Promise<T> {
  const pending = (preferenceQueues.get(driver) ?? Promise.resolve()).then(
    operation,
  );
  preferenceQueues.set(
    driver,
    pending.then(
      () => {},
      () => {},
    ),
  );
  return pending;
}

/** A new account or selection invalidates older reads before they reach UI. */
export class NavigationAvatarPreferenceController {
  private owner: number | null = null;
  private revision = 0;
  constructor(private driver: NavigationAvatarPreferences = Preferences) {}
  setOwner(id: number | null): void {
    const owner = Number.isSafeInteger(id) && Number(id) > 0 ? id : null;
    if (owner === this.owner) return;
    this.owner = owner;
    this.revision++;
  }
  load(): Promise<NavigationAvatar | null> {
    const owner = this.owner,
      revision = ++this.revision;
    if (owner === null) return Promise.resolve(null);
    const current = () => this.owner === owner && this.revision === revision;
    return enqueue(this.driver, async () => {
      if (!current()) return null;
      try {
        const { value } = await this.driver.get({
          key: `civigo:navigation-avatar:v1:user:${owner}`,
        });
        return current()
          ? isNavigationAvatar(value)
            ? value
            : DEFAULT_NAVIGATION_AVATAR
          : null;
      } catch (error) {
        if (!current()) return null;
        throw error;
      }
    });
  }
  save(avatar: NavigationAvatar): Promise<boolean> {
    if (!isNavigationAvatar(avatar))
      return Promise.reject(
        new Error("Selecciona un icono de navegación válido."),
      );
    const owner = this.owner,
      revision = ++this.revision;
    if (owner === null) return Promise.resolve(false);
    const current = () => this.owner === owner && this.revision === revision;
    return enqueue(this.driver, async () => {
      if (!current()) return false;
      try {
        await this.driver.set({
          key: `civigo:navigation-avatar:v1:user:${owner}`,
          value: avatar,
        });
        return current();
      } catch (error) {
        if (!current()) return false;
        throw error;
      }
    });
  }
}

export type AvatarShape = {
  tag: "path" | "rect" | "circle";
  attrs: Readonly<Record<string, string>>;
};
const blue = "#087cff",
  white = "#ffffff",
  dark = "#092941";
const shapes: Record<
  Exclude<NavigationAvatarBase, NavigationVehicleModel>,
  readonly AvatarShape[]
> = {
  arrow: [
    {
      tag: "path",
      attrs: {
        d: "M20 3 34 35 20 28 6 35Z",
        fill: blue,
        stroke: white,
        strokeWidth: "2.5",
        strokeLinejoin: "round",
      },
    },
  ],
  car: [
    {
      tag: "path",
      attrs: {
        d: "M8 10h4v9H8zm20 0h4v9h-4zM8 25h4v8H8zm20 0h4v8h-4z",
        fill: dark,
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "11",
        y: "3",
        width: "18",
        height: "34",
        rx: "6",
        fill: blue,
        stroke: white,
        strokeWidth: "2",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M14 11h12l-1 7H15zm1 14h10l1 6H14z",
        fill: dark,
        stroke: "#b6e4ff",
        strokeWidth: "1",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M14 7h3m6 0h3",
        stroke: white,
        strokeWidth: "2",
        strokeLinecap: "round",
      },
    },
  ],
  motorcycle: [
    {
      tag: "rect",
      attrs: {
        x: "17",
        y: "1",
        width: "6",
        height: "12",
        rx: "3",
        fill: dark,
        stroke: white,
        strokeWidth: "1.3",
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "17",
        y: "28",
        width: "6",
        height: "11",
        rx: "3",
        fill: dark,
        stroke: white,
        strokeWidth: "1.3",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M8 12h24M20 9v22",
        stroke: white,
        strokeWidth: "3",
        strokeLinecap: "round",
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "14",
        y: "12",
        width: "12",
        height: "21",
        rx: "5",
        fill: blue,
        stroke: white,
        strokeWidth: "1.8",
      },
    },
    {
      tag: "circle",
      attrs: {
        cx: "20",
        cy: "21",
        r: "4",
        fill: dark,
        stroke: "#b6e4ff",
        strokeWidth: "1.3",
      },
    },
  ],
  bicycle: [
    {
      tag: "rect",
      attrs: {
        x: "17.5",
        y: "1",
        width: "5",
        height: "12",
        rx: "2.5",
        fill: dark,
        stroke: white,
        strokeWidth: "1.2",
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "17.5",
        y: "28",
        width: "5",
        height: "11",
        rx: "2.5",
        fill: dark,
        stroke: white,
        strokeWidth: "1.2",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M20 8v25M10 12l3-3h14l3 3M14 25h12",
        fill: "none",
        stroke: white,
        strokeWidth: "4",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M20 8v25M10 12l3-3h14l3 3M14 25h12",
        fill: "none",
        stroke: blue,
        strokeWidth: "2.2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
  ],
  walking: [
    {
      tag: "circle",
      attrs: {
        cx: "22",
        cy: "6",
        r: "4",
        fill: blue,
        stroke: white,
        strokeWidth: "1.5",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "m15 17 5-5 6 8 7 1M20 13l-3 12-7 11m8-12 9 5 2 7",
        fill: "none",
        stroke: white,
        strokeWidth: "6",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "m15 17 5-5 6 8 7 1M20 13l-3 12-7 11m8-12 9 5 2 7",
        fill: "none",
        stroke: blue,
        strokeWidth: "3.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
  ],
};

/** Only local vector shapes are accepted; no URL, markup or executable input. */
export function navigationAvatarShapes(
  avatar: NavigationAvatar,
): readonly AvatarShape[] {
  const safe = isNavigationAvatar(avatar) ? avatar : DEFAULT_NAVIGATION_AVATAR;
  const base = navigationAvatarBase(safe);
  if (!isVehicleModel(base)) return shapes[base];
  const fill =
    NAVIGATION_VEHICLE_COLORS.find(
      (color) => color.id === navigationAvatarColor(safe),
    )?.hex || blue;
  const bodies = {
    compact: "M12 6Q20 0 28 6L30 28Q29 36 25 37H15Q11 36 10 28Z",
    sedan: "M13 3Q20 0 27 3L29 33Q28 39 20 39T11 33Z",
    suv: "M10 4Q20 0 30 4V34Q29 39 20 39T10 34Z",
    sport: "M15 2H25L31 17 29 35Q20 40 11 35L9 17Z",
  };
  const windows =
    base === "sport"
      ? "M14 14h12l1 8H13zm1 12h10l-1 5h-8z"
      : base === "compact"
        ? "M14 12h12l1 8H13zm0 13h12v5H14z"
        : "M14 11h12l1 8H13zm0 15h12v7H14z";
  return [
    {
      tag: "path",
      attrs: {
        d: "M7 10h5v9H7zm21 0h5v9h-5zM7 26h5v9H7zm21 0h5v9h-5z",
        fill: "#041923",
      },
    },
    {
      tag: "path",
      attrs: {
        d: bodies[base],
        fill,
        stroke: white,
        strokeWidth: "1.6",
        strokeLinejoin: "round",
      },
    },
    {
      tag: "path",
      attrs: {
        d: windows,
        fill: "#0a2738",
        stroke: "#c9edff",
        strokeWidth: ".8",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M13 7h3m8 0h3",
        stroke: "#fff7ba",
        strokeWidth: "2",
        strokeLinecap: "round",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M13 35h3m8 0h3",
        stroke: "#aa2535",
        strokeWidth: "2",
        strokeLinecap: "round",
      },
    },
    ...(base === "suv"
      ? [
          {
            tag: "path" as const,
            attrs: {
              d: "M12 8v24m16-24v24",
              stroke: "#e2edf5",
              strokeWidth: "1.2",
              opacity: ".8",
            },
          },
        ]
      : []),
    ...(base === "sport"
      ? [
          {
            tag: "path" as const,
            attrs: {
              d: "M9 33h22M19 3v9m2-9v9",
              stroke: "#e9f7ff",
              strokeWidth: "1.8",
            },
          },
        ]
      : []),
  ];
}

export function navigationAvatarRotation(
  heading: unknown,
  mapBearing: unknown,
): number {
  const direction =
    typeof heading === "number" &&
    Number.isFinite(heading) &&
    heading >= 0 &&
    heading < 360
      ? heading
      : 0;
  const bearing =
    typeof mapBearing === "number" && Number.isFinite(mapBearing)
      ? mapBearing
      : 0;
  return ((((direction - bearing) % 360) + 540) % 360) - 180;
}

/** Rebuild only the inner graphic; Mapbox keeps ownership of the outer anchor. */
export function updateNavigationAvatarMarker(
  element: HTMLElement,
  avatar: NavigationAvatar,
  following: boolean,
  heading?: number,
  mapBearing = 0,
) {
  const id = following
    ? isNavigationAvatar(avatar)
      ? avatar
      : DEFAULT_NAVIGATION_AVATAR
    : "location";
  if (element.dataset.navigationAvatar !== id) {
    element.dataset.navigationAvatar = id;
    element.replaceChildren();
    const inner = element.ownerDocument.createElement("span");
    inner.className = following
      ? "navigation-avatar-heading"
      : "user-location-dot";
    if (following) {
      const namespace = "http://www.w3.org/2000/svg";
      const svg = element.ownerDocument.createElementNS(namespace, "svg");
      svg.setAttribute("viewBox", "0 0 40 40");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("navigation-avatar-glyph");
      for (const shape of navigationAvatarShapes(id as NavigationAvatar)) {
        const part = element.ownerDocument.createElementNS(
          namespace,
          shape.tag,
        );
        for (const [name, value] of Object.entries(shape.attrs))
          part.setAttribute(
            name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
            value,
          );
        svg.appendChild(part);
      }
      inner.appendChild(svg);
    }
    element.appendChild(inner);
    element.setAttribute("role", "img");
    element.setAttribute(
      "aria-label",
      following
        ? `Tu ubicación · ${navigationAvatarLabel(id as NavigationAvatar)}`
        : "Tu ubicación",
    );
  }
  const rotor = element.querySelector<HTMLElement>(
    ".navigation-avatar-heading",
  );
  if (rotor)
    rotor.style.transform = `rotate(${navigationAvatarRotation(heading, mapBearing)}deg)`;
}
