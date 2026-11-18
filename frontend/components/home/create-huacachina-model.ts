import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityPoint, CitySceneData } from "@/lib/city-scene";

const shorelineId = "way/148131510";
const halfWidth = 225;
const halfDepth = 174;
const widthSegments = 100;
const depthSegments = 80;

const palette = {
  pool: "#607d56", ripple: "#7b9670", walk: "#bfaa8a", side: "#c29b62",
  stucco: "#e8d2b1", white: "#f1e4c9", adobe: "#c29469",
  roof: "#a77b62", terrace: "#c6b592", shadow: "#5a6255",
  bark: "#8b6e49", grass: "#6b6d40", leaf: "#49603b", leafLight: "#73834a", leafDark: "#3c5837",
};
type Surface = keyof typeof palette;

function shoreDistance(x: number, z: number, ring: readonly CityPoint[]) {
  let inside = false;
  let closestSquared = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax, dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared === 0) continue;
    const s = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSquared, 0, 1);
    const qx = x - (ax + s * dx), qz = z - (az + s * dz);
    closestSquared = Math.min(closestSquared, qx * qx + qz * qz);
    if ((az > z) !== (bz > z) && x < ax + (z - az) * dx / dz) inside = !inside;
  }
  return Math.sqrt(closestSquared) * (inside ? -1 : 1);
}

function profile(x: number, z: number, cx: number, cz: number, width: number, depth: number, angle: number) {
  const dx = x - cx, dz = z - cz;
  const u = (dx * Math.cos(angle) + dz * Math.sin(angle)) / width;
  const v = (dz * Math.cos(angle) - dx * Math.sin(angle)) / depth;
  return Math.exp(-(u * u + v * v));
}

function groundHeight(x: number, z: number, shore: number) {
  const shoreBank = THREE.MathUtils.lerp(-1.7, 0.59, THREE.MathUtils.smoothstep(shore, -7, 7));
  const lee = 68 * profile(x, z, -85, -124, 127, 46, -0.24);
  const windward = 53 * profile(x, z, -179, -33, 95, 43, -1.08);
  const crescent = 34 * profile(x, z, 61, -149, 119, 50, 0.18);
  const southernDunes = 49 * profile(x, z, -114, 136, 140, 42, 0.14);
  const lowDunes = 25 * profile(x, z, 106, 146, 123, 50, -0.18);
  const ridges = Math.max(lee, windward, crescent, southernDunes, lowDunes);
  const buffer = THREE.MathUtils.smoothstep(shore, 19, 78);
  const relief = (Math.sin(x * 0.067 + z * 0.034) + Math.cos(z * 0.107 - x * 0.017)) * 1.1;
  return shoreBank + buffer * (ridges + relief);
}

function terrainGeometry(ring: readonly CityPoint[]) {
  const terrain = new THREE.PlaneGeometry(halfWidth * 2, halfDepth * 2, widthSegments, depthSegments).rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position;
  const colors: number[] = [];
  const damp = new THREE.Color("#8a8a55"), sand = new THREE.Color("#d6b278");
  const crest = new THREE.Color("#efcb8d"), shade = new THREE.Color("#bc8e58");
  const tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const distance = shoreDistance(x, z, ring), y = groundHeight(x, z, distance);
    positions.setY(i, y);
    const wind = Math.sin(z * 0.19 + x * 0.028 + Math.sin(x * 0.07)) * 0.055;
    tint.copy(sand).lerp(crest, THREE.MathUtils.smoothstep(y + wind * 20, 8, 65) * 0.8)
      .lerp(shade, Math.max(0, wind) * 2.4)
      .lerp(damp, (1 - THREE.MathUtils.smoothstep(distance, -0.1, 10)) * 0.82);
    colors.push(tint.r, tint.g, tint.b);
  }
  terrain.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  return terrain;
}

