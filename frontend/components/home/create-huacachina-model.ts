import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityPoint, CitySceneData } from "../../lib/city-scene";
import { OASIS_BUILDINGS, OASIS_ELEVATION, OASIS_PATHS, OASIS_TREES } from "./huacachina-geography";

const shorelineId = "way/148131510";
const halfWidth = 225;
const halfDepth = 174;
const widthSegments = 100;
const depthSegments = 80;

const palette = {
  pool: "#ffffff", ripple: "#8d9f78", glint: "#becbb1", walk: "#bca794", road: "#a39685", side: "#b89466",
  stucco: "#e4caa5", white: "#e8e3d7", adobe: "#c18d63", ochre: "#d0ae64",
  roof: "#b48a78", terrace: "#ccc0aa", shadow: "#5b655e", shade: "#a9a482",
  bark: "#7a6448", grass: "#726e42", leaf: "#526346", leafLight: "#758653", leafDark: "#3b5540",
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

function measuredRelief(x: number, z: number) {
  const depth = OASIS_ELEVATION.length - 1;
  const width = OASIS_ELEVATION[0].length - 1;
  const east = THREE.MathUtils.clamp((x + halfWidth) / (2 * halfWidth), 0, 1) * width;
  const south = THREE.MathUtils.clamp((z + halfDepth) / (2 * halfDepth), 0, 1) * depth;
  const loX = Math.min(Math.floor(east), width - 1), loZ = Math.min(Math.floor(south), depth - 1);
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(OASIS_ELEVATION[loZ][loX], OASIS_ELEVATION[loZ][loX + 1], east - loX),
    mix(OASIS_ELEVATION[loZ + 1][loX], OASIS_ELEVATION[loZ + 1][loX + 1], east - loX),
    south - loZ,
  );
}

function groundHeight(x: number, z: number, shore: number) {
  if (shore <= 2.3) return THREE.MathUtils.lerp(-2.1, -0.28, THREE.MathUtils.smoothstep(shore, -9, 2.3));
  const bank = THREE.MathUtils.lerp(-0.28, 0.7, THREE.MathUtils.smoothstep(shore, 2.3, 8));
  const blend = THREE.MathUtils.smoothstep(shore, 6, 28);
  const ripples = (Math.sin(x * 0.067 + z * 0.034) + Math.cos(z * 0.107 - x * 0.017)) * 0.46;
  return THREE.MathUtils.lerp(bank, Math.max(0.3, measuredRelief(x, z)) + ripples, blend);
}

function terrainGeometry(ring: readonly CityPoint[]) {
  const terrain = new THREE.PlaneGeometry(halfWidth * 2, halfDepth * 2, widthSegments, depthSegments).rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position;
  const colors: number[] = [];
  const damp = new THREE.Color("#818364"), sand = new THREE.Color("#cfb594");
  const crest = new THREE.Color("#efcf9e"), shade = new THREE.Color("#b39371");
  const tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const distance = shoreDistance(x, z, ring), y = groundHeight(x, z, distance);
    positions.setY(i, y);
    const wind = Math.sin(z * 0.2 + x * 0.045 + Math.sin(x * 0.061)) * 0.048;
    tint.copy(sand).lerp(crest, THREE.MathUtils.smoothstep(y + wind * 20, 7, 50) * 0.79)
      .lerp(shade, Math.max(0, wind) * 2.15)
      .lerp(damp, (1 - THREE.MathUtils.smoothstep(distance, -0.1, 9)) * 0.75);
    colors.push(tint.r, tint.g, tint.b);
  }
  terrain.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  return terrain;
}

