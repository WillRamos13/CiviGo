import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const plazaYaw = 18 * Math.PI / 180;
const palette = {
  foundation: "#71635a", road: "#666763", marking: "#f4e8cd", curb: "#cdac54",
  paver: "#cdbdb4", paverLight: "#d5c9bd", paverPink: "#baa099", limestone: "#d9ccac",
  trellis: "#e8e1d0", water: "#4b9699", tile: "#247381", bronze: "#7b5138",
  lawn: "#5f753d", soil: "#57583b", edge: "#48603b",
  bark: "#817363", leafShade: "#365438", leaf: "#4b6740", leafTip: "#637947",
  yellow: "#d9ad55", cream: "#ead3a5", white: "#f1e6d4", roof: "#aa8c72",
  doorway: "#55443f", glazing: "#515751", red: "#be343d", iron: "#3d4543",
};
type Paint = keyof typeof palette;

function basinSector(innerRadius: number, outerRadius: number, halfAngle: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, -halfAngle, halfAngle, false);
  shape.absarc(0, 0, innerRadius, halfAngle, -halfAngle, true);
  shape.closePath();
  return shape;
}

/** Procedural scale model in metres. Architecture and surfaces are estimated from photographs. */
export function createPlazaModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Plaza de Armas de Ica";
  root.userData = {
    landmarkId: "plaza",
    units: "metres",
    frontYaw: plazaYaw - 0.52,
    reference: "MINCETUR 11631, fotografías de la Plaza de Armas de Ica y contorno OSM 630762068",
  };
  const parts = new Map<string, THREE.Group>();
  const paints = new Map<Paint, THREE.MeshStandardMaterial>();
  const batches = new Map<THREE.Group, Map<Paint, THREE.BufferGeometry[]>>();
  const orient = new THREE.Matrix4().makeRotationY(plazaYaw);
  let part = "Entorno";
  let place = orient;

  function add(geometry: THREE.BufferGeometry, paint: Paint, x: number, y: number, z: number, yaw = 0) {
    const matrix = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    geometry.applyMatrix4(matrix.premultiply(place));
    geometry.deleteAttribute("uv");
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const group = parts.get(part) ?? new THREE.Group();
    if (!parts.has(part)) {
      group.name = part;
      parts.set(part, group);
      root.add(group);
    }
    const surfaces = batches.get(group) ?? new Map<Paint, THREE.BufferGeometry[]>();
    const pieces = surfaces.get(paint) ?? [];
    pieces.push(flat);
    surfaces.set(paint, pieces);
    batches.set(group, surfaces);
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, paint: Paint, yaw = 0) =>
    add(new THREE.BoxGeometry(w, h, d), paint, x, y, z, yaw);
  const column = (bottom: number, top: number, h: number, x: number, y: number, z: number, paint: Paint, sides = 12) =>
    add(new THREE.CylinderGeometry(top, bottom, h, sides), paint, x, y, z);
  const ground = (shape: THREE.Shape, x: number, y: number, z: number, paint: Paint, yaw = 0) =>
    add(new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2), paint, x, y, z, yaw);
  const arch = (w: number, h: number) => {
    const radius = w / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-radius, 0);
    shape.lineTo(radius, 0);
    shape.lineTo(radius, h - radius);
    shape.absarc(0, h - radius, radius, 0, Math.PI, false);
    shape.closePath();
    return shape;
  };

  box(113, 1.6, 111, 0, -0.83, 0, "foundation");
  box(113, 0.14, 111, 0, 0.015, 0, "paver");
  for (const sign of [-1, 1]) {
    box(8.1, 0.08, 83, sign * 37.2, 0.09, 0, "road");
    box(83, 0.08, 8.1, 0, 0.09, sign * 37.2, "road");
    box(0.24, 0.18, 65, sign * 33.1, 0.18, 0, "curb");
    box(65, 0.18, 0.24, 0, 0.18, sign * 33.1, "curb");
    for (const side of [-1, 1]) {
      for (let stripe = -2; stripe <= 2; stripe++) {
        box(6.9, 0.015, 0.37, sign * 37.2, 0.14, side * 30.4 + stripe * 0.7, "marking");
        box(0.37, 0.015, 6.9, side * 30.4 + stripe * 0.7, 0.14, sign * 37.2, "marking");
      }
    }
  }

  part = "Pavimento y jardines";
  box(66.4, 0.24, 65.5, 0, 0.19, 0, "paver");
  // Muted interlocking paving appears on the promenade and across the wide pedestrian axes.
  for (let row = -24; row <= 24; row++) {
    const z = row * 1.29;
    for (let col = -24; col <= 24; col++) {
      const x = col * 1.31 + (row % 2) * 0.65;
      const outer = Math.abs(x) > 27.2 || Math.abs(z) > 27;
      const path = Math.abs(Math.abs(x) - Math.abs(z)) < 4.25;
      if ((!outer && !path && Math.hypot(x, z) > 10.1) || (col * 7 + row * 3) % 5 === 0) continue;
      column(0.68, 0.68, 0.012, x, 0.32, z, (row + col) % 4 ? "paverLight" : "paverPink", 6);
    }
  }
  const bed = new THREE.Shape();
  bed.moveTo(10.3, 0);
  bed.quadraticCurveTo(10.7, 3.15, 12.9, 6.6);
  bed.lineTo(25, 21.1);
  bed.quadraticCurveTo(27, 23.4, 27, 19.9);
  bed.lineTo(27, -19.9);
  bed.quadraticCurveTo(27, -23.4, 25, -21.1);
  bed.lineTo(12.9, -6.6);
  bed.quadraticCurveTo(10.7, -3.15, 10.3, 0);
  const lawnCenter = new THREE.Vector2(20, 0);
  const lawn = new THREE.Shape(bed.getPoints(5).map(point =>
    point.sub(lawnCenter).multiplyScalar(0.966).add(lawnCenter)));
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2;
    ground(bed, 0, 0.34, 0, "soil", angle);
    ground(lawn, 0, 0.35, 0, "lawn", angle);
  }

  part = "Obelisco de dos agujas";
  column(2.45, 2.45, 0.32, 0, 0.48, 0, "limestone", 32);
  column(1.94, 1.94, 0.29, 0, 0.78, 0, "limestone", 24);
  for (const [x, z, height] of [[-0.48, -0.26, 13.6], [0.62, 0.28, 11.8]]) {
    const shaft = new THREE.CylinderGeometry(0.49, 0.72, height, 4).rotateY(Math.PI / 4);
    add(shaft, "limestone", x, 0.92 + height / 2, z);
    for (let y = 2; y < height - 1; y += 1.6) {
      const width = 1 - 0.34 * y / height;
      box(width, 0.034, width, x, y, z, "paver");
    }
  }

  part = "Piletas";
  root.userData.basinCount = 7;
  column(3.65, 3.65, 0.27, 0, 0.47, 0, "tile", 48);
  column(3.37, 3.37, 0.08, 0, 0.56, 0, "water", 48);
  const rim = new THREE.TorusGeometry(3.55, 0.13, 6, 48).rotateX(-Math.PI / 2);
  add(rim, "limestone", 0, 0.65, 0);
  for (let segment = 0; segment < 6; segment++) {
    const angle = segment * Math.PI / 3 + Math.PI / 2;
    ground(basinSector(4.16, 8.68, 0.43), 0, 0.57, 0, "limestone", angle);
    ground(basinSector(4.42, 8.41, 0.407), 0, 0.585, 0, "tile", angle);
    ground(basinSector(4.5, 8.31, 0.4), 0, 0.60, 0, "water", angle);
    for (const radius of [4.16, 8.67]) {
      const outline = Array.from({ length: 11 }, (_, point) => {
        const theta = -0.43 + point * 0.086;
        return new THREE.Vector3(Math.cos(theta) * radius, 0.53, -Math.sin(theta) * radius);
      });
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline), 10, 0.08, 4), "limestone", 0, 0, 0, angle);
    }
  }
  for (const [x, z, h, paint] of [[-3.15, -2.7, 7.4, "red"], [3.15, -2.7, 7.2, "white"]] as const) {
    column(0.055, 0.055, h, x, 0.4 + h / 2, z, "white", 6);
    const fabric = new THREE.PlaneGeometry(1.5, 0.9, 6, 2);
    const positions = fabric.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, Math.sin(positions.getX(i) * 5) * 0.14);
    fabric.computeVertexNormals();
    add(fabric, paint, x + 0.75, h - 0.4, z);
  }

  part = "Ficus y mobiliario";
  const trees = [-25.1, -18.6, -11.8, 11.8, 18.6, 25.1];
  for (const side of [-1, 1]) {
    for (const [i, value] of trees.entries()) {
      for (const [x, z, variation] of [[value, side * 25.5, i], [side * 25, value, i + 4]]) {
        if (Math.abs(x) > 24.9 && Math.abs(z) > 24.9 && variation >= 4) continue;
        const h = 8.2 + (variation % 4) * 0.66;
        column(0.49, 0.37, h * 0.77, x, 0.35 + h * 0.385, z, "bark", 7);
        for (let n = 0; n < 6; n++) {
          const theta = n * 1.49 + variation * 0.6;
          const r = 1.48 + n % 3 * 0.33;
          const canopy = new THREE.IcosahedronGeometry(2.15 + n % 3 * 0.32, 2).scale(1.12, 0.68, 1);
          add(canopy, n % 4 === 0 ? "leafTip" : n % 4 === 1 ? "leafShade" : "leaf",
            x + Math.cos(theta) * r, h + Math.sin(n * 2.4) * 1.15, z + Math.sin(theta) * r, theta);
        }
      }
      box(2, 0.12, 0.46, value, 0.84, side * 24.3, "bronze");
      box(2, 0.39, 0.075, value, 1.11, side * 24.55, "bronze");
      for (const leg of [-0.72, 0.72]) box(0.085, 0.47, 0.5, value + leg, 0.57, side * 24.3, "iron");
    }
    for (const offset of [-20, -7.5, 7.5, 20]) {
      column(0.08, 0.05, 3.5, offset, 2.08, side * 29.1, "iron", 6);
      const cap = new THREE.IcosahedronGeometry(0.25, 0).scale(1, 1.3, 1);
      add(cap, "white", offset, 3.95, side * 29.1);
    }
  }

  part = "Pérgola";
  for (const trellisX of [-29.7, 29.7]) {
    box(3.55, 0.12, 35, trellisX, 0.38, 0, "limestone");
    for (let z = -16; z <= 16; z += 4) {
      for (const x of [-1.32, 1.32]) {
        column(0.15, 0.12, 2.8, trellisX + x, 1.81, z, "trellis");
        box(0.57, 0.13, 0.38, trellisX + x, 3.22, z, "trellis");
      }
      box(3.4, 0.15, 0.17, trellisX, 3.29, z, "trellis");
    }
    for (let x = -1.28; x < 1.55; x += 0.42) {
      box(0.17, 0.18, 34.7, trellisX + x, 3.4, 0, "trellis");
    }
    for (let z = -16.6; z <= 16.6; z += 0.53) box(3.37, 0.11, 0.12, trellisX, 3.54, z, "trellis");
  }

  function facade(x: number, z: number, yaw: number, bays: number, paint: Paint) {
    place = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z).premultiply(orient);
    const span = bays * 4.5;
    box(span, 5.5, 8.5, 0, 6.62, -4.35, paint);
    box(span, 3.9, 0.35, 0, 2.03, -2.7, "cream");
    box(span + 0.42, 0.35, 8.5, 0, 9.54, -4.35, "white");
    box(span, 0.68, 0.35, 0, 9.96, -0.14, paint);
    box(span, 0.27, 8.1, 0, 9.48, -4.42, "roof");
    box(span, 0.29, 0.42, 0, 4.2, -0.06, "white");
    for (let i = 0; i < bays; i++) {
      const px = i * 4.5 - span / 2 + 2.25;
      const panel = new THREE.Shape();
      panel.moveTo(-2.25, 0);
      panel.lineTo(2.25, 0);
      panel.lineTo(2.25, 3.85);
      panel.lineTo(-2.25, 3.85);
      panel.closePath();
      // The arches draw depth from a recessed colonnade instead of solid black decals.
      const opening = arch(3.15, 3.41);
      const outline = opening.getPoints(8).map(point => point.add(new THREE.Vector2(0, 0.035)));
      panel.holes.push(new THREE.Path(outline));
      add(new THREE.ExtrudeGeometry(panel, { depth: 0.39, steps: 1, bevelEnabled: false, curveSegments: 8 }),
        paint, px, 0.14, -0.44);
      add(new THREE.ShapeGeometry(arch(1.05, 2.55), 8), "doorway", px, 0.16, -2.5);
      box(1.49, 2.69, 0.24, px, 6.61, -0.025, "white");
      box(1.13, 2.27, 0.26, px, 6.61, 0.085, "glazing");
      box(0.09, 2.22, 0.16, px, 6.61, 0.28, "bronze");
      box(2.03, 0.16, 0.53, px, 5.45, 0.14, "white");
    }
    place = orient;
  }
  part = "Portales y fachadas";
  facade(0, -44.6, 0, 14, "yellow");
  facade(44.6, 0, -Math.PI / 2, 12, "cream");

  for (const [group, surfaces] of batches) {
    for (const [paint, pieces] of surfaces) {
      const material = paints.get(paint) ?? new THREE.MeshStandardMaterial({
        name: paint,
        color: palette[paint],
        roughness: paint === "water" ? 0.28 : 0.87,
        metalness: paint === "iron" ? 0.36 : 0,
        side: paint === "red" || paint === "white" ? THREE.DoubleSide : THREE.FrontSide,
      });
      paints.set(paint, material);
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose());
      if (!geometry) throw new Error("No se pudo construir una superficie de la plaza");
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = paint;
      mesh.userData.landmarkId = "plaza";
      mesh.castShadow = paint !== "water" && paint !== "road" && paint !== "marking";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return root;
}
