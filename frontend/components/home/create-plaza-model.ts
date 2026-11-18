import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const plazaYaw = 18 * Math.PI / 180;
// Contorno de OSM 630762068 en metros, en los ejes locales de la plaza.
const plazaBoundary = [
  [-33.49, -31.68], [-33.41, -1.29], [-33.32, 30.85], [-32.68, 31.72],
  [-31.92, 32.72], [-29.8, 34.22], [0.6, 33.86], [31.71, 33.51],
  [33.21, 31.98], [34.04, 30.04], [34.59, 0.39], [35.15, -30.28],
  [34.29, -31.97], [32.17, -33.45], [1.31, -34.17], [-30.43, -34.92], [-32.56, -33.99],
];
const palette = {
  foundation: "#675b52", road: "#525555", marking: "#e8dfcc", curb: "#d1af53",
  paver: "#afaca0", paverLight: "#d8c4a4", paverPink: "#b68877", paverCream: "#e1dac1",
  paverBlue: "#b9c6c2", paverGray: "#968c83", limestone: "#cbb28d", limestoneLight: "#d9c2a0",
  limestoneShade: "#b49b76", trellis: "#ece7db", amber: "#d99a47",
  water: "#5e9294", tile: "#a9c0c2", rim: "#423e38", bronze: "#725747",
  lawn: "#5e7540", soil: "#625b42", bark: "#817568", leafShade: "#344836",
  leaf: "#495f39", leafTip: "#61794a", yellow: "#d8a147", cream: "#e0bd83",
  white: "#f0e2c8", roof: "#aa8c72", doorway: "#494239", glazing: "#484d4d",
  red: "#bc3540", iron: "#414742", stucco: "#b9a88e", slate: "#8a8b80",
};
type Paint = keyof typeof palette;

function basinSector(innerRadius: number, outerRadius: number, halfAngle: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, -halfAngle, halfAngle, false);
  shape.absarc(0, 0, innerRadius, halfAngle, -halfAngle, true);
  shape.closePath();
  return shape;
}

function circle(radius: number) {
  return new THREE.Shape().absarc(0, 0, radius, 0, 2 * Math.PI, false);
}

function closedShape(points: readonly number[][]) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  shape.closePath();
  return shape;
}

function hasPoint(x: number, z: number, points: readonly number[][]): boolean {
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
  }
  return inside;
}