function surfaceFrom(positions: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function lagoonSurface(boundary: THREE.Shape, ring: readonly CityPoint[]) {
  const shape = new THREE.ShapeGeometry(boundary).rotateX(-Math.PI / 2);
  const source = shape.index ? shape.toNonIndexed() : shape;
  const points = source.getAttribute("position");
  const positions: number[] = [], colors: number[] = [];
  const olive = new THREE.Color("#667744"), reflectedSky = new THREE.Color("#8daea0");
  const nearShore = new THREE.Color("#839064"), tint = new THREE.Color();
  const steps = 8;
  for (let first = 0; first < points.count; first += 3) {
    const ax = points.getX(first), az = points.getZ(first);
    const bx = points.getX(first + 1), bz = points.getZ(first + 1);
    const cx = points.getX(first + 2), cz = points.getZ(first + 2);
    const emit = (row: number, column: number) => {
      const u = row / steps, v = column / steps;
      const x = ax + (bx - ax) * u + (cx - ax) * v;
      const z = az + (bz - az) * u + (cz - az) * v;
      const shallows = 1 - THREE.MathUtils.smoothstep(-shoreDistance(x, z, ring), 2.2, 13);
      const reflection = 0.45 * Math.exp(-((z - 0.17 * x + 14) ** 2) / 920);
      tint.copy(olive).lerp(reflectedSky, reflection).lerp(nearShore, shallows * 0.60);
      positions.push(x, 0, z);
      colors.push(tint.r, tint.g, tint.b);
    };
    for (let row = 0; row < steps; row++) {
      for (let column = 0; column < steps - row; column++) {
        emit(row, column); emit(row + 1, column); emit(row, column + 1);
        if (column + row < steps - 1) {
          emit(row + 1, column); emit(row + 1, column + 1); emit(row, column + 1);
        }
      }
    }
  }
  shape.dispose();
  if (source !== shape) source.dispose();
  const lagoon = surfaceFrom(positions);
  lagoon.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return lagoon;
}

function drapedPath(line: readonly CityPoint[], width: number, ground: (x: number, z: number) => number) {
  const positions: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.01) continue;
    const steps = Math.ceil(length / 2.6);
    const offsetX = (bz - az) * width / (length * 2);
    const offsetZ = (ax - bx) * width / (length * 2);
    const vertex = (x: number, z: number) => [x, ground(x, z) + 0.12, z];
    for (let step = 0; step < steps; step++) {
      const x = THREE.MathUtils.lerp(ax, bx, step / steps), z = THREE.MathUtils.lerp(az, bz, step / steps);
      const xx = THREE.MathUtils.lerp(ax, bx, (step + 1) / steps), zz = THREE.MathUtils.lerp(az, bz, (step + 1) / steps);
      if (Math.max(Math.abs(x), Math.abs(xx)) > halfWidth - width || Math.max(Math.abs(z), Math.abs(zz)) > halfDepth - width) continue;
      const a = vertex(x + offsetX, z + offsetZ), b = vertex(x - offsetX, z - offsetZ);
      const c = vertex(xx + offsetX, zz + offsetZ), d = vertex(xx - offsetX, zz - offsetZ);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  return positions.length > 0 ? surfaceFrom(positions) : null;
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
  const segments = 7;
  for (let i = 0; i < segments; i++) {
    const a = i / segments, b = (i + 1) / segments;
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

/** Georeferenced shoreline, elevation and footprints with photo-referenced details above ground. */
export function createHuacachinaModel(data: CitySceneData, anchor: Pick<THREE.Vector3, "x" | "z">): THREE.Group {
  const root = new THREE.Group();
  root.name = "Oasis de Huacachina";
  root.userData = {
    units: "metres",
    landmarkId: "huacachina",
    frontYaw: -0.9,
    shorelineSource: shorelineId,
    buildingFootprintCount: OASIS_BUILDINGS.length,
    treeLocationCount: OASIS_TREES.length,
    elevationSource: "https://registry.opendata.aws/terrain-tiles/",
    reference: "OpenStreetMap (ODbL), Terrain Tiles (Mapzen / USGS) y Vista panorámica de la laguna Huacachina (Hee.nanda, CC0)",
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
  add(lagoonSurface(water, ring), "pool", 0, 0.08, 0);
  for (let row = -11; row <= 10; row++) {
    for (let col = -11; col <= 11; col++) {
      const x = col * 8.4 + Math.sin(row * 4.3 + col * 3) * 3;
      const z = row * 4.8 + Math.cos(row * 2.3 - col * 1.84) * 2;
      if (shoreDistance(x, z, ring) > -7 || (row * 11 + col * 7) % 4 === 0) continue;
      const extent = 2 + Math.abs(Math.sin(row * 8.2 + col)) * 5.75;
      const vertices: number[] = [];
      for (let segment = 0; segment < 4; segment++) {
        const u = segment / 4, v = (segment + 1) / 4;
        const width = (t: number) => Math.sin(Math.PI * t) * 0.18;
        const line = (t: number) => Math.sin(t * Math.PI * 1.9 + row) * 0.57 + t * 0.45;
        const ax = (u - 0.5) * extent, bx = (v - 0.5) * extent;
        vertices.push(ax, 0, line(u) - width(u), ax, 0, line(u) + width(u), bx, 0, line(v) - width(v),
          ax, 0, line(u) + width(u), bx, 0, line(v) + width(v), bx, 0, line(v) - width(v));
      }
      add(surfaceFrom(vertices), (row + col) % 7 === 1 ? "glint" : "ripple", x, 0.101, z);
    }
  }

  part = "Entorno";
  for (const [kind, path] of OASIS_PATHS) {
    const road = kind === "residential" || kind === "service";
    const width = road ? kind === "residential" ? 4.8 : 3.2 : kind === "path" ? 1.1 : 2.0;
    const geometry = drapedPath(path, width, groundLevel);
    if (geometry) add(geometry, road ? "road" : "walk", 0, 0, 0);
  }

  part = "Edificios del oasis";
  // OSM provides the ground plans. Volumes and finish vary as observed in the aerial references.
  const swatches: Surface[] = ["white", "stucco", "white", "adobe", "ochre", "white"];
  for (const [wayId, , outline] of OASIS_BUILDINGS) {
    const edges = outline.map(([x, z], i) => {
      const [xx, zz] = outline[(i + 1) % outline.length];
      return { x, z, xx, zz, length: Math.hypot(xx - x, zz - z) };
    });
    const area = edges.reduce((sum, { x, z, xx, zz }) => sum + x * zz - xx * z, 0) * 0.5;
    const grounds = outline.map(([x, z]) => groundLevel(x, z));
    const base = Math.min(...grounds) - 0.18;
    const floors = Math.abs(area) < 110 ? 1 + (wayId % 4 === 0 ? 1 : 0) : 2 + (wayId % 5 === 1 ? 1 : 0);
    const roofY = Math.max(...grounds) + floors * 2.73 + 0.25;
    const paint = swatches[wayId % swatches.length];
    const boundaryShape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const walls = new THREE.ExtrudeGeometry(boundaryShape, { depth: roofY - base, bevelEnabled: false });
    add(walls.rotateX(-Math.PI / 2), paint, 0, base, 0);
    add(new THREE.ShapeGeometry(boundaryShape).rotateX(-Math.PI / 2), wayId % 5 > 0 ? "terrace" : "roof", 0, roofY + 0.045, 0);
    for (const { x, z, xx, zz, length } of edges) {
      if (length < 0.2) continue;
      const yaw = -Math.atan2(zz - z, xx - x);
      const nx = (zz - z) / length * Math.sign(area), nz = (x - xx) / length * Math.sign(area);
      box(length + 0.10, 0.47, 0.24, (x + xx) / 2, roofY + 0.2, (z + zz) / 2, paint, yaw);
      if (length < 6.0) continue;
      const bays = Math.floor(length / 3.5);
      const towardsLagoon = Math.hypot((x + xx) / 2 + nx * 1.4, (z + zz) / 2 + nz * 1.4) < Math.hypot((x + xx) / 2, (z + zz) / 2);
      for (let column = 0; column < bays; column++) {
        const u = (column + 0.5) / bays;
        const frameX = THREE.MathUtils.lerp(x, xx, u) + nx * 0.075;
        const frameZ = THREE.MathUtils.lerp(z, zz, u) + nz * 0.075;
        for (let floor = 0; floor < floors; floor++) {
          if (!towardsLagoon && (wayId + column + floor) % 4 === 1) continue;
          const y = roofY - (floor + 0.52) * 2.73;
          const width = towardsLagoon ? 1.45 : 1.12;
          const windowYaw = yaw + (area > 0 ? Math.PI : 0);
          add(new THREE.PlaneGeometry(width, 1.23), "shadow", frameX, y, frameZ, windowYaw);
          if (towardsLagoon) box(width + 0.17, 0.09, 0.31, frameX, y - 0.65, frameZ, "shade", yaw);
        }
      }
    }
  }

  part = "Palmeras y vegetación";
  const palms = OASIS_TREES.filter(([x, z]) => Math.abs(x) < halfWidth - 5.5 && Math.abs(z) < halfDepth - 5.5);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const length = Math.hypot(bx - ax, bz - az);
    const count = Math.ceil(length / 10.5);
    for (let j = 0; j < count; j++) {
      const t = j / count, offset = 3.5 + Math.sin(i * 4.47 + j * 2.1) * 1.8;
      const x = THREE.MathUtils.lerp(ax, bx, t) + (bz - az) * offset / length;
      const z = THREE.MathUtils.lerp(az, bz, t) - (bx - ax) * offset / length;
      if (shoreDistance(x, z, ring) <= 3 || (i * 5 + j * 3) % 5 === 3) continue;
      if (palms.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 6.0)) continue;
      palms.push([x, z]);
    }
  }
  for (const [i, [x, z]] of palms.entries()) {
    const y = groundLevel(x, z);
    if (i % 4 === 0 || Math.abs(x) > 110 && i % 3 !== 0) {
      for (let n = 0; n < 5; n++) {
        const angle = n * 2.4 + i * 0.74;
        const crown = new THREE.IcosahedronGeometry(1.65 + n % 3 * 0.56, 1).scale(1.25, 0.89, 1);
        add(crown, n % 3 ? "grass" : "leaf", x + Math.cos(angle) * 1.18,
          y + 1.68 + n % 3 * 0.38, z + Math.sin(angle) * 1.2);
      }
      continue;
    }
    const height = 5.4 + Math.abs(Math.sin(i * 4.43)) * 7.4;
    const lean = Math.sin(i * 3.83) * 1.25;
    const trunk = new THREE.CylinderGeometry(0.19, 0.31, height, 7).rotateZ(-Math.atan(lean / height));
    add(trunk, "bark", x + lean * 0.5, y + height * 0.5, z);
    const blades = 9;
    for (let blade = 0; blade < blades; blade++) {
      const r = 2.7 + 0.71 * Math.cos(i * 8.1 + blade * 3.34);
      const frond = palmFrond(r, 0.53, 0.75 + (blade % 3) * 0.15);
      const angle = blade * (Math.PI * 2 / blades) + i * 1.18;
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
      const material = materials.get(paint) ?? (paint === "pool"
        ? new THREE.MeshPhysicalMaterial({ name: paint, vertexColors: true, roughness: 0.29, clearcoat: 0.76, clearcoatRoughness: 0.2 })
        : new THREE.MeshStandardMaterial({
          color: palette[paint], name: paint, roughness: 0.88,
          side: paint.startsWith("leaf") ? THREE.DoubleSide : THREE.FrontSide,
        }));
      materials.set(paint, material);
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose());
      if (!geometry) throw new Error("No se pudo construir una superficie de Huacachina");
      const mesh = identify(new THREE.Mesh(geometry, material));
      mesh.name = paint;
      mesh.castShadow = !["pool", "ripple", "glint", "walk", "road"].includes(paint);
      group.add(mesh);
    }
  }
  return root;
}
