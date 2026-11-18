import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LandmarkId } from "../../lib/city-scene";

export const ICA_ARCHITECTURE_REFERENCES = {
  catedral: [
    { label: "Estudio de la Catedral · Getty Conservation Institute", url: "https://www.getty.edu/projects/seismic-retrofitting/case-study-ica-cathedral/" },
    { label: "Fachada en 2023 · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Catedral_de_Ica,_frente.jpg" },
    { label: "Vista lateral en 2023 · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Catedral_de_Ica,_lateral.jpg" },
  ],
  luren: [
    { label: "Fachada en 2019 · Eduardo Vera-Palomino, dominio público", url: "https://commons.wikimedia.org/wiki/File:Santuario_de_Luren,_2019.jpg" },
    { label: "Vista lateral · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Santuario_del_se%C3%B1or_de_Luren,_lado_este.jpg" },
  ],
  museo: [
    { label: "Museo Regional de Ica · Ministerio de Cultura", url: "https://museos.cultura.pe/node/383" },
    { label: "Fachada en 2023 · Diario Oficial El Peruano", url: "https://elperuano.pe/noticia/220335-museo-regional-de-ica-inaugura-hoy-sus-renovadas-instalaciones" },
    { label: "Vista del ingreso y jardines · TVPerú", url: "https://www.tvperu.gob.pe/noticias/miscelanea/ica-museo-adolfo-bermudez-jenkins-realizara-actividades-por-73deg-aniversario" },
  ],
} as const;

type Material = "wall" | "trim" | "stone" | "roof" | "wood" | "shadow" | "glass" | "metal" | "brick" | "green";
type Palette = Partial<Record<Material, number>>;
type Point = readonly [number, number];
type Position = readonly [number, number, number];

// The buildings are assembled in metres, with the entrance toward local +Z and Y pointing up.
class Architecture {
  readonly group = new THREE.Group();
  private readonly batches = new Map<Material, THREE.BufferGeometry[]>();
  private readonly palette: Palette;

  constructor(palette: Palette) {
    this.palette = palette;
  }

  add(material: Material, geometry: THREE.BufferGeometry, [x, y, z]: Position, yaw = 0, pitch = 0) {
    if (pitch) geometry.rotateX(pitch);
    if (yaw) geometry.rotateY(yaw);
    geometry.translate(x, y, z);
    const parts = this.batches.get(material) ?? [];
    parts.push(geometry);
    this.batches.set(material, parts);
  }

  box(material: Material, w: number, h: number, d: number, position: Position, yaw = 0) {
    this.add(material, new THREE.BoxGeometry(w, h, d), position, yaw);
  }

  cylinder(material: Material, top: number, bottom: number, h: number, position: Position, sides = 12, pitch = 0) {
    this.add(material, new THREE.CylinderGeometry(top, bottom, h, sides), position, 0, pitch);
  }

  segment(material: Material, a: Point, b: Point, width: number, depth: number, offset: Position) {
    const [x, y, z] = offset;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const beam = new THREE.BoxGeometry(length, width, depth);
    beam.rotateZ(Math.atan2(b[1] - a[1], b[0] - a[0]));
    this.add(material, beam, [(a[0] + b[0]) / 2 + x, (a[1] + b[1]) / 2 + y, z]);
  }