function terrainSides(height: (x: number, z: number) => number) {
  const positions: number[] = [];
  const corners = [
    [-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth],
  ];
  const bottom = -3.2;
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length];
    const segments = i % 2 ? depthSegments : widthSegments;
    for (let step = 0; step < segments; step++) {
      const first = step / segments, second = (step + 1) / segments;
      const x = THREE.MathUtils.lerp(ax, bx, first), z = THREE.MathUtils.lerp(az, bz, first);
      const xx = THREE.MathUtils.lerp(ax, bx, second), zz = THREE.MathUtils.lerp(az, bz, second);
      const top = height(x, z), nextTop = height(xx, zz);
      positions.push(x, bottom, z, x, top, z, xx, nextTop, zz, x, bottom, z, xx, nextTop, zz, xx, bottom, zz);
    }
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  sides.computeVertexNormals();
  return sides;
}

function palmFrond(length: number, width: number, curve: number) {
  const positions: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i / 9, b = (i + 1) / 9;
    const outer = (t: number) => Math.sin(Math.PI * t) ** 0.8 * width;
    const droop = (t: number) => Math.sin(t * Math.PI) * curve - t * t * length * 0.37;
    const left = [a * length, droop(a) - outer(a) * 0.3, outer(a)];
    const vein = [a * length, droop(a), 0];
    const right = [a * length, droop(a) - outer(a) * 0.3, -outer(a)];
    const nextLeft = [b * length, droop(b) - outer(b) * 0.3, outer(b)];
    const nextVein = [b * length, droop(b), 0];
    const nextRight = [b * length, droop(b) - outer(b) * 0.3, -outer(b)];
    positions.push(...left, ...vein, ...nextLeft, ...vein, ...nextVein, ...nextLeft,
      ...vein, ...right, ...nextVein, ...right, ...nextRight, ...nextVein);
  }
  const frond = new THREE.BufferGeometry();
  frond.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  frond.computeVertexNormals();
  return frond;
}

