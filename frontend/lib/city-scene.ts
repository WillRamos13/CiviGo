export type CityPoint = [number, number];
export type CityFootprint = {
  osmId: string;
  ring: CityPoint[];
  height: number;
  heightSource: "height" | "levels-estimate" | "reference";
  kind: "building" | "park" | "water";
};
export type CitySceneData = {
  version: 1;
  source: string;
  license: string;
  attribution: string;
  retrievedAt: string;
  origin: CityPoint;
  metersPerUnit: number;
  bounds: [number, number, number, number];
  roads: CityPoint[][];
  footprints: CityFootprint[];
};
export type LandmarkId =
  "huacachina" | "plaza" | "catedral" | "luren" | "museo";
export type CityLandmark = {
  id: LandmarkId;
  name: string;
  osmId: string;
  latitud: number;
  longitud: number;
  description: string;
  address: string;
  sourceUrl: string;
  photo?: string;
  photoAlt?: string;
};

export const CITY_LANDMARKS: readonly CityLandmark[] = [
  {
    id: "huacachina",
    name: "Huacachina",
    osmId: "way/148131510",
    latitud: -14.0879165,
    longitud: -75.7639539,
    description:
      "La laguna, la vegetación y las dunas forman uno de los paisajes más reconocibles de Ica.",
    address: "Laguna de Huacachina, distrito de Ica",
    sourceUrl:
      "https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_ficha=237",
    photo: "/home/ica-huacachina.webp",
    photoAlt: "Vista real de Huacachina desde una duna",
  },
  {
    id: "plaza",
    name: "Plaza de Armas de Ica",
    osmId: "way/630762068",
    latitud: -14.0640293,
    longitud: -75.7290741,
    description:
      "Un espacio de encuentro del centro de Ica, con árboles, piletas y el obelisco.",
    address: "Plaza de Armas, centro de Ica",
    sourceUrl:
      "https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=11631",
    photo: "/home/ica-plaza.webp",
    photoAlt: "Fotografía de la Plaza de Armas de Ica",
  },
  {
    id: "catedral",
    name: "Catedral de Ica",
    osmId: "way/441523328",
    latitud: -14.0648141,
    longitud: -75.729666,
    description:
      "La Catedral de San Jerónimo forma parte del conjunto histórico junto a la Plaza de Armas. Esta ficha no confirma su acceso al público.",
    address: "Avenida Bolívar, junto a la Plaza de Armas",
    sourceUrl:
      "https://www.gob.pe/institucion/cultura/noticias/964782-especialistas-del-ministerio-de-cultura-evaluan-in-situ-la-catedral-de-ica",
  },
  {
    id: "luren",
    name: "Santuario del Señor de Luren",
    osmId: "way/770030732",
    latitud: -14.0706578,
    longitud: -75.72552665,
    description:
      "Santuario dedicado al Señor de Luren. El templo reconstruido fue concluido en 2019.",
    address: "Santuario del Señor de Luren, centro de Ica",
    sourceUrl:
      "https://www.gob.pe/institucion/cultura/noticias/29505-reconstruccion-de-santuario-del-senor-de-luren-en-ica-se-realizo-con-asesoramiento-tecnico-permanente-del-ministerio-de-cultura",
  },
  {
    id: "museo",
    name: "Museo Regional de Ica",
    osmId: "way/364396783",
    latitud: -14.072592,
    longitud: -75.7339115,
    description:
      "El Museo Regional de Ica «Adolfo Bermúdez Jenkins» conserva colecciones arqueológicas e históricas de la región.",
    address: "Avenida Ayabaca 895, Ica",
    sourceUrl: "https://museos.cultura.pe/node/383",
  },
];

export function cityPosition(
  longitud: number,
  latitud: number,
  origin: CityPoint,
  metersPerUnit = 100,
): CityPoint {
  return [
    ((longitud - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180)) /
      metersPerUnit || 0,
    (-(latitud - origin[1]) * 111320) / metersPerUnit || 0,
  ];
}

export type SelectionPhase = "overview" | "lifting" | "focused" | "returning";
/** One active model at a time; rapid selections return the old one before lifting another. */
export class CitySelection {
  active: LandmarkId | null = null;
  requested: LandmarkId | null = null;
  progress = 0;
  phase: SelectionPhase = "overview";
  select(id: LandmarkId | null) {
    this.requested = id;
  }
  tick(seconds: number) {
    const delta = Math.max(0, Math.min(0.1, seconds)) / 1.15;
    if (this.active !== this.requested && this.active) {
      this.phase = "returning";
      this.progress = Math.max(0, this.progress - delta);
      if (this.progress <= 1e-6) {
        this.progress = 0;
        this.active = null;
        this.phase = "overview";
      }
    }
    if (!this.active && this.requested) {
      this.active = this.requested;
      this.phase = "lifting";
    }
    if (this.active === this.requested && this.active) {
      this.progress = Math.min(1, this.progress + delta);
      this.phase = this.progress >= 1 ? "focused" : "lifting";
    }
    if (!this.active && !this.requested) this.phase = "overview";
    return {
      active: this.active,
      phase: this.phase,
      progress: this.progress,
      eased: this.progress * this.progress * (3 - 2 * this.progress),
    };
  }
  reset() {
    this.active = null;
    this.requested = null;
    this.progress = 0;
    this.phase = "overview";
  }
}