/** Procedural scale model in metres. Architecture and surfaces are estimated from photographs. */
export function createPlazaModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Plaza de Armas de Ica";
  root.userData = {
    landmarkId: "plaza",
    units: "metres",
    frontYaw: plazaYaw - 0.52,
    reference: "MINCETUR 11631, contorno OSM 630762068, fotografías de Pitxiquin y Diario Correo",
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

  const tileSize = 136;
  box(tileSize, 1.6, tileSize, 0, -0.88, 0, "foundation");
  for (const sign of [-1, 1]) {
    box(tileSize, 0.14, 32, 0, 0, sign * 52, "paver");
    box(32, 0.14, 72, sign * 52, 0, 0, "paver");
    box(12.8, 0.08, tileSize, sign * 42.2, 0.085, 0, "road");
    box(tileSize, 0.08, 12.8, 0, 0.08, sign * 42.2, "road");
    for (const along of [-58, -18, 0, 18, 58]) {
      box(0.09, 0.015, 2.25, sign * 42.2, 0.134, along, "marking");
      box(2.25, 0.015, 0.09, along, 0.134, sign * 42.2, "marking");
    }
    for (const side of [-1, 1]) {
      for (let stripe = -3; stripe <= 3; stripe++) {
        box(10.8, 0.015, 0.33, sign * 42.2, 0.14, side * 34.7 + stripe * 0.62, "marking");
        box(0.33, 0.015, 10.8, side * 34.7 + stripe * 0.62, 0.14, sign * 42.2, "marking");
      }
    }
  }
  const edging = (ring: readonly number[][], width: number, height: number, y: number, paint: Paint) => {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.005) continue;
      box(length + width * 0.3, height, width, (ax + bx) / 2, y, (az + bz) / 2, paint, -Math.atan2(bz - az, bx - ax));
    }
  };
  edging(plazaBoundary, 0.19, 0.2, 0.24, "curb");

  part = "Pavimento y jardines";
  const basins = [{ shape: circle(3.7), inner: circle(3.54), angle: 0 }];
  for (let segment = 0; segment < 6; segment++) {
    const outer = segment % 3 === 0 ? 9.7 : 9.45;
    basins.push({
      shape: basinSector(4.18, outer, 0.409),
      inner: basinSector(4.35, outer - 0.15, 0.385),
      angle: segment * Math.PI / 3 + Math.PI / 2,
    });
  }
  const toRing = (shape: THREE.Shape, yaw: number, curves = 8) =>
    shape.getPoints(curves).map(point => {
      point.rotateAround(new THREE.Vector2(), yaw);
      return [point.x, -point.y];
    });
  const basinOutlines = basins.map(({ shape, angle }) => toRing(shape, angle, 12));
  const paving = closedShape(plazaBoundary);
  for (const ring of basinOutlines) paving.holes.push(new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  add(new THREE.ExtrudeGeometry(paving, { depth: 0.35, steps: 1, bevelEnabled: false, curveSegments: 1 })
    .rotateX(-Math.PI / 2), "paver", 0, -0.025, 0);
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
  const gardens = [];
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2;
    gardens.push(toRing(bed, angle, 6));
    ground(bed, 0, 0.34, 0, "soil", angle);
    ground(lawn, 0, 0.35, 0, "lawn", angle);
  }
  const paverPaints: Paint[] = ["paverLight", "paverCream", "paverPink", "paverBlue", "paverGray", "paverCream"];
  const radius = 0.54;
  const tile = new THREE.Shape(Array.from({ length: 6 }, (_, corner) => {
    const angle = Math.PI / 6 + corner * Math.PI / 3;
    return new THREE.Vector2(Math.cos(angle) * radius * 0.97, Math.sin(angle) * radius * 0.97);
  }));
  const tileGeometry = new THREE.ShapeGeometry(tile).rotateX(-Math.PI / 2);
  for (let row = -42; row <= 42; row++) {
    const z = row * radius * 1.5;
    for (let col = -37; col <= 37; col++) {
      const x = (col + (row & 1) / 2) * Math.sqrt(3) * radius;
      if (!hasPoint(x, z, plazaBoundary) || gardens.some(garden => hasPoint(x, z, garden))) continue;
      const nearPool = Math.hypot(x, z) < 10.4;
      if (nearPool && tile.getPoints(1).some(p =>
        basinOutlines.some(ring => hasPoint(x + p.x, z - p.y, ring)))) continue;
      const tint = Math.abs((row * 31 ^ col * 57 ^ row * col * 11) % paverPaints.length);
      add(tileGeometry.clone(), paverPaints[tint], x, 0.335, z);
    }
  }
  tileGeometry.dispose();

  part = "Obelisco de dos agujas";
  const stoneTints: Paint[] = ["limestone", "limestoneShade", "limestone", "limestoneLight"];
  for (const side of [-1, 1]) {
    const height = side < 0 ? 12.45 : 13.02;
    const courses = 18;
    for (let course = 0; course < courses; course++) {
      const lower = course * height / courses;
      const higher = (course + 1) * height / courses - 0.012;
      const ashlar = new THREE.BoxGeometry(1, 1, 1);
      const positions = ashlar.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) < 0 ? lower : higher;
        const width = 1.14 - y / height * 0.56;
        const depth = 0.92 - y / height * 0.27;
        const x = side * 0.115 + side * width / 2 + positions.getX(i) * width;
        positions.setXYZ(i, x, y, positions.getZ(i) * depth);
      }
      ashlar.computeVertexNormals();
      add(ashlar, stoneTints[(course * 7 + (side < 0 ? 4 : 1)) % stoneTints.length], 0, 0.17, 0, Math.PI / 5);
    }
    const plinth = new THREE.CylinderGeometry(0.44, 0.60, 1.22, 4).rotateY(Math.PI / 4);
    add(plinth, "limestoneShade", side * 1.29, 0.59, -side * 0.7, Math.PI / 5);
    const rear = new THREE.CylinderGeometry(0.4, 0.57, 0.98, 4).rotateY(Math.PI / 4);
    add(rear, "limestone", side * 0.46, 0.49, side * 1.13, Math.PI / 5);
  }
  for (const y of [2.06, 8.32]) box(0.35, 0.12, 0.28, 0, y, 0, "rim", Math.PI / 5);

  part = "Piletas";
  root.userData.basinCount = basins.length;
  for (const [i, { shape, inner, angle }] of basins.entries()) {
    ground(shape, 0, 0.018, 0, "tile", angle);
    ground(inner, 0, 0.044, 0, "water", angle);
    const rim = basinOutlines[i];
    edging(rim, 0.13, 0.19, 0.232, "rim");
    edging(rim, 0.057, 0.014, 0.329, "paverGray");
    const radius = i ? 6.9 : 2.45;
    const [x, z] = [Math.cos(angle) * radius, -Math.sin(angle) * radius];
    box(1.18, 0.031, 0.039, x, 0.126, z, "iron", angle);
    for (const offset of [-0.5, 0, 0.5]) {
      const tx = x + Math.cos(angle) * offset, tz = z - Math.sin(angle) * offset;
      column(0.043, 0.032, 0.14, tx, 0.129, tz, "iron", 6);
      column(0.073, 0.067, 0.024, tx, 0.206, tz, "slate", 6);
    }
  }
  for (const [i, [x, z]] of [[-8.1, -8.05], [-6.35, -9.55], [-9.65, -6.27]].entries()) {
    const height = i ? 7.0 : 7.7;
    column(0.32, 0.24, 0.61, x, 0.63, z, "paverGray", 4);
    column(0.055, 0.040, height, x, 0.91 + height / 2, z, "white", 6);
    if (i === 2) continue;
    for (let stripe = 0; stripe < 3; stripe++) {
      const fabric = new THREE.PlaneGeometry(0.45, 0.87, 3, 1);
      const positions = fabric.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        positions.setZ(j, Math.sin((positions.getX(j) + 0.45 * stripe) * 4.4) * 0.14);
      }
      fabric.computeVertexNormals();
      add(fabric, i === 0 && stripe !== 1 ? "red" : "white", x + 0.275 + stripe * 0.45, height + 0.41, z);
    }
  }

  part = "Ficus y mobiliario";
  const up = new THREE.Vector3(0, 1, 0);
  const branch = (start: THREE.Vector3, end: THREE.Vector3, base: number, tip: number, paint: Paint) => {
    const axis = end.clone().sub(start);
    const wood = new THREE.CylinderGeometry(tip, base, axis.length(), 7);
    wood.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
    const center = start.clone().lerp(end, 0.5);
    add(wood, paint, center.x, center.y, center.z);
  };
  const trees = [-25.1, -18.6, -11.8, 11.8, 18.6, 25.1];
  for (const side of [-1, 1]) {
    for (const [i, value] of trees.entries()) {
      for (const [x, z, variation] of [[value, side * 25.5, i], [side * 25, value, i + 4]]) {
        if (Math.abs(x) > 24.9 && Math.abs(z) > 24.9 && variation >= 4) continue;
        const h = 8.3 + (variation % 4) * 0.81;
        const drift = Math.sin(variation * 1.94 + side) * 1.32;
        const fork = new THREE.Vector3(x + drift, h * 0.50, z + drift * 0.45);
        branch(new THREE.Vector3(x, 0.35, z), fork, 0.45, 0.32, "bark");
        column(0.445, 0.39, 0.68, x, 0.65, z, "limestoneLight", 7);
        for (let n = 0; n < 7; n++) {
          const theta = n * 1.57 + variation * 0.64;
          const r = 1.15 + n % 3 * 0.53;
          const y = h + Math.sin(n * 2.4 + variation * 0.81) * 1.4;
          const cx = x + drift + Math.cos(theta) * r, cz = z + Math.sin(theta) * r;
          if (n < 4) branch(fork, new THREE.Vector3(cx, y - 0.42, cz), 0.23, 0.06, "bark");
          const radius = 1.61 + (n * 3 + variation) % 5 * 0.24;
          const canopy = new THREE.IcosahedronGeometry(radius, 2).scale(1.32, 0.76 + n % 3 * 0.12, 1);
          const positions = canopy.attributes.position;
          for (let j = 0; j < positions.count; j++) {
            const [px, py, pz] = [positions.getX(j), positions.getY(j), positions.getZ(j)];
            const gain = 1 + 0.13 * Math.sin(px * 3 + pz * 1.7 + n) * Math.cos(py * 5 + variation);
            positions.setXYZ(j, px * gain, py * gain, pz * gain);
          }
          add(canopy, n % 4 === 0 ? "leafTip" : n % 4 === 1 ? "leafShade" : "leaf",
            cx, y, cz, theta);
        }
      }
      for (let slat = 0; slat < 3; slat++) {
        box(1.84, 0.085, 0.095, value, 0.74, side * 27.64 + (slat - 1) * 0.14, "bronze");
        box(1.84, 0.078, 0.038, value, 0.96 + slat * 0.11, side * 27.88, "bronze");
      }
      for (const leg of [-0.72, 0.72]) {
        box(0.085, 0.49, 0.06, value + leg, 0.57, side * 27.44, "iron");
        box(0.085, 0.85, 0.06, value + leg, 0.79, side * 27.89, "iron");
      }
    }
    for (const offset of [-19, -7.5, 7.5, 19]) {
      const z = side * 30.2;
      column(0.12, 0.07, 4.75, offset, 2.72, z, "iron", 6);
      for (const direction of [-1, 1]) {
        const x = offset + direction * 0.61;
        const start = new THREE.Vector3(offset, 4.71, z);
        const end = new THREE.Vector3(x, 5.1, z);
        branch(start, end, 0.046, 0.037, "iron");
        add(new THREE.IcosahedronGeometry(0.18, 0).scale(1.45, 0.40, 1),
          "white", x, 5.11, z);
      }
    }
  }
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const angle = quadrant * Math.PI / 2;
    for (const [i, [x, z]] of [[15.4, -2.8], [18.6, 9.2], [20.4, -9.7], [24.8, 0.7]].entries()) {
      const px = x * Math.cos(angle) + z * Math.sin(angle), pz = -x * Math.sin(angle) + z * Math.cos(angle);
      const spread = 0.68 + i % 3 * 0.19;
      column(0.16, 0.11, 0.78, px, 0.73, pz, "bark", 6);
      add(new THREE.IcosahedronGeometry(spread, 2).scale(1.03, 0.91, 1), i % 2 ? "leafTip" : "leaf",
        px, 1.3, pz, angle);
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
    for (const beam of [-1.63, 1.63]) box(0.095, 0.115, 34.7, trellisX + beam, 3.54, 0, "amber");
  }

  part = "Portales y fachadas";
  place = new THREE.Matrix4().makeTranslation(0, 0, -54.2).premultiply(orient);
  const facadeSpan = 56;
  box(facadeSpan, 0.12, 3.65, 0, 0.14, -1.53, "paverGray");
  box(facadeSpan, 3.72, 0.35, 0, 2.02, -3.33, "cream");
  box(facadeSpan, 0.34, 0.38, 0, 0.34, -3.17, "rim");
  box(facadeSpan, 5.24, 11.8, 0, 6.39, -5.91, "yellow");
  box(facadeSpan, 0.13, 11.65, 0, 9.07, -5.94, "roof");
  for (const [i, w] of [56.18, 56.36, 56.68].entries()) {
    box(w, 0.13, 0.43 + i * 0.15, 0, 8.98 + i * 0.13, 0.05, "white");
  }
  for (const x of [-27.8, 27.8]) box(0.32, 0.65, 11.78, x, 9.41, -5.93, "yellow");
  box(facadeSpan, 0.50, 0.30, 0, 9.44, -0.18, "yellow");
  for (const x of [-6.25, 6.25]) {
    box(9.2, 0.8, 1.65, x, 9.47, -0.84, "yellow");
    box(9.4, 0.13, 1.82, x, 9.94, -0.78, "white");
    box(7.78, 0.5, 1.58, x, 10.2, -0.86, "yellow");
    box(7.98, 0.147, 1.76, x, 10.52, -0.81, "white");
    for (let n = -3; n <= 3; n++) {
      box(0.19, 0.24, 0.29, x + n * 1.06, 9.79, 0, "white");
    }
  }
  const shield = new THREE.Shape();
  shield.moveTo(-0.36, 0.8);
  shield.lineTo(0.36, 0.8);
  shield.lineTo(0.31, 0.25);
  shield.quadraticCurveTo(0.22, 0.07, 0, 0);
  shield.quadraticCurveTo(-0.22, 0.07, -0.31, 0.25);
  shield.closePath();
  add(new THREE.ExtrudeGeometry(shield, { depth: 0.08, bevelEnabled: false, curveSegments: 6 }),
    "white", 0, 8.49, 0.02);

  const portalBay = 4.3;
  const panel = new THREE.Shape([
    new THREE.Vector2(-portalBay / 2, 0), new THREE.Vector2(portalBay / 2, 0),
    new THREE.Vector2(portalBay / 2, 3.78), new THREE.Vector2(-portalBay / 2, 3.78),
  ]);
  // A solid arch spandrel over the open colonnade, with a separate recessed back wall.
  const entry = arch(3.25, 3.30);
  panel.holes.push(new THREE.Path(entry.getPoints(12).map(point => point.add(new THREE.Vector2(0, 0.022)))));
  const portal = new THREE.ExtrudeGeometry(panel, { depth: 0.42, bevelEnabled: false, curveSegments: 8 });
  for (let i = -6; i <= 6; i++) {
    const x = i * portalBay;
    add(portal.clone(), "yellow", x, 0.2, -0.45);
    const pier = x - portalBay / 2;
    box(1.08, 0.34, 0.63, pier, 0.37, -0.13, "rim");
    box(1.16, 0.13, 0.70, pier, 1.77, -0.13, "white");
    box(1.23, 0.11, 0.77, pier, 1.88, -0.13, "white");
    const centerDoor = i === 0 || i === -4 || i === 4;
    const innerWidth = centerDoor ? 1.52 : 1.29;
    const innerHeight = centerDoor ? 2.7 : 1.96;
    const innerY = centerDoor ? 0.18 : 0.64;
    add(new THREE.ShapeGeometry(arch(innerWidth + 0.26, innerHeight + 0.13), 9), "white", x, innerY, -3.13);
    add(new THREE.ShapeGeometry(arch(innerWidth, innerHeight), 9), "doorway", x, innerY + 0.04, -3.11);
    box(0.061, innerHeight - 0.31, 0.049, x, innerY + (innerHeight - 0.22) / 2, -3.074, "white");
  }
  portal.dispose();
  box(1.08, 0.34, 0.63, 6.5 * portalBay, 0.37, -0.13, "rim");
  box(1.23, 0.14, 0.77, 6.5 * portalBay, 1.84, -0.13, "white");
  box(facadeSpan, 0.13, 0.43, 0, 4.12, -0.015, "cream");
  function balcony(x: number, w: number, railY: number) {
    box(w + 0.22, 0.22, 0.93, x, railY - 0.09, 0.37, "white");
    box(w, 0.09, 0.14, x, railY + 0.63, 0.78, "white");
    const slots = Math.floor(w / 0.27);
    for (let i = 1; i < slots; i++) {
      const sx = x + w * (i / slots - 0.5);
      column(0.064, 0.044, 0.56, sx, railY + 0.32, 0.78, "white", 6);
    }
    for (const edge of [-w / 2 + 0.06, w / 2 - 0.06]) {
      box(0.13, 0.68, 0.7, x + edge, railY + 0.33, 0.44, "white");
    }
    for (let support = -w / 2 + 0.4; support < w / 2 - 0.14; support += 1.08) {
      box(0.24, 0.28, 0.48, x + support, railY - 0.29, 0.2, "white");
    }
  }
  for (const wx of [-3.14, 0, 3.14]) {
    const frame = arch(3.21, 3.36);
    frame.holes.push(new THREE.Path(arch(2.82, 3.12).getPoints(12)
      .map(point => point.add(new THREE.Vector2(0, 0.06)))));
    add(new THREE.ExtrudeGeometry(frame, { depth: 0.14, bevelEnabled: false, curveSegments: 12 }),
      "white", wx, 4.84, 0.015);
    add(new THREE.ShapeGeometry(arch(2.83, 3.15), 12), "glazing", wx, 4.88, 0.023);
    box(0.10, 2.96, 0.075, wx, 6.35, 0.075, "bronze");
    for (const height of [5.47, 6.60]) box(2.84, 0.085, 0.068, wx, height, 0.071, "bronze");
  }
  balcony(0, 10.05, 4.81);
  for (const x of [-24.05, -18.6, -12.2, -7.9, 7.9, 12.2, 18.6, 24.05]) {
    const detailed = Math.abs(x) === 12.2 || Math.abs(x) === 24.05;
    if (detailed) {
      box(2.20, 3.11, 0.15, x, 6.32, 0.015, "white");
      for (const dx of [-1.01, 1.01]) box(0.20, 3.06, 0.2, x + dx, 6.32, 0.095, "cream");
      box(2.53, 0.14, 0.36, x, 7.93, 0.14, "white");
      box(2.22, 0.12, 0.28, x, 7.74, 0.10, "white");
      balcony(x, 2.72, 4.81);
    }
    box(detailed ? 1.59 : 1.35, 2.66, 0.12, x, 6.30, 0.065, "glazing");
    for (const dx of [-0.41, 0, 0.41]) box(0.055, 2.62, 0.07, x + dx, 6.30, 0.12, "bronze");
    box(1.38, 0.083, 0.13, x, 6.62, 0.1, "bronze");
    box(1.68, 0.12, 0.24, x, 4.94, 0.1, "cream");
  }

  place = orient;
  part = "Volúmenes de la manzana";
  // Footprints from the local OSM extract, cropped at the edge of the model.
  const blockFragments: { ring: number[][]; height: number; paint: Paint }[] = [
    { ring: [[-68, -47.23], [-53.66, -46.61], [-54.84, -19.19], [-68, -19.76]], height: 6.4, paint: "stucco" },
    { ring: [[-68, -19.75], [-54.84, -19.19], [-54.34, -6.19], [-68, -5.66]], height: 5.85, paint: "cream" },
    { ring: [[-68, -5.66], [-53.55, -5.93], [-55.39, 16.65], [-68, 16.53]], height: 5.9, paint: "cream" },
    { ring: [[-68, 17.54], [-55.39, 16.65], [-56.59, 43.5], [-68, 43.47]], height: 7.45, paint: "stucco" },
    { ring: [[56.97, -42.22], [56.4, -31.75], [68, -31.11], [68, -41.61]], height: 7.4, paint: "stucco" },
    { ring: [[33.85, 52.55], [43.74, 52.62], [43.64, 68], [24.09, 68], [24.09, 64.83], [33.78, 64.89]], height: 5.2, paint: "cream" },
    { ring: [[-30.29, 68], [-30.37, 62.16], [-25.49, 62.08], [-25.63, 52.39], [-19.72, 52.29], [-19.62, 57.86], [-13.82, 57.76], [-13.9, 52.77], [0.86, 52.52], [1.1, 68]], height: 5.8, paint: "stucco" },
  ];
  for (const { ring, height, paint } of blockFragments) {
    const shape = closedShape(ring);
    add(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2),
      paint, 0, 0.13, 0);
    ground(shape, 0, 0.14 + height, 0, "roof");
    edging(ring, 0.25, 0.39, height + 0.15, paint);
  }

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
