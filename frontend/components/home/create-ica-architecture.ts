import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LandmarkId } from "../../lib/city-scene";
import { createIcaMuseum, ICA_MUSEUM_REFERENCES } from "./create-ica-museum";

export const ICA_ARCHITECTURE_REFERENCES = {
  catedral: [
    { label: "Estudio de la Catedral · Getty Conservation Institute", url: "https://www.getty.edu/projects/seismic-retrofitting/case-study-ica-cathedral/" },
    { label: "Levantamiento estructural · Getty Conservation Institute", url: "https://www.getty.edu/conservation/publications_resources/pdf_publications/pdf/assess_proto_v1_ch4_sect4_7.pdf" },
    { label: "Fachada y lateral norte en 2023 · El Comercio", url: "https://elcomercio.pe/peru/terremoto-en-ica-las-tareas-pendientes-de-reconstruccion-en-la-region-a-16-anos-del-siniestro-simulacro-15-de-agosto-pisco-ica-chincha-terremoto-sismo-noticia/" },
    { label: "Fachada en 2023 · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Catedral_de_Ica,_frente.jpg" },
    { label: "Vista lateral en 2023 · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Catedral_de_Ica,_lateral.jpg" },
  ],
  luren: [
    { label: "Fachada y portada restauradas · Agencia Andina", url: "https://andina.pe/agencia/galeria-despues-12-anos-imagen-del-senor-luren-vuelve-a-su-reconstruido-santuario-6544.aspx" },
    { label: "Vista aérea y altura del campanario · Perú Construye", url: "https://peruconstruye.net/2019/07/16/reconstruccion-del-santuario-del-senor-de-luren-de-ica-tecnologia-de-avanzada/" },
    { label: "Fachada en 2019 · Eduardo Vera-Palomino, dominio público", url: "https://commons.wikimedia.org/wiki/File:Santuario_de_Luren,_2019.jpg" },
    { label: "Vista lateral · Chrispavm, CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Santuario_del_se%C3%B1or_de_Luren,_lado_este.jpg" },
  ],
  museo: ICA_MUSEUM_REFERENCES,
} as const;