/** Exact mapped shoreline with a terrain and settlement model interpreted from ground and aerial photos. */
export function createHuacachinaModel(data: CitySceneData, anchor: Pick<THREE.Vector3, "x" | "z">): THREE.Group {
  const root = new THREE.Group();
  root.name = "Oasis de Huacachina";
  root.userData = {
    units: "metres",
    landmarkId: "huacachina",
    frontYaw: 0.18,
    shorelineSource: shorelineId,
    reference: "MINCETUR 237 y Vista panorámica de la laguna Huacachina (Hee.nanda, CC0)",
  };
  const footprint = data.footprints.find(item => item.osmId === shorelineId && item.kind === "water");
  if (!footprint || footprint.ring.length < 4) return root;

  const local = ([x, z]: CityPoint): CityPoint => [(x - anchor.x) * data.metersPerUnit, (z - anchor.z) * data.metersPerUnit];
  const [firstX, firstZ] = footprint.ring[0];
  const [lastX, lastZ] = footprint.ring[footprint.ring.length - 1];
  const boundary = firstX === lastX && firstZ === lastZ ? footprint.ring.slice(0, -1) : footprint.ring;
  const ring = boundary.map(local);
  const groundLevel = (x: number, z: number) => groundHeight(x, z, shoreDistance(x, z, ring));
  const batch = new Map<string, Map<Surface, THREE.BufferGeometry[]>>();
  let part = "Laguna";

  function identify(mesh: THREE.Mesh) {
    mesh.userData.landmarkId = "huacachina";
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
  function add(geometry: THREE.BufferGeometry, paint: Surface, x: number, y: number, z: number, yaw = 0) {
    geometry.rotateY(yaw);
    geometry.translate(x, y, z);
    geometry.deleteAttribute("uv");
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const surfaces = batch.get(part) ?? new Map<Surface, THREE.BufferGeometry[]>();
    const pieces = surfaces.get(paint) ?? [];
    pieces.push(flat);
    surfaces.set(paint, pieces);
    batch.set(part, surfaces);
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, paint: Surface, yaw = 0) =>
    add(new THREE.BoxGeometry(w, h, d), paint, x, y, z, yaw);
  const terrain = terrainGeometry(ring);
  const sand = identify(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, name: "Arena y dunas",
  })));
  sand.name = "Dunas de Huacachina";
  root.add(sand);

  part = "Corte del terreno";
  add(terrainSides(groundLevel), "side", 0, 0, 0);
  box(halfWidth * 2, 0.17, halfDepth * 2, 0, -3.2, 0, "side");

  part = "Laguna";
  const water = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  add(new THREE.ShapeGeometry(water).rotateX(-Math.PI / 2), "pool", 0, 0.08, 0);
  for (let row = -11; row <= 10; row++) {
    for (let col = -11; col <= 11; col++) {
      const x = col * 8.15 + Math.sin(row * 4.3 + col * 3) * 3;
      const z = row * 4.55 + Math.cos(row * 2.3 - col * 1.84) * 2;
      if (shoreDistance(x, z, ring) > -7 || (row * 11 + col * 7) % 4 === 0) continue;
      const width = 1.75 + Math.abs(Math.sin(row * 8.2 + col)) * 4.1;
      box(width, 0.013, 0.20, x, 0.10, z, "ripple", Math.cos(row * 0.75 + col * 0.32) * 0.11);
    }
  }

  part = "Entorno";
  // Only nearby OSM road segments remain on the cutout.
  for (const road of data.roads) {
    const points = road.map(local);
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const length = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(length / 3);
      for (let step = 0; step < steps; step++) {
        const progress = (step + 0.5) / steps;
        const x = THREE.MathUtils.lerp(ax, bx, progress), z = THREE.MathUtils.lerp(az, bz, progress);
        if (x < -145 || x > 194 || Math.abs(z) > 115) continue;
        const distance = shoreDistance(x, z, ring);
        if (distance < 4 || distance > (x > 100 ? 96 : 48)) continue;
        box(length / steps + 0.16, 0.09, x > 100 ? 4.1 : 2.7, x, groundHeight(x, z, distance) + 0.11,
          z, "walk", -Math.atan2(bz - az, bx - ax));
      }
    }
  }

  part = "Edificios del oasis";
  // Low-rise volumes along the visible shore are photo-referenced, with approximate dimensions.
  const hotels = [
    [-106, -64, 16, 15, 5.1, 0.02], [-88, -69, 15, 12, 6.4, -0.02],
    [-70, -72, 13, 15, 4.6, 0.04], [-55, -72, 13, 17, 6.8, -0.02],
    [-39, -72, 15, 12, 7.6, -0.04], [-23, -70, 12, 13, 5.7, -0.03],
    [-8, -67, 13, 12, 8.4, -0.07], [8, -67, 16, 13, 7.1, -0.02],
    [25, -65, 14, 12, 7.7, -0.07], [42, -63, 18, 13, 5.6, 0.0],
    [61, -61, 16, 12, 6.9, -0.04], [79, -60, 16, 16, 5.8, -0.02],
    [97, -55, 18, 13, 5.8, -0.24], [112, -41, 9, 18, 7.9, 0.33],
    [118, -23, 12, 15, 5.7, 0.13], [119, -5, 16, 12, 8.1, 0.11],
    [116, 15, 16, 13, 6.7, -0.11], [108, 32, 14, 14, 7.1, -0.17],
    [91, 40, 14, 10, 5.3, 0.12], [75, 41, 11, 14, 7.4, -0.07],
    [60, 43, 16, 13, 7.8, -0.14], [42, 48, 14, 12, 4.9, -0.17],
    [26, 55, 13, 12, 5.3, -0.46], [12, 64, 12, 11, 6.9, -0.29],
    [-1, 76, 15, 12, 5.4, -0.58], [-18, 76, 15, 14, 5.2, -0.17],
    [-36, 77, 15, 13, 6.7, -0.16], [-55, 73, 15, 12, 4.9, -0.36],
    [133, 50, 11, 17, 5.5, 0.25], [145, 46, 10, 11, 5.3, -0.05],
    [124, 70, 13, 13, 5.5, 0.26], [135, 83, 13, 12, 6.8, 0.2],
  ];
  for (const [i, [x, z, width, depth, h, yaw]] of hotels.entries()) {
    const y = groundLevel(x, z) - 0.12;
    const paint = i % 5 === 2 ? "adobe" : i % 3 ? "white" : "stucco";
    const at = (u: number, v: number): CityPoint =>
      [x + u * Math.cos(yaw) + v * Math.sin(yaw), z - u * Math.sin(yaw) + v * Math.cos(yaw)];
    box(width, h, depth, x, y + h / 2, z, paint, yaw);
    box(width + 0.48, 0.36, depth + 0.48, x, y + h, z, i % 4 ? "terrace" : "roof", yaw);
    for (const side of [-1, 1]) {
      let [rx, rz] = at(0, side * depth / 2);
      box(width, 0.6, 0.29, rx, y + h + 0.31, rz, paint, yaw);
      [rx, rz] = at(side * width / 2, 0);
      box(0.29, 0.6, depth, rx, y + h + 0.31, rz, paint, yaw);
    }
    const bays = Math.floor(width / 2.55);
    for (let n = 0; n < bays; n++) {
      const u = (n + 0.5) * width / bays - width / 2;
      for (const side of [-1, 1]) {
        const [wx, wz] = at(u, side * (depth / 2 + 0.04));
        box(1.0, 0.86, 0.12, wx, y + h * 0.66, wz, "shadow", yaw);
        if (h > 5.75) box(0.85, 1.08, 0.12, wx, y + h * 0.32, wz, "shadow", yaw);
      }
    }
  }

  part = "Palmeras y vegetación";
  const palms: CityPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const length = Math.hypot(bx - ax, bz - az);
    const count = Math.ceil(length / 8.2);
    for (let j = 0; j < count; j++) {
      const t = j / count, offset = 3.5 + Math.sin(i * 4.47 + j * 2.1) * 1.8;
      const x = THREE.MathUtils.lerp(ax, bx, t) + (bz - az) * offset / length;
      const z = THREE.MathUtils.lerp(az, bz, t) - (bx - ax) * offset / length;
      if (shoreDistance(x, z, ring) <= 0 || (i * 5 + j * 3) % 5 === 3) continue;
      palms.push([x, z]);
    }
  }
  for (const [i, [x, z]] of palms.entries()) {
    const y = groundLevel(x, z);
    if (i % 4 === 0) {
      for (let n = 0; n < 5; n++) {
        const angle = n * 2.4 + i * 0.74;
        const crown = new THREE.IcosahedronGeometry(1.65 + n % 3 * 0.56, 1).scale(1.25, 0.89, 1);
        add(crown, n % 3 ? "grass" : "leaf", x + Math.cos(angle) * 1.18,
          y + 1.68 + n % 3 * 0.38, z + Math.sin(angle) * 1.2);
      }
      continue;
    }
    const height = 6.5 + Math.abs(Math.sin(i * 4.43)) * 6.5;
    const lean = Math.sin(i * 3.83) * 1.25;
    const trunk = new THREE.CylinderGeometry(0.19, 0.31, height, 7).rotateZ(-Math.atan(lean / height));
    add(trunk, "bark", x + lean * 0.5, y + height * 0.5, z);
    for (let blade = 0; blade < 10; blade++) {
      const r = 2.7 + 0.71 * Math.cos(i * 8.1 + blade * 3.34);
      const frond = palmFrond(r, 0.53, 0.75 + (blade % 3) * 0.15);
      const angle = blade * (Math.PI * 2 / 10) + i * 1.18;
      add(frond, blade % 4 === 0 ? "leafLight" : blade % 4 === 1 ? "leafDark" : "leaf",
        x + lean, y + height * 0.985 + (blade % 3) * 0.19, z, angle);
    }
  }

  const materials = new Map<Surface, THREE.MeshStandardMaterial>();
  for (const [name, surfaces] of batch) {
    const group = new THREE.Group();
    group.name = name;
    root.add(group);
    for (const [paint, pieces] of surfaces) {
      const material = materials.get(paint) ?? new THREE.MeshStandardMaterial({
        color: palette[paint], name: paint,
        roughness: paint === "pool" ? 0.42 : 0.88,
        side: paint.startsWith("leaf") ? THREE.DoubleSide : THREE.FrontSide,
      });
      materials.set(paint, material);
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose());
      if (!geometry) throw new Error("No se pudo construir una superficie de Huacachina");
      const mesh = identify(new THREE.Mesh(geometry, material));
      mesh.name = paint;
      mesh.castShadow = paint !== "pool" && paint !== "ripple" && paint !== "walk";
      group.add(mesh);
    }
  }
  return root;
}
