import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Point = [x: number, y: number, z: number];
type RoadCar = "compact" | "sedan" | "suv" | "sport";
type Arcade = "arcade-astro" | "arcade-gecko" | "arcade-ufo";

type CarDimensions = {
  length: number;
  width: number;
  roof: number;
  shoulder: number;
  wheelbase: number;
  tireRadius: number;
  tireWidth: number;
  clearance: number;
  cabin: [rearGlass: number, rearRoof: number, frontRoof: number, frontGlass: number];
};

// Dimensions in meters, informed by current hatchback, sedan, SUV and roadster
// specification sheets. The silhouettes and trim are original and unbranded.
const dimensions: Record<RoadCar, CarDimensions> = {
  compact: { length: 4.23, width: 1.77, roof: 1.45, shoulder: 0.82, wheelbase: 2.59, tireRadius: 0.31, tireWidth: 0.20, clearance: 0.16, cabin: [-0.455, -0.355, 0.075, 0.255] },
  sedan: { length: 4.87, width: 1.84, roof: 1.44, shoulder: 0.83, wheelbase: 2.82, tireRadius: 0.33, tireWidth: 0.22, clearance: 0.15, cabin: [-0.355, -0.206, 0.09, 0.248] },
  suv: { length: 4.65, width: 1.86, roof: 1.70, shoulder: 0.99, wheelbase: 2.68, tireRadius: 0.37, tireWidth: 0.24, clearance: 0.23, cabin: [-0.47, -0.397, 0.115, 0.268] },
  sport: { length: 4.09, width: 1.81, roof: 1.23, shoulder: 0.76, wheelbase: 2.43, tireRadius: 0.306, tireWidth: 0.235, clearance: 0.115, cabin: [-0.321, -0.14, 0.06, 0.23] },
};

const standard = (color: THREE.ColorRepresentation, roughness: number, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function markerMaterials(color: THREE.ColorRepresentation) {
  const paint = standard(color, 0.31, 0.38);
  return {
    paint,
    darkPaint: standard(paint.color.clone().multiplyScalar(0.54), 0.49, 0.26),
    glass: standard("#16354e", 0.18, 0.31),
    reflection: standard("#5d8cab", 0.32, 0.28),
    trim: standard("#1f2732", 0.62, 0.20),
    tire: standard("#1a2027", 0.91),
    sidewall: standard("#303746", 0.79),
    alloy: standard("#abb9c5", 0.36, 0.50),
    headlight: new THREE.MeshStandardMaterial({ color: "#e7f8ff", emissive: "#acdfff", emissiveIntensity: 0.25, roughness: 0.27 }),
    taillight: new THREE.MeshStandardMaterial({ color: "#d62e3f", emissive: "#e12139", emissiveIntensity: 0.29, roughness: 0.33 }),
    signal: new THREE.MeshStandardMaterial({ color: "#f2b73e", emissive: "#e69b21", emissiveIntensity: 0.2, roughness: 0.37 }),
  };
}

type Materials = ReturnType<typeof markerMaterials>;

/** Bake parts into one mesh per material. Navigation renders inside Mapbox's frame. */
class Model {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, position?: Point) {
    geometry.deleteAttribute("uv");
    if (!geometry.getIndex()) {
      const count = geometry.getAttribute("position").count;
      geometry.setIndex(Array.from({ length: count }, (_, index) => index));
    }
    if (position) geometry.translate(...position);
    const list = this.parts.get(material);
    if (list) list.push(geometry);
    else this.parts.set(material, [geometry]);
  }

  box(size: Point, position: Point, material: THREE.Material) {
    this.add(new THREE.BoxGeometry(...size), material, position);
  }

  ellipse(size: Point, position: Point, material: THREE.Material, tilt = 0) {
    const geometry = new THREE.SphereGeometry(1, 16, 10);
    geometry.scale(...size);
    if (tilt) geometry.rotateZ(tilt);
    this.add(geometry, material, position);
  }

  tube(from: Point, to: Point, radius: number, material: THREE.Material, segments = 8) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), segments);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    this.add(geometry, material, a.add(b).multiplyScalar(0.5).toArray());
  }

  disc(radius: number, width: number, position: Point, material: THREE.Material, axis: "x" | "y" | "z" = "x") {
    const geometry = new THREE.CylinderGeometry(radius, radius, width, 18);
    if (axis === "x") geometry.rotateZ(Math.PI / 2);
    if (axis === "z") geometry.rotateX(Math.PI / 2);
    this.add(geometry, material, position);
  }

  patch(vertices: Point[], material: THREE.Material, facing: Point) {
    const vector = (i: number) => new THREE.Vector3(...vertices[i]);
    const normal = vector(1).sub(vector(0)).cross(vector(2).sub(vector(0)));
    const front = normal.dot(new THREE.Vector3(...facing)) >= 0;
    const triangles: number[] = [];
    for (let i = 1; i < vertices.length - 1; i++) triangles.push(0, front ? i : i + 1, front ? i + 1 : i);
    this.add(surface(vertices, triangles), material);
  }

  skin(point: (u: number, v: number) => Point, segments: number, material: THREE.Material, facing: Point) {
    const positions: Point[] = [];
    const triangles: number[] = [];
    const columns = 5;
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j < columns; j++) positions.push(point(i / segments, j / (columns - 1)));
    }
    const v = positions.map((p) => new THREE.Vector3(...p));
    const normal = v[columns].clone().sub(v[0]).cross(v[1].clone().sub(v[0]));
    const forward = normal.dot(new THREE.Vector3(...facing)) >= 0;
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < columns - 1; j++) {
        const a = i * columns + j;
        const b = a + columns;
        triangles.push(...(forward ? [a, b, a + 1, a + 1, b, b + 1] : [a, a + 1, b, a + 1, b + 1, b]));
      }
    }
    this.add(surface(positions, triangles), material);
  }

  finish() {
    const group = new THREE.Group();
    for (const [material, parts] of this.parts) {
      const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
      if (parts.length > 1) parts.forEach((part) => part.dispose());
      if (geometry) group.add(new THREE.Mesh(geometry, material));
      else material.dispose();
    }
    return group;
  }
}