type Material = "wall" | "trim" | "stone" | "roof" | "wood" | "shadow" | "glass" | "metal" | "brick" | "amber";
type Palette = Partial<Record<Material, number>>;
type Point = readonly [number, number];
type Position = readonly [number, number, number];
type Opening = readonly [x: number, base: number, width: number, height: number];

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

  extrude(material: Material, shape: THREE.Shape, depth: number, position: Position, yaw = 0, curveSegments = 7) {
    this.add(material, new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments }), position, yaw);
  }

  gable(material: Material, w: number, rise: number, depth: number, position: Position, yaw = 0) {
    this.polygon(material, [[-w / 2, 0], [w / 2, 0], [0, rise]], depth, position, yaw);
  }

  polygon(material: Material, corners: readonly Point[], depth: number, position: Position, yaw = 0) {
    const outline = new THREE.Shape(corners.map(([x, y]) => new THREE.Vector2(x, y)));
    outline.closePath();
    this.extrude(material, outline, depth, position, yaw);
  }

  openingWall(material: Material, w: number, h: number, depth: number, openings: readonly Opening[], position: Position, yaw = 0) {
    const outline = new THREE.Shape();
    outline.moveTo(-w / 2, 0);
    outline.lineTo(w / 2, 0);
    outline.lineTo(w / 2, h);
    outline.lineTo(-w / 2, h);
    outline.closePath();
    for (const [x, base, width, height] of openings) {
      const outlineHole = new THREE.Path();
      archProfile(outlineHole, width, height, 0, x, base);
      outline.holes.push(outlineHole);
    }
    this.extrude(material, outline, depth, position, yaw);
  }

  barrel(material: Material, w: number, rise: number, length: number, position: Position, yaw = 0) {
    const thickness = 0.24;
    const vault = new THREE.Shape();
    vault.absellipse(0, 0, w / 2, rise, 0, Math.PI, false);
    vault.absellipse(0, 0, w / 2 - thickness, rise - thickness, Math.PI, 0, true);
    vault.closePath();
    this.extrude(material, vault, length, position, yaw);
  }

  lathe(material: Material, profile: readonly Point[], position: Position, sides = 16) {
    this.add(material, new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), sides), position);
  }

  arch(fill: Material, trim: Material, w: number, h: number, frame: number, position: Position, yaw = 0) {
    const inset = new THREE.Shape();
    archProfile(inset, w, h);
    this.extrude(fill, inset, 0.03, position, yaw, w < 0.7 ? 3 : 7);
    this.archFrame(trim, w, h, frame, position, yaw);
  }

  archFrame(trim: Material, w: number, h: number, frame: number, position: Position, yaw = 0) {
    const moulding = new THREE.Shape();
    archProfile(moulding, w + 2 * frame, h + frame, -frame);
    const opening = new THREE.Path();
    archProfile(opening, w, h);
    moulding.holes.push(opening);
    this.extrude(trim, moulding, 0.16, position, yaw, w < 0.7 ? 3 : 7);
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

function archProfile(path: THREE.Path, width: number, height: number, base = 0, x = 0, y = 0) {
  const radius = width / 2;
  path.moveTo(x - radius, y + base);
  path.lineTo(x + radius, y + base);
  path.lineTo(x + radius, y + height - radius);
  path.absarc(x, y + height - radius, radius, 0, Math.PI, false);
  path.lineTo(x - radius, y + base);
  path.closePath();
}

function clock(model: Architecture, x: number, y: number, z: number, radius: number) {
  model.cylinder("trim", radius + 0.12, radius + 0.12, 0.12, [x, y, z], 24, Math.PI / 2);
  model.cylinder("wall", radius, radius, 0.11, [x, y, z + 0.07], 24, Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const inside = i % 3 === 0 ? 0.65 : 0.72;
    model.segment("shadow", [Math.sin(angle) * radius * inside, Math.cos(angle) * radius * inside], [Math.sin(angle) * radius * 0.85, Math.cos(angle) * radius * 0.85], 0.04, 0.035, [x, y, z + 0.135]);
  }
  model.segment("shadow", [0, 0], [0.18 * radius, 0.69 * radius], 0.085, 0.07, [x, y, z + 0.14]);
  model.segment("shadow", [0, 0], [-0.49 * radius, -0.25 * radius], 0.085, 0.07, [x, y, z + 0.14]);
}

function cathedral() {
  const model = new Architecture({ wall: 0xd5cbb9, trim: 0xe8dfcf, stone: 0xa9a093, roof: 0xb5a28f, wood: 0x624832, shadow: 0x393632, metal: 0x43433f, brick: 0xa3614c });
  const front = 29.8;
  model.box("stone", 21.25, 0.36, 64, [0, 0.18, 0]);

  // The surveyed long walls carry low aisle roofs and quincha cupolas on each side of the nave.
  for (const side of [-1, 1]) {
    const lateralYaw = side * Math.PI / 2;
    model.box("wall", 1.22, 7.48, 58.8, [side * 9.81, 4.09, -0.43]);
    model.box("brick", 0.06, 1.14, 59, [side * 10.45, 0.93, -0.43]);
    model.box("trim", 0.51, 0.33, 59, [side * 10.08, 7.98, -0.43]);
    model.box("roof", 4.85, 0.32, 54, [side * 7.81, 7.82, 2.6]);
    for (const z of [23.8, 15, 6.1, -2.9]) {
      const x = side * 7.71;
      model.lathe("roof", [[2.12, 0], [2.12, 0.2], [1.9, 0.74], [1.52, 1.12], [0.75, 1.55], [0.26, 1.62]], [x, 7.94, z], 14);
      model.cylinder("trim", 0.19, 0.32, 0.58, [x, 9.79, z], 8);
      model.cylinder("stone", 0.03, 0.24, 0.31, [x, 10.23, z], 8);
      model.box("wall", 0.58, 7.7, 0.85, [side * 10.5, 4.21, z - 3.95]);
      model.box("trim", 0.57, 0.21, 1.1, [side * 10.53, 8.08, z - 3.95]);
      model.arch("shadow", "stone", 1.1, 1.54, 0.11, [side * 10.46, 5.81, z], lateralYaw);
    }
    const aislePier = side * 5.15;
    for (const z of [21, 12.6, 4.2, -4.2, -12.6]) {
      model.box("stone", 1.26, 0.61, 1.29, [aislePier, 0.64, z]);
      model.box("wall", 0.71, 6.85, 0.77, [aislePier, 4.37, z]);
      model.box("trim", 1.08, 0.36, 1.15, [aislePier, 7.83, z]);
      model.archFrame("wall", 7.35, 4.9, 0.27, [aislePier, 6.04, z - 4.2], lateralYaw);
    }
  }
  model.arch("wood", "trim", 2.75, 5.1, 0.26, [10.5, 0.4, -14.7], Math.PI / 2);
  model.gable("wall", 5.15, 1.45, 0.34, [10.34, 7.99, -14.76], Math.PI / 2);
  model.box("wall", 20.55, 7.6, 1.14, [0, 4.21, -29.8]);

  // Documented roof openings reveal the remaining wooden ribs and a quarter of the crossing dome.
  const naveRoof = 9.05;
  for (const [start, length] of [[-28.8, 8.35], [-3.7, 9.5], [18, 11.9]]) {
    model.barrel("roof", 10.72, 3.48, length, [0, naveRoof, start]);
  }
  for (const z of [6.2, 7.31, 9.15, 11.65, 13.88, 15.85, 17.61]) {
    model.barrel("wood", 10.48, 3.3, 0.12, [0, naveRoof - 0.07, z]);
  }
  for (const side of [-1, 1]) model.box("wood", 0.28, 0.36, 23.7, [side * 5.34, naveRoof - 0.14, 7.65]);
  model.barrel("roof", 9.2, 2.91, 20.4, [-10.2, 8.03, -13.81], Math.PI / 2);
  const survivingDome = new THREE.SphereGeometry(5.12, 22, 12, Math.PI / 2, Math.PI * 1.5, 0, Math.PI / 2);
  survivingDome.scale(1, 0.77, 1);
  model.add("roof", survivingDome, [0, 11.14, -13.81]);
  for (const angle of [0.18, 0.4, 0.69, 1.02, 1.23, 1.43]) {
    const rib = new THREE.EllipseCurve(0, 0, 4.93, 3.83, 0, Math.PI / 2, false, 0);
    const points = rib.getPoints(7).map(({ x, y }) => new THREE.Vector3(-x * Math.cos(angle), y, x * Math.sin(angle)));
    model.add("wood", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 7, 0.057, 5, false), [0, 11.09, -13.81]);
  }

  // The entrance is framed by paired pilasters and two statue niches, with a sunburst in the tympanum.
  model.box("wall", 14.1, 9.55, 1.35, [0, 5.08, front - 0.675]);
  model.box("brick", 14.1, 1.09, 0.12, [0, 0.905, front + 0.028]);
  model.arch("wood", "trim", 3.61, 5.21, 0.29, [0, 0.41, front + 0.072]);
  model.archFrame("stone", 4.23, 5.52, 0.14, [0, 0.33, front + 0.052]);
  for (const x of [-1.26, -0.72, 0, 0.72, 1.26]) {
    model.box("shadow", 0.032, 4.05, 0.024, [x, 2.53, front + 0.11]);
  }
  for (const x of [-2.64, 2.64]) {
    model.arch("stone", "trim", 0.96, 2.06, 0.12, [x, 1.77, front + 0.055]);
    model.lathe("trim", [[0.22, 0], [0.22, 0.16], [0.36, 0.37], [0.24, 0.76], [0.25, 0.97], [0.16, 1.19], [0.08, 1.27]], [x, 2.02, front + 0.23], 10);
    model.add("trim", new THREE.IcosahedronGeometry(0.15, 1), [x, 3.39, front + 0.23]);
    model.box("trim", 0.92, 0.16, 0.42, [x, 1.79, front + 0.22]);
  }
  for (const x of [-4.02, -3.53, 3.53, 4.02]) {
    model.box("stone", 0.59, 0.57, 0.53, [x, 0.9, front + 0.19]);
    model.box("trim", 0.31, 4.41, 0.38, [x, 3.38, front + 0.23]);
    model.box("trim", 0.53, 0.24, 0.58, [x, 5.62, front + 0.24]);
  }
  for (const x of [-5.9, -3.74, -1.73, 1.73, 3.74, 5.9]) {
    const width = Math.abs(x) > 5 ? 1.76 : 1.19;
    model.box("brick", width, 2.68, 0.11, [x, 7.7, front + 0.062]);
    if (Math.abs(x) < 5.3) model.box("stone", width * 0.7, 2.08, 0.06, [x + 0.18, 7.7, front + 0.14]);
  }
  model.box("trim", 8.6, 0.31, 0.58, [0, 5.91, front + 0.28]);
  model.box("trim", 13.95, 0.33, 0.65, [0, 9.14, front + 0.21]);
  model.box("trim", 14.35, 0.27, 0.7, [0, 9.48, front + 0.26]);
  model.gable("wall", 14.08, 2.26, 0.53, [0, 9.59, front - 0.23]);
  model.segment("trim", [-7.15, 0], [0, 2.27], 0.24, 0.46, [0, 9.67, front + 0.35]);
  model.segment("trim", [0, 2.27], [7.15, 0], 0.24, 0.46, [0, 9.67, front + 0.35]);
  model.cylinder("stone", 0.45, 0.45, 0.11, [0, 10.25, front + 0.38], 16, Math.PI / 2);
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    const length = i % 2 ? 0.73 : 1.0;
    model.segment("trim", [0.52 * Math.cos(angle), 0.43 * Math.sin(angle)], [(0.52 + length) * Math.cos(angle), (0.43 + length * 0.36) * Math.sin(angle)], 0.064, 0.09, [0, 10.25, front + 0.42]);
  }
  model.lathe("trim", [[0.62, 0], [0.53, 0.18], [0.47, 0.77], [0.63, 0.93], [0.39, 1.37], [0, 1.59]], [0, 6.28, front + 0.39], 11);

  // Both surviving tiered cupolas sit on damaged square, timber-framed bell towers.
  for (const x of [-8.12, 8.12]) {
    const z = front - 2.02;
    model.box("wall", 4.63, 8.48, 4.66, [x, 4.6, z]);
    model.box("brick", 4.7, 0.92, 4.7, [x, 0.82, z]);
    for (const [y, w, h] of [[8.83, 5.11, 0.23], [9.12, 4.97, 0.29], [14.17, 4.36, 0.28], [17.41, 4.13, 0.36]]) {
      model.box("trim", w, h, w, [x, y, z]);
    }
    for (const lateral of [-1, 1]) {
      for (const face of [-1, 1]) {
        model.box("wall", 0.64, 8.14, 0.64, [x + lateral * 1.65, 13.26, z + face * 1.65]);
        model.box("trim", 0.28, 5.05, 0.36, [x + lateral * 1.74, 11.89, z + face * 1.94]);
        model.box("wood", 0.16, 5.28, 0.18, [x + lateral * 1.36, 11.96, z + face * 1.49]);
      }
      model.box("wood", 3.08, 0.17, 0.15, [x, 13.47, z + lateral * 1.59]);
      model.box("wood", 0.15, 0.17, 3.08, [x + lateral * 1.59, 13.47, z]);
      model.archFrame("stone", 1.35, 3.64, 0.13, [x + lateral * 1.94, 9.58, z], lateral * Math.PI / 2);
    }
    model.archFrame("trim", 1.55, 3.85, 0.16, [x, 9.5, z + 2.03]);
    const shutterZ = z + (x > 0 ? 0.98 : 1.82);
    model.arch("wood", "stone", 1.45, 3.66, 0.08, [x, 9.53, shutterZ]);
    for (const offset of [-0.49, -0.26, 0, 0.26, 0.49]) {
      model.box("shadow", 0.036, 2.9, 0.045, [x + offset, 11, shutterZ + 0.058]);
    }
    model.box("wall", 3.61, 3.15, 0.4, [x, 15.76, z - 1.64]);
    if (x > 0) {
      model.box("wall", 3.61, 3.15, 0.46, [x, 15.76, z + 1.59]);
      clock(model, x, 15.78, z + 1.83, 0.94);
    } else {
      const damagedWall = new THREE.Shape([new THREE.Vector2(-1.86, 0), new THREE.Vector2(1.86, 0), new THREE.Vector2(1.86, 2.93), new THREE.Vector2(-1.86, 2.93)]);
      const damage = new THREE.Path([new THREE.Vector2(-0.19, 2.06), new THREE.Vector2(0.4, 1.98), new THREE.Vector2(0.83, 1.64), new THREE.Vector2(0.54, 1.18), new THREE.Vector2(0.15, 0.7), new THREE.Vector2(-0.35, 0.88), new THREE.Vector2(-0.88, 1.38), new THREE.Vector2(-0.65, 1.73)]);
      damagedWall.holes.push(damage);
      model.extrude("wall", damagedWall, 0.22, [x, 14.37, z + 1.59]);
      model.box("wood", 1.61, 0.18, 0.14, [x, 15.67, z + 1.53]);
    }
    model.cylinder("wall", 1.56, 1.77, 0.76, [x, 17.91, z], 20);
    model.lathe("trim", [[1.87, 0], [1.87, 0.15], [1.7, 0.28], [1.54, 0.61], [1.39, 0.95], [1.11, 1.26], [0.83, 1.37], [0.73, 1.63], [0.61, 1.82], [0.42, 2.15], [0.33, 2.54], [0.25, 2.63]], [x, 18.28, z], 20);
    for (const offset of [-0.32, 0.32]) {
      model.arch("shadow", "stone", 0.29, 0.43, 0.05, [x + offset, 17.64, z + 1.7]);
    }
    model.cross("metal", 0.73, 1.15, [x, 20.91, z]);
  }

  for (const [depth, height] of [[2.22, 0.12], [1.75, 0.24], [1.23, 0.36]]) {
    model.box("stone", 16.8, height, depth, [0, height * 0.5, front + 0.71]);
  }
  const fence = 32.67;
  model.box("stone", 21.25, 0.22, 0.38, [0, 0.11, fence]);
  for (let x = -10.28; x <= 10.29; x += 0.34) model.box("metal", 0.047, 1.61, 0.047, [x, 1.02, fence]);
  for (const y of [0.47, 1.54]) model.box("metal", 20.71, 0.055, 0.057, [0, y, fence]);
  for (const x of [-10.28, -6.13, -2.08, 2.08, 6.13, 10.28]) {
    model.box("metal", 0.116, 1.82, 0.12, [x, 1.12, fence]);
    model.cylinder("metal", 0, 0.087, 0.23, [x, 2.15, fence], 5);
  }
  return model.finish("catedral", Math.atan2(0.952, -0.305));
}