  extrude(material: Material, shape: THREE.Shape, depth: number, position: Position, yaw = 0) {
    this.add(material, new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 7 }), position, yaw);
  }

  gable(material: Material, w: number, rise: number, depth: number, position: Position, yaw = 0) {
    const profile = new THREE.Shape();
    profile.moveTo(-w / 2, 0);
    profile.lineTo(w / 2, 0);
    profile.lineTo(0, rise);
    profile.closePath();
    this.extrude(material, profile, depth, position, yaw);
  }

  arch(fill: Material, trim: Material, w: number, h: number, frame: number, position: Position, yaw = 0) {
    const inset = new THREE.Shape();
    archProfile(inset, w, h);
    this.extrude(fill, inset, 0.03, position, yaw);
    const moulding = new THREE.Shape();
    archProfile(moulding, w + 2 * frame, h + frame, -frame);
    const opening = new THREE.Path();
    archProfile(opening, w, h);
    moulding.holes.push(opening);
    this.extrude(trim, moulding, 0.16, position, yaw);
  }

  cross(material: Material, w: number, h: number, [x, y, z]: Position) {
    this.box(material, w * 0.15, h, w * 0.15, [x, y + h / 2, z]);
    this.box(material, w, w * 0.15, w * 0.15, [x, y + h * 0.69, z]);
  }

  finish(id: LandmarkId, frontYaw: number, centerOffset = 0) {
    for (const [material, parts] of this.batches) {
      const unindexed = parts.map((part) => part.index ? part.toNonIndexed() : part);
      const geometry = mergeGeometries(unindexed);
      for (const part of unindexed) part.dispose();
      for (const part of parts) if (part.index) part.dispose();
      if (!geometry) continue;

      if (centerOffset) geometry.translate(centerOffset, 0, 0);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: this.palette[material],
        roughness: material === "glass" ? 0.43 : 0.85,
        metalness: material === "metal" ? 0.18 : 0,
      }));
      mesh.name = `${id}-${material}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.landmarkId = id;
      this.group.add(mesh);
    }
    this.batches.clear();
    this.group.name = id;
    this.group.rotation.y = frontYaw;
    this.group.userData = { landmarkId: id, frontYaw };
    return this.group;
  }
}

function archProfile(path: THREE.Path, width: number, height: number, base = 0) {
  const radius = width / 2;
  path.moveTo(-radius, base);
  path.lineTo(radius, base);
  path.lineTo(radius, height - radius);
  path.absarc(0, height - radius, radius, 0, Math.PI, false);
  path.lineTo(-radius, base);
  path.closePath();
}

function urn(model: Architecture, [x, y, z]: Position, scale: number) {
  const profile = [[0.25, 0], [0.35, 0.09], [0.72, 0.35], [0.74, 0.52], [0.59, 0.70], [0.38, 0.84], [0.43, 0.89], [0.43, 0.99], [0.35, 0.99], [0.33, 0.82], [0.25, 0.81]];
  const points = profile.map(([radius, height]) => new THREE.Vector2(scale * radius, scale * height));
  model.add("brick", new THREE.LatheGeometry(points, 14), [x, y, z]);
  model.cylinder("shadow", 0.33 * scale, 0.33 * scale, 0.025, [x, y + 0.81 * scale, z]);
}

function clock(model: Architecture, x: number, y: number, z: number, radius: number) {
  model.cylinder("trim", radius + 0.12, radius + 0.12, 0.12, [x, y, z], 24, Math.PI / 2);
  model.cylinder("wall", radius, radius, 0.11, [x, y, z + 0.07], 24, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    model.box("shadow", 0.09, 0.09, 0.08, [x + Math.sin(angle) * radius * 0.77, y + Math.cos(angle) * radius * 0.77, z + 0.135]);
  }
  model.segment("shadow", [0, 0], [0.18 * radius, 0.69 * radius], 0.085, 0.07, [x, y, z + 0.14]);
  model.segment("shadow", [0, 0], [-0.49 * radius, -0.25 * radius], 0.085, 0.07, [x, y, z + 0.14]);
}

function cathedral() {
  const model = new Architecture({ wall: 0xf1e5cd, trim: 0xfff2db, stone: 0xb3a087, roof: 0xab8772, wood: 0x553728, shadow: 0x322c29, metal: 0x494944, brick: 0xb17a5e });
  // The Getty study measures the front at 21 metres. The long side follows the OSM footprint.
  const front = 31.4;
  model.box("stone", 21.25, 0.54, 64, [0, 0.27, 0]);
  for (const x of [-8, 8]) {
    model.box("wall", 4.9, 8.4, 62, [x, 4.44, -0.35]);
    model.box("roof", 5.05, 0.28, 62, [x, 8.78, -0.35]);
  }
  model.box("wall", 10.3, 10.7, 4.2, [0, 5.62, 29.3]);
  for (const z of [-27.3, -18, -4.5, 7, 21.5]) {
    model.box("wall", 10.4, 9.7, 0.66, [0, 5.1, z]);
  }
  // Gaps in the roof mark the earthquake damage documented along the nave and central dome.
  for (const [start, length] of [[-31.4, 8.6], [-14.8, 8.6], [0.3, 10.9], [15.4, 7], [26.4, 3.1]]) {
    model.box("roof", 11.3, 0.28, length, [0, 10.85, start + length * 0.5]);
    model.gable("roof", 11.3, 2.2, length, [0, 10.99, start]);
  }
  for (const z of [16, 7, -2.2, -11.6, -19.5]) {
    model.box("stone", 0.38, 8.6, 0.74, [-10.48, 4.52, z]);
    model.arch("shadow", "stone", 1, 1.75, 0.14, [-10.59, 5.9, z + 2.8], -Math.PI / 2);
  }
  model.arch("wood", "trim", 3.9, 6.3, 0.36, [0, 0.71, front + 0.035]);
  model.box("wood", 0.12, 5.62, 0.11, [0, 3.52, front + 0.1]);
  for (const x of [-3.65, 3.65]) {
    model.arch("shadow", "trim", 1.35, 2.62, 0.18, [x, 3.2, front + 0.055]);
    model.cylinder("trim", 0.20, 0.32, 1.25, [x, 3.94, front + 0.16], 8);
    model.add("trim", new THREE.IcosahedronGeometry(0.24), [x, 4.73, front + 0.16]);
  }
  for (const x of [-5.2, -2.7, 2.7, 5.2]) {
    model.box("stone", 0.94, 0.8, 0.91, [x, 0.93, front + 0.04]);
    model.cylinder("trim", 0.28, 0.38, 7.2, [x, 4.92, front + 0.4]);
    model.box("trim", 0.9, 0.43, 0.8, [x, 8.69, front + 0.36]);
  }
  model.box("trim", 12.6, 0.59, 0.91, [0, 9.07, front + 0.19]);
  model.gable("wall", 12.1, 2.72, 0.58, [0, 9.39, front - 0.13]);
  model.segment("trim", [-6.12, 0], [0, 2.9], 0.34, 0.43, [0, 9.49, front + 0.37]);
  model.segment("trim", [0, 2.9], [6.12, 0], 0.34, 0.43, [0, 9.49, front + 0.37]);
  model.arch("shadow", "trim", 1.01, 1.23, 0.11, [0, 9.82, front + 0.48]);

  for (const x of [-7.9, 7.9]) {
    model.box("wall", 5.15, 10.5, 5.7, [x, 5.51, front - 2.68]);
    model.box("trim", 5.49, 0.49, 5.95, [x, 10.82, front - 2.68]);
    model.box("wall", 4.72, 4.47, 4.9, [x, 13.25, front - 2.67]);
    model.arch("shadow", "trim", 1.87, 3.01, 0.20, [x, 11.62, front - 0.21]);
    for (const pillar of [-1.93, 1.93]) {
      model.box("trim", 0.28, 4.08, 0.32, [x + pillar, 13.28, front - 0.11]);
    }
    model.box("trim", 5.04, 0.42, 5.2, [x, 15.57, front - 2.67]);
  }
  model.cylinder("wall", 1.78, 2.02, 1.52, [-7.9, 16.45, front - 2.67]);
  model.add("wall", new THREE.SphereGeometry(1.87, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), [-7.9, 17.21, front - 2.67]);
  model.cross("metal", 0.64, 1.18, [-7.9, 19.1, front - 2.67]);

  model.box("brick", 3.4, 2.2, 3.75, [7.9, 16.85, front - 2.67]);
  model.box("wall", 0.56, 3.05, 2.35, [9.47, 17.12, front - 2.66]);
  model.box("wall", 3.26, 1.48, 0.34, [7.9, 16.46, front - 0.76]);
  clock(model, 7.9, 16.57, front - 0.5, 0.7);

  const fence = front + 1.34;
  model.box("stone", 21.25, 0.27, 1.2, [0, 0.135, fence - 0.14]);
  for (let x = -10.28; x <= 10.29; x += 0.36) {
    model.box("metal", 0.055, 1.52, 0.055, [x, 1.03, fence]);
  }
  for (const y of [0.51, 1.48]) model.box("metal", 20.75, 0.075, 0.075, [0, y, fence]);
  for (const x of [-10.25, -2.1, 2.1, 10.25]) {
    model.box("metal", 0.145, 1.79, 0.15, [x, 1.16, fence]);
  }
  return model.finish("catedral", Math.atan2(0.952, -0.305));
}

function luren() {
  const model = new Architecture({ wall: 0xdad1bf, trim: 0xf1e6cf, stone: 0xaba38e, roof: 0x776f65, wood: 0x523731, glass: 0x698997, shadow: 0x3d4144, metal: 0x645748 });
  model.box("stone", 21.75, 0.60, 37, [0, 0.3, 10.44]);
  model.box("stone", 38.5, 0.60, 17.8, [0.65, 0.3, -16.65]);
  model.box("wall", 21.2, 13, 36.9, [0, 6.8, 10.4]);
  model.gable("roof", 21.7, 4.75, 37.4, [0, 13.32, -8.3]);
  model.box("wall", 38, 9.95, 17.2, [0.65, 5.27, -16.65]);
  model.gable("roof", 17.6, 3.28, 38.4, [-18.55, 10.25, -16.65], Math.PI / 2);
  model.cylinder("stone", 6.65, 6.65, 0.6, [0.65, 0.3, -21.1], 16);
  model.cylinder("wall", 6.58, 6.58, 8.65, [0.65, 4.63, -21.1], 16);
  model.cylinder("roof", 0.7, 6.65, 4.18, [0.65, 11.01, -21.1], 16);

  for (const side of [-1, 1]) {
    const x = 10.65 * side;
    for (const z of [-5, 1.4, 7.45, 13.5, 19.6, 25.2]) {
      model.box("trim", 0.48, 11.05, 0.66, [x, 5.86, z]);
    }
    for (const z of [4.5, 10.5, 16.6, 22.6]) {
      model.arch("glass", "trim", 1.42, 3.78, 0.21, [x + side * 0.28, 7.03, z], side * Math.PI / 2);
    }
    model.arch("glass", "trim", 2.25, 3.92, 0.24, [0.65 + side * 19.04, 4.3, -16.65], side * Math.PI / 2);

    const frontPinnacle = 8.55 * side;
    model.box("wall", 3.5, 13.6, 4.6, [frontPinnacle, 7.1, 26]);
    model.box("trim", 3.78, 0.40, 4.9, [frontPinnacle, 13.95, 26]);
    model.cylinder("stone", 0.18, 1.7, 4.05, [frontPinnacle, 16.2, 26], 8);
    model.cylinder("trim", 0.17, 0.25, 0.62, [frontPinnacle, 18.49, 26], 8);
    model.arch("wood", "trim", 1.90, 4.4, 0.28, [frontPinnacle, 0.67, 28.34]);
    model.arch("glass", "trim", 1.43, 2.6, 0.18, [frontPinnacle, 8.46, 28.34]);
    model.box("trim", 0.56, 8.54, 0.53, [side * 5.45, 4.92, 28.86]);
  }

  model.box("wall", 10.4, 19.8, 6.55, [0, 10.2, 25.8]);
  model.box("trim", 11.06, 0.53, 6.97, [0, 12.22, 25.8]);
  model.box("trim", 10.73, 0.39, 6.87, [0, 19.74, 25.8]);
  model.arch("wood", "trim", 4.22, 6.69, 0.46, [0, 0.67, 29.13]);
  model.box("metal", 0.10, 5.62, 0.07, [0, 3.49, 29.22]);
  model.arch("glass", "trim", 2.92, 3.52, 0.25, [0, 7.91, 29.13]);
  for (const x of [-0.69, 0, 0.69]) {
    model.box("stone", 0.10, 2.33, 0.07, [x, 9.14, 29.22]);
  }
  clock(model, 0, 16.7, 29.18, 1.27);

  model.box("wall", 5.72, 6.95, 5.75, [0, 23.13, 25.82]);
  for (const direction of [-1, 1]) {
    model.arch("shadow", "trim", 1.93, 3.58, 0.26, [0, 21.03, 25.82 + direction * 2.91], direction < 0 ? Math.PI : 0);
    model.arch("shadow", "trim", 1.93, 3.58, 0.26, [direction * 2.9, 21.03, 25.82], direction * Math.PI / 2);
    for (const z of [23.27, 28.37]) {
      model.box("trim", 0.49, 6.53, 0.49, [direction * 2.57, 23.03, z]);
      model.cylinder("stone", 0.04, 0.59, 1.79, [direction * 2.57, 27.82, z], 8);
    }
  }
  model.box("trim", 6.16, 0.49, 6.17, [0, 26.62, 25.82]);
  model.cylinder("stone", 0.13, 2.73, 6.4, [0, 30.06, 25.82], 8);
  model.cross("metal", 1.12, 1.86, [0, 33.26, 25.82]);
  model.box("stone", 22.5, 0.28, 2.05, [0, 0.14, 30.12]);
  model.box("trim", 21.8, 0.25, 1.65, [0, 0.405, 29.93]);
  // The front and the nave are slightly offset from the centre of the mapped footprint.
  return model.finish("luren", Math.atan2(-0.273, -0.962), 2.25);
}

const SIGN_GLYPHS: Record<string, readonly (readonly Point[])[]> = {
  A: [[[0, 0], [0.4, 1], [0.8, 0]], [[0.18, 0.43], [0.62, 0.43]]],
  C: [[[0.8, 0.84], [0.62, 1], [0.18, 1], [0, 0.84], [0, 0.16], [0.18, 0], [0.62, 0], [0.8, 0.16]]],
  D: [[[0, 0], [0, 1], [0.53, 1], [0.8, 0.75], [0.8, 0.25], [0.53, 0], [0, 0]]],
  E: [[[0.8, 1], [0, 1], [0, 0], [0.8, 0]], [[0, 0.5], [0.65, 0.5]]],
  G: [[[0.8, 0.85], [0.63, 1], [0.18, 1], [0, 0.81], [0, 0.18], [0.18, 0], [0.8, 0], [0.8, 0.47], [0.46, 0.47]]],
  I: [[[0.4, 0], [0.4, 1]], [[0.12, 0], [0.68, 0]], [[0.12, 1], [0.68, 1]]],
  L: [[[0, 1], [0, 0], [0.8, 0]]],
  M: [[[0, 0], [0, 1], [0.4, 0.47], [0.8, 1], [0.8, 0]]],
  N: [[[0, 0], [0, 1], [0.8, 0], [0.8, 1]]],
  O: [[[0.18, 0], [0, 0.18], [0, 0.82], [0.18, 1], [0.62, 1], [0.8, 0.82], [0.8, 0.18], [0.62, 0], [0.18, 0]]],
  R: [[[0, 0], [0, 1], [0.65, 1], [0.8, 0.86], [0.8, 0.62], [0.65, 0.49], [0, 0.49]], [[0.42, 0.49], [0.8, 0]]],
  S: [[[0.8, 0.86], [0.66, 1], [0.17, 1], [0, 0.83], [0, 0.62], [0.15, 0.49], [0.64, 0.49], [0.8, 0.36], [0.8, 0.15], [0.65, 0], [0.16, 0], [0, 0.14]]],
  U: [[[0, 1], [0, 0.18], [0.18, 0], [0.62, 0], [0.8, 0.18], [0.8, 1]]],
};

function museum() {
  const model = new Architecture({ wall: 0xd49e46, trim: 0xe5ba66, stone: 0xcac0aa, roof: 0xbcb7a5, wood: 0x6b4c36, shadow: 0x343c37, glass: 0x6b8080, metal: 0xbec2b5, brick: 0xa7603c, green: 0x586a3e });

  model.box("stone", 40.2, 0.42, 60.3, [0, 0.21, 1.6]);
  model.box("wall", 38.4, 7.7, 53.9, [0, 4.25, -1.3]);
  model.box("roof", 38.65, 0.27, 54.1, [0, 8.23, -1.3]);
  model.box("wall", 38.4, 7.75, 2.54, [0, 4.28, 26.91]);
  model.box("trim", 38.65, 0.48, 0.62, [0, 8.29, 28.13]);
  model.box("trim", 38.45, 0.33, 0.29, [0, 5.6, 28.22]);
  model.box("stone", 38.5, 0.71, 0.24, [0, 0.7, 28.22]);

  model.box("shadow", 6.59, 4.3, 0.09, [-2.9, 2.52, 28.22]);
  model.box("glass", 4.39, 3.46, 0.12, [-2.9, 2.13, 28.27]);
  model.box("wood", 0.16, 3.46, 0.12, [-2.9, 2.13, 28.34]);
  model.box("metal", 0.07, 0.43, 0.13, [-3.17, 2.03, 28.43]);
  model.box("metal", 0.07, 0.43, 0.13, [-2.63, 2.03, 28.43]);
  model.box("trim", 7.17, 0.39, 0.86, [-2.9, 4.75, 28.51]);

  for (const [x, width] of [[-13.8, 6.1], [9.45, 5.1], [15.05, 3.4]]) {
    model.box("wood", width + 0.32, 2.47, 0.17, [x, 3.23, 28.26]);
    model.box("glass", width, 2.13, 0.18, [x, 3.23, 28.34]);
    for (const offset of [-1, 0, 1]) {
      model.box("wood", 0.09, 2.15, 0.12, [x + offset * width / 4, 3.23, 28.44]);
    }
    model.box("wood", width, 0.10, 0.12, [x, 3.23, 28.44]);
  }
  for (const x of [-7.78, 1.98]) urn(model, [x, 0.42, 29.7], 1.53);
  for (const [x, z] of [[-19, 29.53], [-17.9, 28.8], [-17.84, 29.86], [17.9, 29.4], [18.4, 28.6], [19, 29.9]]) {
    model.add("green", new THREE.IcosahedronGeometry(0.85, 1), [x, 0.87, z]);
  }
  model.box("stone", 2.25, 0.15, 2.49, [6.9, 0.5, 30.05]);
  model.cylinder("metal", 0.065, 0.065, 9.42, [6.9, 5.16, 30.05], 8);
  model.box("brick", 0.61, 1.22, 0.07, [7.24, 8.92, 30.05]);
  model.box("metal", 0.61, 1.22, 0.07, [7.85, 8.92, 30.05]);
  model.box("brick", 0.61, 1.22, 0.07, [8.46, 8.92, 30.05]);

  const name = "MUSEO REGIONAL DE ICA";
  for (const [i, char] of Array.from(name).entries()) {
    const lines = SIGN_GLYPHS[char] ?? [];
    for (const line of lines) {
      const points = line.map(([x, y]) => [x * 0.61, y * 0.69] as const);
      for (let j = 1; j < points.length; j++) model.segment("shadow", points[j - 1], points[j], 0.08, 0.06, [-9.48 + i * 0.67, 6.49, 28.25]);
    }
  }
  return model.finish("museo", Math.atan2(-0.0115, -1));
}

export function createIcaArchitecture(id: LandmarkId): THREE.Group | null {
  switch (id) {
    case "catedral": return cathedral();
    case "luren": return luren();
    case "museo": return museum();
    default: return null;
  }
}