const mix = THREE.MathUtils.lerp;

function surface(positions: Point[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function loft(rings: Point[][]) {
  const positions = rings.flat();
  const triangles: number[] = [];
  const stride = rings[0].length;
  for (let row = 0; row < rings.length - 1; row++) {
    for (let i = 0; i < stride; i++) {
      const a = row * stride + i;
      const next = row * stride + ((i + 1) % stride);
      triangles.push(a, a + stride, next, next, a + stride, next + stride);
    }
  }
  const front = (rings.length - 1) * stride;
  for (let i = 1; i < stride - 1; i++) triangles.push(0, i, i + 1, front, front + i + 1, front + i);
  return surface(positions, triangles);
}

// Around each section, the shoulders and crown remain connected over the wheels.
const bodyProfile: readonly [position: number, halfWidth: number, height: number][] = [
  [-0.5, 0.70, 0.90], [-0.487, 0.82, 0.96], [-0.44, 0.95, 1], [-0.34, 1, 1.035],
  [-0.24, 0.985, 1.02], [-0.1, 0.98, 1], [0.12, 0.98, 1.01], [0.28, 1, 1],
  [0.36, 0.99, 0.98], [0.44, 0.94, 0.93], [0.481, 0.84, 0.865], [0.5, 0.69, 0.81],
];

function bodyAt(c: CarDimensions, z: number) {
  const position = THREE.MathUtils.clamp(z / c.length, -0.5, 0.5);
  const i = Math.max(1, bodyProfile.findIndex((part) => part[0] >= position));
  const [a, aw, ah] = bodyProfile[i - 1];
  const [b, bw, bh] = bodyProfile[i];
  const t = (position - a) / (b - a);
  return { width: c.width * 0.5 * mix(aw, bw, t), top: c.shoulder * mix(ah, bh, t) };
}

function carBody(model: Model, c: CarDimensions, axles: number[], material: THREE.Material) {
  const tireOpening = c.tireRadius + 0.027;
  const stations = bodyProfile.map(([z]) => z * c.length);
  for (const axle of axles) {
    for (const t of [-1, -0.94, -0.77, -0.5, -0.27, 0, 0.27, 0.5, 0.77, 0.94, 1]) stations.push(axle + t * tireOpening);
  }

  const rings = stations.sort((a, b) => a - b).map((z): Point[] => {
    const { width, top } = bodyAt(c, z);
    let bottom = c.clearance + 0.06;
    for (const axle of axles) {
      const step = Math.abs(z - axle);
      if (step <= tireOpening) bottom = Math.max(bottom, c.tireRadius + Math.sqrt(Math.max(0, tireOpening ** 2 - step ** 2)));
    }
    bottom = Math.min(bottom, top - 0.085);
    const side = mix(bottom, top, 0.46);
    const half: Point[] = [
      [-width * 0.82, bottom, z], [-width * 0.96, mix(bottom, side, 0.56), z], [-width, side, z],
      [-width * 0.992, mix(side, top, 0.73), z], [-width * 0.935, top - 0.047, z], [-width * 0.77, top, z],
      [-width * 0.42, top + 0.024, z],
    ];
    return [...half, [0, top + 0.038, z], ...half.slice().reverse().map(([x, y, depth]): Point => [-x, y, depth])];
  });
  model.add(loft(rings), material);
}

function tire(model: Model, m: Materials, at: Point, radius: number, width: number, side = 0, motorcycle = false) {
  const [x, y, z] = at;
  const bead = width * 0.5;
  const tireWall = [
    [0.61, -0.76], [0.75, -1], [0.89, -0.99], [0.98, -0.72], [1, -0.39],
    [1, 0.39], [0.98, 0.72], [0.89, 0.99], [0.75, 1], [0.61, 0.76], [0.61, -0.76],
  ];
  const tread = new THREE.LatheGeometry(tireWall.map(([r, w]) => new THREE.Vector2(r * radius, w * bead)), 20);
  tread.rotateZ(-Math.PI / 2);
  model.add(tread, m.tire, at);
  const faces = side ? [side] : [-1, 1];
  const rimRadius = radius * (motorcycle ? 0.69 : 0.67);
  model.disc(rimRadius, width * 0.8, at, m.trim);
  for (const sign of faces) {
    const far = x + sign * (bead + 0.006);
    const ring = new THREE.TorusGeometry(rimRadius * 0.95, radius * 0.043, 5, 18);
    ring.rotateY(Math.PI / 2);
    model.add(ring, m.alloy, [far, y, z]);
    model.disc(rimRadius * 0.37, 0.028, [far, y, z], m.alloy);
    const spokeCount = motorcycle ? 6 : 5;
    for (let i = 0; i < spokeCount; i++) {
      const a = (i * Math.PI * 2) / spokeCount;
      const inner = a - 0.17;
      model.tube([far, y + Math.cos(inner) * rimRadius * 0.27, z + Math.sin(inner) * rimRadius * 0.27], [far, y + Math.cos(a) * rimRadius * 0.92, z + Math.sin(a) * rimRadius * 0.92], radius * (motorcycle ? 0.026 : 0.047), m.alloy, 5);
    }
    model.disc(rimRadius * 0.15, 0.039, [far + sign * 0.01, y, z], m.sidewall);
  }
}

function cabin(model: Model, c: CarDimensions, kind: RoadCar, m: Materials) {
  const [rear, rearRoof, frontRoof, front] = c.cabin.map((v) => v * c.length);
  type Station = { z: number; top: number; roofHalf: number; baseHalf: number; base: number };
  const station = (z: number, top: number, fraction: number): Station => {
    const body = bodyAt(c, z);
    return { z, top, roofHalf: c.width * fraction, baseHalf: body.width * 0.84, base: body.top + 0.012 };
  };
  const stations = [
    station(rear, bodyAt(c, rear).top + 0.036, 0.365),
    station(rearRoof, c.roof - 0.062, kind === "suv" ? 0.365 : 0.325),
    station((rearRoof + frontRoof) * 0.5, c.roof - 0.035, kind === "suv" ? 0.375 : 0.345),
    station(frontRoof, c.roof - 0.06, kind === "suv" ? 0.36 : 0.33),
    station(front, bodyAt(c, front).top + 0.032, 0.37),
  ];
  function section(u: number) {
    const start = Math.min(stations.length - 2, Math.floor(u));
    const a = stations[start], b = stations[start + 1], t = u - start;
    return { z: mix(a.z, b.z, t), top: mix(a.top, b.top, t), base: mix(a.base, b.base, t), roofHalf: mix(a.roofHalf, b.roofHalf, t), baseHalf: mix(a.baseHalf, b.baseHalf, t) };
  }
  const roof = (u: number, v: number, lift = 0): Point => {
    const s = section(u);
    const x = 2 * v - 1;
    return [s.roofHalf * x, s.top + 0.037 * (1 - x * x) + lift, s.z];
  };
  const flank = (u: number, v: number, side: number, offset = 0): Point => {
    const s = section(u);
    return [side * (mix(s.baseHalf, s.roofHalf, v) + offset), mix(s.base, s.top, v), s.z];
  };

  for (let part = 0; part < 4; part++) {
    model.skin((u, v) => roof(part + u, v), 4, m.paint, [0, 1, 0]);
    for (const sign of [-1, 1]) model.skin((u, v) => flank(part + u, v, sign), 4, m.paint, [sign, 0, 0]);
  }
  for (const part of [0, 3]) {
    model.skin((u, v) => roof(part + mix(0.13, 0.88, u), mix(0.064, 0.936, v), 0.012), 5, m.trim, [0, 1, 0]);
    model.skin((u, v) => roof(part + mix(0.17, 0.845, u), mix(0.083, 0.917, v), 0.016), 5, m.glass, [0, 1, 0]);
    model.skin((u, v) => roof(part + (part === 3 ? mix(0.21, 0.265, u) : mix(0.75, 0.81, u)), mix(0.11, 0.89, v), 0.019), 1, m.reflection, [0, 1, 0]);
  }
  for (const sign of [-1, 1]) {
    const windows: [number, number][] = kind === "sport"
      ? [[0.90, 1.51], [1.57, 3.43]]
      : kind === "suv"
        ? [[0.55, 1.28], [1.38, 2.15], [2.24, 3.38]]
        : [[0.65, 2.11], [2.22, 3.39]];
    for (const [start, end] of windows) {
      model.skin((u, v) => flank(mix(start, end, u), mix(0.17, 0.93, v), sign, 0.017), 10, m.trim, [sign, 0, 0]);
      model.skin((u, v) => flank(mix(start + 0.055, end - 0.055, u), mix(0.22, 0.88, v), sign, 0.021), 10, m.glass, [sign, 0, 0]);
      model.skin((u, v) => flank(mix(start + 0.07, end - 0.08, u), mix(0.23, 0.28, v), sign, 0.024), 10, m.reflection, [sign, 0, 0]);
    }
    const mirrorZ = front - c.length * 0.05;
    const mirrorX = sign * c.width * 0.51;
    const mirrorY = c.shoulder + 0.09;
    model.tube([mirrorX * 0.77, mirrorY - 0.05, mirrorZ - 0.055], [mirrorX, mirrorY, mirrorZ], 0.034, m.trim);
    model.ellipse([0.098, 0.049, 0.105], [mirrorX, mirrorY, mirrorZ], m.paint);
    model.ellipse([0.074, 0.035, 0.025], [mirrorX, mirrorY, mirrorZ - 0.084], m.reflection);
  }
}

function carTrim(model: Model, c: CarDimensions, kind: RoadCar, axles: number[], m: Materials) {
  const end = c.length / 2;
  const half = c.width / 2;
  for (const sign of [-1, 1]) {
    const lower = c.clearance + 0.12;
    model.tube([sign * half * 0.95, lower, axles[0] + c.tireRadius + 0.08], [sign * half * 0.95, lower, axles[1] - c.tireRadius - 0.08], kind === "suv" ? 0.052 : 0.028, m.trim);
    for (const axle of axles) {
      if (kind === "suv") {
        const ring: Point[] = [];
        for (let i = 0; i <= 10; i++) {
          const t = (i * Math.PI) / 10;
          const radius = c.tireRadius + 0.046;
          ring.push([sign * half * 0.968, c.tireRadius + Math.sin(t) * radius, axle + Math.cos(t) * radius]);
        }
        for (let i = 1; i < ring.length; i++) model.tube(ring[i - 1], ring[i], 0.032, m.trim, 6);
      }
    }
    const lights = (front: boolean) => {
      const z1 = end * (front ? 0.973 : -0.98), z2 = end * (front ? 0.898 : -0.909);
      const y1 = bodyAt(c, z1).top + 0.033, y2 = bodyAt(c, z2).top + 0.006;
      const color = front ? m.headlight : m.taillight;
      model.patch([
        [sign * half * 0.47, y1, z1], [sign * half * 0.76, y1 - 0.025, z1],
        [sign * half * 0.91, y2 - 0.048, z2], [sign * half * 0.76, y2 - 0.018, z2],
      ], color, [0, 1, front ? 1 : -1]);
      const outer = front ? 0.68 : 0.66;
      const edge = front ? end + 0.003 : -end - 0.003;
      const lampY = bodyAt(c, edge).top - 0.023;
      model.patch([[sign * half * 0.43, lampY, edge], [sign * half * outer, lampY - 0.025, edge], [sign * half * outer * 0.97, lampY - 0.082, edge], [sign * half * 0.44, lampY - 0.072, edge]], color, [0, 0, front ? 1 : -1]);
    };
    lights(true);
    lights(false);

    for (const z of kind === "sport" ? [-end * 0.127] : [-end * 0.34, end * 0.15]) {
      const side = bodyAt(c, z);
      model.tube([sign * side.width, side.top - 0.12, z - 0.043], [sign * side.width, side.top - 0.12, z + 0.052], 0.018, m.darkPaint);
    }
    if (kind === "suv") {
      const x = sign * half * 0.65;
      const railY = c.roof + 0.033;
      model.tube([x, railY, -end * 0.69], [x, railY, end * 0.24], 0.032, m.alloy);
      for (const z of [-end * 0.61, end * 0.16]) model.tube([x, railY - 0.085, z], [x, railY, z], 0.031, m.trim);
    }
  }
  const frontY = bodyAt(c, end).top;
  model.patch([[-half * 0.54, frontY - 0.14, end + 0.005], [half * 0.54, frontY - 0.14, end + 0.005], [half * 0.36, frontY - 0.32, end + 0.005], [-half * 0.36, frontY - 0.32, end + 0.005]], m.trim, [0, 0, 1]);
  for (let y = frontY - 0.18; y >= frontY - 0.29; y -= 0.045) model.tube([-half * 0.35, y, end + 0.009], [half * 0.35, y, end + 0.009], 0.012, m.sidewall, 5);
  const rearY = bodyAt(c, -end).top;
  model.box([0.30, 0.115, 0.015], [0, rearY - 0.18, -end - 0.011], m.alloy);
  if (kind === "sport") {
    model.ellipse([half * 0.88, 0.032, 0.12], [0, rearY + 0.21, -end * 0.935], m.darkPaint);
    for (const sign of [-1, 1]) model.tube([sign * half * 0.55, rearY, -end * 0.93], [sign * half * 0.55, rearY + 0.2, -end * 0.935], 0.034, m.trim);
  }
  if (kind === "compact") {
    model.ellipse([half * 0.69, 0.036, 0.078], [0, c.roof - 0.07, c.cabin[1] * c.length - 0.027], m.darkPaint);
  }
}

function makeCar(model: Model, kind: RoadCar, m: Materials) {
  const c = dimensions[kind];
  const axles = [-c.wheelbase / 2 - 0.018, c.wheelbase / 2 - 0.018];
  carBody(model, c, axles, m.paint);
  model.box([c.width * 0.79, 0.12, c.length * 0.83], [0, c.clearance + 0.069, 0], m.trim);
  for (const z of axles) for (const side of [-1, 1]) {
    tire(model, m, [side * (c.width / 2 - c.tireWidth * 0.53), c.tireRadius, z], c.tireRadius, c.tireWidth, side);
  }
  cabin(model, c, kind, m);
  carTrim(model, c, kind, axles, m);
}

function makeBike(model: Model, m: Materials, motorcycle: boolean) {
  const r = motorcycle ? 0.31 : 0.345;
  const half = motorcycle ? 0.70 : 0.53;
  const fork: Point = [0, motorcycle ? 0.92 : 1.03, half * 0.62];
  const front: Point = [0, r, half];
  const rear: Point = [0, r, -half];
  const seat: Point = [0, motorcycle ? 0.78 : 0.96, -half * 0.52];
  const crank: Point = [0, motorcycle ? 0.41 : 0.40, -half * 0.13];
  for (const hub of [front, rear]) tire(model, m, hub, r, motorcycle ? 0.145 : 0.049, 0, true);
  const frameRadius = motorcycle ? 0.050 : 0.024;
  model.tube(seat, fork, frameRadius, m.paint);
  model.tube(crank, fork, frameRadius, m.darkPaint);
  model.tube(crank, seat, frameRadius, m.paint);
  model.tube(crank, rear, frameRadius, m.trim);
  if (!motorcycle) model.tube(seat, rear, frameRadius, m.paint);
  model.ellipse([motorcycle ? 0.15 : 0.066, 0.046, motorcycle ? 0.32 : 0.13], [0, seat[1] + 0.067, seat[2] - 0.035], m.trim);
  for (const sign of [-1, 1]) {
    const forkWidth = motorcycle ? 0.109 : 0.044;
    model.tube([sign * forkWidth, r, half], [sign * forkWidth * 0.77, fork[1], fork[2]], motorcycle ? 0.037 : 0.022, m.alloy);
    model.tube([0, fork[1], fork[2]], [sign * (motorcycle ? 0.36 : 0.30), fork[1] + 0.09, fork[2] - 0.075], 0.026, m.trim);
    model.tube([sign * (motorcycle ? 0.31 : 0.25), fork[1] + 0.09, fork[2] - 0.068], [sign * (motorcycle ? 0.39 : 0.34), fork[1] + 0.09, fork[2] - 0.091], 0.031, m.sidewall);
  }
  if (motorcycle) {
    model.ellipse([0.245, 0.21, 0.395], [0, 0.756, 0.065], m.paint);
    model.ellipse([0.186, 0.12, 0.284], [0, r + 0.248, half - 0.014], m.darkPaint);
    model.ellipse([0.162, 0.177, 0.178], [0, 0.53, 0.07], m.alloy);
    for (const y of [0.50, 0.545, 0.59, 0.635]) model.box([0.347, 0.028, 0.229], [0, y, 0.095], m.trim);
    model.tube([0.16, 0.42, 0.18], [0.19, 0.33, -0.58], 0.055, m.alloy);
    model.ellipse([0.145, 0.122, 0.11], [0, 0.823, 0.557], m.trim);
    model.ellipse([0.099, 0.076, 0.046], [0, 0.821, 0.636], m.headlight);
    model.ellipse([0.099, 0.039, 0.05], [0, 0.706, -0.775], m.taillight);
    model.ellipse([0.13, 0.045, 0.255], [0, 0.736, -0.59], m.paint);
  } else {
    model.disc(0.088, 0.022, [0.062, crank[1], crank[2]], m.alloy);
    model.tube([-0.129, crank[1] - 0.06, crank[2]], [0.14, crank[1] + 0.04, crank[2]], 0.027, m.trim);
    for (const side of [-1, 1]) model.box([0.128, 0.029, 0.082], [side * 0.14, crank[1] + side * 0.044, crank[2]], m.sidewall);
    model.ellipse([0.061, 0.048, 0.042], [0, fork[1], fork[2] + 0.028], m.headlight);
    model.ellipse([0.048, 0.024, 0.025], [0, seat[1] - 0.035, seat[2] - 0.061], m.taillight);
  }
}

function arcadeBuggy(model: Model, m: Materials) {
  const buggy: CarDimensions = { length: 3.27, width: 1.72, roof: 1.04, shoulder: 0.79, wheelbase: 2.11, tireRadius: 0.36, tireWidth: 0.25, clearance: 0.26, cabin: [-0.42, -0.2, 0.1, 0.28] };
  const axles = [-1.06, 1.06];
  carBody(model, buggy, axles, m.paint);
  model.ellipse([0.64, 0.14, 0.77], [0, 0.79, -0.18], m.darkPaint);
  for (const side of [-1, 1]) {
    for (const z of axles) tire(model, m, [side * 0.72, buggy.tireRadius, z], buggy.tireRadius, buggy.tireWidth, side);
    model.ellipse([0.166, 0.095, 0.143], [side * 0.44, 0.664, 1.52], m.headlight);
    model.ellipse([0.118, 0.074, 0.078], [side * 0.44, 0.677, -1.54], m.taillight);
  }
  model.tube([-0.54, 0.454, 1.59], [0.54, 0.454, 1.59], 0.061, m.trim);
  model.tube([-0.57, 0.44, -1.55], [0.57, 0.44, -1.55], 0.055, m.trim);
  model.ellipse([0.26, 0.085, 0.35], [0, 0.77, 1.025], m.alloy);
}

function makeArcade(model: Model, kind: Arcade, m: Materials) {
  const cream = standard("#f4f2e5", 0.46);
  const mint = standard("#65dabb", 0.55);
  const leaf = standard("#259683", 0.61);
  const purple = standard("#7255c8", 0.49, 0.18);
  const eyes = standard("#172338", 0.47);
  if (kind === "arcade-ufo") {
    model.ellipse([1.39, 0.228, 1.39], [0, 0.52, 0], m.paint);
    model.ellipse([1.15, 0.29, 1.14], [0, 0.64, -0.015], purple);
    model.ellipse([0.75, 0.32, 0.7], [0, 0.77, 0], m.glass);
    model.ellipse([0.44, 0.42, 0.39], [0, 1.10, 0.145], mint);
    for (const sign of [-1, 1]) {
      model.ellipse([0.105, 0.176, 0.13], [sign * 0.174, 1.18, 0.46], eyes, sign * -0.15);
      model.ellipse([0.028, 0.043, 0.035], [sign * 0.174 - 0.022, 1.234, 0.577], cream);
    }
    model.tube([0.07, 1.433, 0.08], [0.20, 1.66, -0.035], 0.039, leaf);
    model.ellipse([0.09, 0.09, 0.09], [0.20, 1.66, -0.035], m.signal);
    model.ellipse([0.097, 0.046, 0.031], [0, 1.00, 0.527], eyes);
    for (let i = 0; i < 6; i++) {
      const t = (i * Math.PI) / 3;
      model.ellipse([0.13, 0.066, 0.132], [1.14 * Math.sin(t), 0.70, 1.14 * Math.cos(t)], i === 0 ? m.headlight : m.signal);
    }
    model.ellipse([0.28, 0.10, 0.22], [0, 0.56, 1.29], m.headlight);
    model.ellipse([0.19, 0.077, 0.12], [0, 0.5, -1.315], m.taillight);
    return [cream, mint, leaf, purple, eyes];
  }

  arcadeBuggy(model, m);
  if (kind === "arcade-astro") {
    model.ellipse([0.37, 0.39, 0.32], [0, 0.95, -0.2], cream);
    model.ellipse([0.53, 0.47, 0.48], [0, 1.43, -0.22], cream);
    model.ellipse([0.444, 0.32, 0.256], [0, 1.435, 0.113], m.glass);
    model.ellipse([0.20, 0.063, 0.025], [-0.113, 1.617, 0.321], m.reflection, 0.18);
    for (const side of [-1, 1]) {
      model.ellipse([0.054, 0.070, 0.022], [side * 0.151, 1.407, 0.353], m.headlight);
      model.ellipse([0.085, 0.137, 0.134], [side * 0.465, 1.422, -0.23], m.darkPaint);
      model.ellipse([0.129, 0.105, 0.167], [side * 0.303, 0.965, 0.175], m.paint, side * 0.25);
    }
    model.tube([-0.32, 1.73, -0.35], [-0.43, 1.98, -0.43], 0.035, m.trim);
    model.ellipse([0.089, 0.089, 0.089], [-0.43, 1.98, -0.43], m.signal);
    model.ellipse([0.104, 0.041, 0.018], [0, 1.281, 0.333], m.reflection);
  } else {
    model.ellipse([0.45, 0.38, 0.42], [0, 0.93, -0.26], leaf);
    model.ellipse([0.53, 0.36, 0.48], [0, 1.31, -0.036], mint);
    model.ellipse([0.327, 0.175, 0.27], [0, 1.211, 0.35], mint);
    for (const side of [-1, 1]) {
      model.ellipse([0.153, 0.208, 0.16], [side * 0.294, 1.55, 0.11], leaf, side * -0.18);
      model.ellipse([0.107, 0.15, 0.106], [side * 0.294, 1.56, 0.228], cream);
      model.ellipse([0.048, 0.099, 0.047], [side * 0.274, 1.565, 0.316], eyes);
      model.ellipse([0.031, 0.031, 0.021], [side * 0.274 - 0.014, 1.601, 0.352], cream);
      model.ellipse([0.153, 0.065, 0.219], [side * 0.33, 0.945, 0.30], mint, side * 0.13);
      model.ellipse([0.016, 0.02, 0.018], [side * 0.105, 1.255, 0.586], eyes);
    }
    model.ellipse([0.17, 0.038, 0.033], [0, 1.144, 0.575], leaf);
    const tail = new THREE.CatmullRomCurve3([[0.06, 0.95, -0.55], [0.24, 0.86, -0.92], [0.57, 0.93, -1.16], [0.69, 1.16, -1.11], [0.63, 1.32, -0.98]].map((p) => new THREE.Vector3(...p)));
    model.add(new THREE.TubeGeometry(tail, 12, 0.09, 8, false), leaf);
    model.ellipse([0.08, 0.095, 0.085], [0.63, 1.32, -0.98], mint);
  }
  return [cream, mint, leaf, purple, eyes];
}

const arcadeColors: Record<Arcade, string> = { "arcade-astro": "#1e9bdc", "arcade-gecko": "#e97829", "arcade-ufo": "#a78bea" };

/** Forward is +Z. Units are meters and the contact plane is Y=0. */
export function createVehicleModel(kind: string, color: THREE.ColorRepresentation): THREE.Group | null {
  const car = kind === "car" ? "sedan" : kind;
  const roadCar = Object.hasOwn(dimensions, car);
  const arcade = Object.hasOwn(arcadeColors, kind);
  const bike = kind === "motorcycle" || kind === "bicycle";
  if (!roadCar && !arcade && !bike) return null;

  const model = new Model();
  const materials = markerMaterials(arcade ? arcadeColors[kind as Arcade] : color);
  let accents: THREE.Material[] = [];
  if (roadCar) makeCar(model, car as RoadCar, materials);
  if (bike) makeBike(model, materials, kind === "motorcycle");
  if (arcade) accents = makeArcade(model, kind as Arcade, materials);
  const group = model.finish();
  const used = new Set(group.children.map((child) => (child as THREE.Mesh).material));
  for (const material of [...Object.values(materials), ...accents]) {
    if (!used.has(material)) material.dispose();
  }
  group.name = `CiviGo ${kind}`;
  return group;
}