function luren() {
  const model = new Architecture({ wall: 0xcac9bd, trim: 0xe4dfd0, stone: 0x8d9189, roof: 0xc1c3b9, wood: 0x886039, glass: 0x647a75, amber: 0xb88f4b, shadow: 0x343730, metal: 0x525953 });
  const front = 27.95;
  const towerZ = 24.83;
  model.box("stone", 21.75, 0.57, 36.9, [0, 0.285, 10.52]);
  model.box("stone", 38.35, 0.57, 17.67, [0.65, 0.285, -16.62]);
  model.cylinder("stone", 6.72, 6.72, 0.57, [0.65, 0.285, -21.05], 18);

  // The aerial view shows barrel-vaulted roofs, shorter lateral aisles and the crossing dome.
  model.box("wall", 21, 8.15, 34.95, [0, 4.64, 9.145]);
  model.box("wall", 11.45, 3.26, 38, [0, 10.07, 10.51]);
  model.barrel("roof", 11.91, 3.75, 38, [0, 11.75, -8.5]);
  model.box("wall", 37.87, 9.88, 16.98, [0.65, 5.51, -16.65]);
  model.barrel("roof", 17.36, 3.49, 37.9, [-18.3, 10.45, -16.65], Math.PI / 2);
  model.cylinder("wall", 6.6, 6.6, 9.15, [0.65, 5.19, -21.11], 18);
  model.lathe("roof", [[6.68, 0], [6.64, 0.31], [6.22, 1], [5.68, 1.93], [4.42, 3], [2.76, 3.69], [0, 3.88]], [0.65, 9.74, -21.11], 20);

  const domeX = 0.65, domeZ = -15.48;
  model.cylinder("trim", 5.72, 5.96, 0.63, [domeX, 12.6, domeZ], 20);
  model.cylinder("wall", 5.27, 5.31, 3.85, [domeX, 14.61, domeZ], 20);
  model.cylinder("trim", 5.57, 5.39, 0.37, [domeX, 16.62, domeZ], 20);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const [x, z] = [domeX + 5.32 * Math.sin(angle), domeZ + 5.32 * Math.cos(angle)];
    model.arch("glass", "trim", 0.99, 2.08, 0.14, [x, 13.37, z], angle);
    model.box("trim", 0.095, 1.67, 0.10, [x + 0.05 * Math.sin(angle), 14.21, z + 0.05 * Math.cos(angle)], angle);
  }
  model.lathe("roof", [[5.48, 0], [5.39, 0.35], [5.19, 1.12], [4.8, 2.07], [4.2, 3], [3.35, 3.81], [2.44, 4.46], [1.08, 4.98]], [domeX, 16.82, domeZ], 24);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const profile: readonly Point[] = [[5.51, 0], [5.23, 1.12], [4.23, 3], [3.37, 3.81], [2.47, 4.46], [1.08, 4.98]];
    const ribs = profile.map(([r, y]) => new THREE.Vector3(r * Math.sin(angle), y, r * Math.cos(angle)));
    model.add("trim", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribs), 8, 0.066, 5, false), [domeX, 16.82, domeZ]);
  }
  model.cylinder("trim", 0.78, 1.15, 0.29, [domeX, 21.79, domeZ], 16);
  lurenLantern(model, domeX, 21.79, domeZ, 1.2);
  model.cross("metal", 0.57, 0.9, [domeX, 24.28, domeZ]);

  for (const side of [-1, 1]) {
    const yaw = side * Math.PI / 2;
    for (const [width, height, depth, x, y] of [[0.17, 0.99, 36.18, 10.55, 1.055], [0.59, 0.28, 36.18, 10.59, 8.78], [0.15, 0.18, 36.18, 10.68, 8.53]]) {
      model.box(y < 2 ? "stone" : "trim", width, height, depth, [side * x, y, 9.78]);
    }
    for (const z of [-7.05, 0.42, 7.82, 15.2, 22.6]) {
      model.box("wall", 0.78, 7.74, 0.93, [side * 10.51, 4.61, z]);
      model.box("trim", 1.08, 0.34, 1.24, [side * 10.56, 8.55, z]);
    }
    for (const z of [-3.28, 4.13, 11.52, 18.89, 25.32]) {
      model.arch("glass", "trim", 1.45, 3.03, 0.17, [side * 10.54, 3.69, z], yaw);
      model.arch("glass", "trim", 1.02, 1.49, 0.12, [side * 5.79, 10.18, z], yaw);
      model.box("stone", 0.16, 2.24, 0.083, [side * 10.61, 4.84, z], yaw);
    }
    const transept = 0.65 + side * 18.95;
    model.box("stone", 0.17, 0.98, 16.84, [transept + side * 0.035, 1.05, -16.65]);
    model.box("trim", 0.48, 0.34, 17.4, [transept, 10.42, -16.65]);
    model.arch("wood", "trim", 2.33, 5.17, 0.26, [transept + side * 0.07, 0.68, -16.65], yaw);
    for (const z of [-21.68, -11.69]) model.arch("glass", "trim", 1.61, 3.01, 0.2, [transept + side * 0.07, 3.58, z], yaw);
  }

  // The restored front has a deeply recessed central doorway with grouped stained-glass panels above.
  const portal: Opening = [0, 0.58, 4.12, 5.28];
  model.openingWall("wall", 6.78, 7.09, 2.66, [portal], [0, 0, front - 1.04]);
  model.arch("wood", "trim", 3.23, 4.73, 0.22, [0, 0.61, front - 1.08]);
  model.archFrame("trim", 4.12, 5.28, 0.24, [0, 0.58, front + 1.64]);
  model.archFrame("stone", 4.59, 5.58, 0.12, [0, 0.53, front + 1.67]);
  for (const x of [-2.72, 2.72]) {
    model.box("stone", 1.05, 0.91, 0.93, [x, 1.05, front + 1.52]);
    model.box("trim", 0.83, 0.24, 0.85, [x, 3.94, front + 1.49]);
  }
  model.box("wood", 0.11, 4.05, 0.08, [0, 2.68, front - 1.025]);
  for (const x of [-0.76, 0.76]) {
    for (const y of [1.53, 2.64, 3.71]) facadePanel(model, "amber", x, y, front - 1.03, 0.91, 0.76, 0.071);
  }
  for (const [depth, rise] of [[2.48, 0.19], [2.1, 0.37], [1.76, 0.56]]) model.box("trim", 6.96, rise, depth, [0, rise / 2, front + 1.49]);

  for (const side of [-1, 1]) {
    const outer = side * 9.71, inner = side * 4.52;
    model.box("wall", 7.18, 10.53, 1.2, [side * 6.96, 5.78, front - 0.47]);
    model.polygon("wall", [[side * 3.56, 0], [side * 9.79, 0], [side * 4.03, 4.11], [side * 3.56, 4.28]], 0.47, [0, 10.85, front - 0.14]);
    model.segment("trim", [side * 9.76, 0], [side * 4.01, 4.18], 0.23, 0.37, [0, 10.9, front + 0.28]);
    facadeBand(model, side * 6.94, 8.2, front + 0.08, 6.94, 0.53);
    for (const x of [5.69, 6.97, 8.25]) facadePanel(model, "trim", side * x, 9.74, front + 0.136, 0.98, 0.46, 0.065);
    model.box("stone", 7.55, 1.15, 0.28, [side * 6.92, 1.14, front + 0.12]);
    stainedWindow(model, side * 7.2, 2.19, front + 0.16, 2.64, 3.84, 3);
    stainedWindow(model, side * 3.64, 2.25, front + 0.45, 0.79, 3.45, 1);

    for (const [x, top] of [[outer, 12.78], [inner, 17.52]]) {
      model.box("wall", 1.35, top - 0.57, 1.41, [x, (top + 0.57) * 0.5, front - 0.24]);
      model.box("stone", 1.6, 1.14, 1.62, [x, 1.14, front - 0.24]);
      for (const y of [8.75, top - 0.27, top + 0.08]) model.box("trim", 1.64, 0.23, 1.65, [x, y, front - 0.24]);
      lurenLantern(model, x, top + 0.18, front - 0.24, 1.07);
    }
  }

  model.box("wall", 6.89, 6.66, 7.0, [0, 10.35, towerZ]);
  facadeBand(model, 0, 7.29, front + 0.38, 6.97, 0.39);
  facadeBand(model, 0, 12.55, front + 0.38, 7.15, 0.37);
  model.box("stone", 4.4, 3.72, 0.08, [0, 10.04, front + 0.402]);
  stainedWindow(model, 0, 8.17, front + 0.45, 3.88, 3.46, 4);
  model.box("amber", 0.83, 1.1, 0.13, [0, 12.05, front + 0.49]);
  model.box("trim", 0.93, 0.12, 0.27, [0, 12.62, front + 0.52]);

  const belfryWidth = 5.64, belfryFace = belfryWidth / 2;
  const bellWindows: readonly Opening[] = [[-1.12, 3.92, 1.47, 3.77], [1.12, 3.92, 1.47, 3.77]];
  const [belfryBase, belfryHeight] = [13.72, 9.44];
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const vx = Math.sin(yaw), vz = Math.cos(yaw);
    model.openingWall("wall", belfryWidth, belfryHeight, 0.36, bellWindows, [vx * (belfryFace - 0.36), belfryBase, towerZ + vz * (belfryFace - 0.36)], yaw);
    for (const offset of [-1.12, 1.12]) {
      const [x, z] = [vx * belfryFace + vz * offset, towerZ + vz * belfryFace - vx * offset];
      model.archFrame("trim", 1.47, 3.77, 0.17, [x, belfryBase + 3.92, z], yaw);
      model.box("wood", 1.37, 0.56, 0.10, [x - vx * 0.25, belfryBase + 4.32, z - vz * 0.25], yaw);
      const bell = [x - vx * 0.89, 18.97, z - vz * 0.89] as const;
      model.lathe("amber", [[0.44, 0], [0.42, 0.1], [0.32, 0.2], [0.28, 0.5], [0.17, 0.68], [0.07, 0.76]], bell, 10);
    }
  }
  for (const x of [-2.53, 0, 2.53]) model.box("trim", 0.32, 7.3, 0.28, [x, 19.33, towerZ + 2.78]);
  model.cylinder("trim", 0.96, 1.025, 0.175, [0, 16.08, towerZ + 2.85], 24, Math.PI / 2);
  model.cylinder("shadow", 0.73, 0.73, 0.105, [0, 16.08, towerZ + 2.96], 24, Math.PI / 2);
  model.cylinder("glass", 0.55, 0.55, 0.09, [0, 16.08, towerZ + 3.02], 20, Math.PI / 2);
  for (const x of [-1.58, 1.58]) model.arch("shadow", "trim", 0.53, 1.48, 0.095, [x, 15.4, towerZ + 2.85]);
  for (const [w, h, y] of [[6.04, 0.23, 13.34], [6.09, 0.38, 17.16], [6.11, 0.36, 23.1], [6.62, 0.27, 23.62], [6.97, 0.22, 23.89]]) {
    model.box("trim", w, h, w, [0, y, towerZ]);
  }
  for (let x = -2.9; x <= 2.94; x += 0.29) {
    model.box("stone", 0.075, 0.23, 0.16, [x, 23.63, towerZ + 3.33]);
    model.box("stone", 0.16, 0.23, 0.075, [3.33, 23.63, towerZ + x]);
    model.box("stone", 0.16, 0.23, 0.075, [-3.33, 23.63, towerZ + x]);
  }

  // The clock sits in the base of the tall tapered spire, above the paired bell openings.
  model.box("wall", 4.42, 3.14, 4.39, [0, 25.55, towerZ]);
  model.gable("trim", 3.43, 0.68, 0.28, [0, 26.45, towerZ + 2.19]);
  clock(model, 0, 25.48, towerZ + 2.25, 0.71);
  for (const x of [-2.63, 2.63]) {
    for (const z of [towerZ - 2.63, towerZ + 2.63]) lurenLantern(model, x, 24.06, z, 1.13);
  }
  model.lathe("wall", [[2.72, 0], [2.61, 0.28], [2.14, 1.42], [1.77, 3.16], [1.47, 5.19], [1.11, 7.51], [0.82, 8.68], [0.79, 9.13]], [0, 26.95, towerZ], 8);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const [vx, vz] = [Math.sin(yaw), Math.cos(yaw)];
    model.arch("shadow", "trim", 0.52, 1.55, 0.1, [vx * 2.09, 27.32, towerZ + vz * 2.09], yaw);
    model.arch("shadow", "trim", 0.43, 1.6, 0.095, [vx * 1.31, 30.89, towerZ + vz * 1.31], yaw);
  }
  lurenLantern(model, 0, 36.05, towerZ, 1.08);
  model.cross("metal", 0.98, 1.59, [0, 38.53, towerZ]);
  // The front and the nave are slightly offset from the centre of the mapped footprint.
  return model.finish("luren", Math.atan2(-0.273, -0.962), 2.25);
}

function lurenLantern(model: Architecture, x: number, y: number, z: number, scale: number) {
  const profile: readonly Point[] = [[0.67, 0], [0.67, 0.2], [0.53, 0.36], [0.51, 1.53], [0.63, 1.63], [0.61, 1.77], [0.48, 2.01], [0.23, 2.28], [0.16, 2.42], [0.04, 2.52], [0, 2.52]];
  model.lathe("trim", profile.map(([radius, height]) => [radius * scale, height * scale]), [x, y, z], 12);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const [dx, dz] = [Math.sin(angle) * scale, Math.cos(angle) * scale];
    model.arch("shadow", "stone", 0.29 * scale, 1.03 * scale, 0.036 * scale, [x + dx * 0.493, y + 0.47 * scale, z + dz * 0.493], angle);
  }
}

function facadePanel(model: Architecture, material: Material, x: number, y: number, z: number, width: number, height: number, stroke: number) {
  for (const side of [-1, 1]) {
    model.box(material, stroke, height, stroke, [x + side * width * 0.5, y, z]);
    model.box(material, width, stroke, stroke, [x, y + side * height * 0.5, z]);
  }
}

function facadeBand(model: Architecture, x: number, y: number, z: number, width: number, depth: number) {
  model.box("trim", width, 0.19, depth, [x, y + 0.11, z]);
  model.box("stone", width * 0.98, 0.29, depth * 0.71, [x, y - 0.11, z]);
  for (let offset = -width * 0.45; offset < width * 0.47; offset += 0.29) {
    model.box("trim", 0.065, 0.18, 0.065, [x + offset, y - 0.1, z + depth * 0.36]);
  }
}

function stainedWindow(model: Architecture, x: number, y: number, z: number, width: number, height: number, panels: number) {
  model.arch("shadow", "trim", width, height, 0.15, [x, y, z]);
  model.archFrame("stone", width + 0.28, height + 0.17, 0.081, [x, y - 0.038, z + 0.013]);
  const panelWidth = width / (panels + 0.6);
  for (let i = 0; i < panels; i++) {
    const center = x + panelWidth * (i + 0.5 - panels / 2);
    const rise = height - (panels > 1 && (i === 0 || i === panels - 1) ? 0.63 : 0.47);
    model.arch("glass", "stone", panelWidth * 0.83, rise, 0.033, [center, y + 0.08, z + 0.064]);
    for (let offset = 0.44; offset < rise - 0.35; offset += 0.47) {
      model.polygon("amber", [[0, -0.163], [panelWidth * 0.24, 0], [0, 0.163], [-panelWidth * 0.24, 0]], 0.021, [center, y + offset, z + 0.098]);
    }
  }
  model.box("trim", width + 0.4, 0.15, 0.24, [x, y, z + 0.04]);
}

export function createIcaArchitecture(id: LandmarkId): THREE.Group | null {
  switch (id) {
    case "catedral": return cathedral();
    case "luren": return luren();
    case "museo": return createIcaMuseum();
    default: return null;
  }
}
