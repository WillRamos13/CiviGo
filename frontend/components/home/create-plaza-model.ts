import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Metres, Y up. A reference-based diorama, not a measured architectural survey. */
export function createPlazaModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Plaza de Armas de Ica · maqueta de referencia";
  root.userData = {
    landmarkId: "plaza",
    reference: "Imagen proporcionada por el usuario, 14 de noviembre de 2026",
    reconstruction: "Interpretación de una sola vista; dimensiones y caras ocultas aproximadas",
    units: "metres",
  };
  const palette = {
    base: "#303d4b", pavement: "#e4dfd3", stone: "#d2c9b4",
    road: "#58616a", paint: "#f6f1df", yellow: "#e6bd42",
    wall: "#ddc784", church: "#e3ce91", ivory: "#f4ead1",
    roof: "#c9bbac", tile: "#c0a08a", shadow: "#444a42",
    door: "#62452f", glass: "#324947", metal: "#4a5552",
    grass: "#648641", hedge: "#385a2e", leaf: "#2f5934",
    leafLight: "#50743e", leafDark: "#264c30", trunk: "#8d7a5c",
    water: "#67b6c5", pool: "#a8d8df", pink: "#c78387",
    flower: "#e4c470", flag: "#d52b35", taxi: "#f2c52e",
  };
  type Paint = keyof typeof palette;
  const materials = new Map<Paint, THREE.MeshStandardMaterial>();
  const batches = new Map<string, { paint: Paint; part: string; geometries: THREE.BufferGeometry[] }>();
  let part = "Plaza", placement = new THREE.Matrix4();
  const add = (
    geometry: THREE.BufferGeometry, paint: Paint,
    x = 0, y = 0, z = 0, yaw = 0, scale = new THREE.Vector3(1, 1, 1),
  ) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), scale,
    );
    geometry.applyMatrix4(matrix.premultiply(placement));
    // Geometry is centred on the complete tile so orbiting never wobbles.
    geometry.translate(22, 0, 18);
    geometry.deleteAttribute("uv");
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const key = `${part}:${paint}`;
    if (!batches.has(key)) batches.set(key, { paint, part, geometries: [] });
    batches.get(key)!.geometries.push(flat);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, paint: Paint, yaw = 0) =>
    add(new THREE.BoxGeometry(w, h, d), paint, x, y, z, yaw);
  const cylinder = (r: number, h: number, x: number, y: number, z: number, paint: Paint, top = r, segments = 12) =>
    add(new THREE.CylinderGeometry(top, r, h, segments), paint, x, y, z);
  const ball = (r: number, x: number, y: number, z: number, paint: Paint, sx = 1, sy = 1, sz = 1) =>
    add(new THREE.IcosahedronGeometry(r, paint === "leaf" && r > 1 ? 2 : 1), paint, x, y, z, 0, new THREE.Vector3(sx, sy, sz));
  const inPart = (name: string, x: number, z: number, yaw: number, build: () => void) => {
    const previousPart = part, previousPlacement = placement;
    part = name;
    placement = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    build();
    part = previousPart; placement = previousPlacement;
  };
  const arch = (w: number, h: number) => {
    const s = new THREE.Shape(), r = w / 2;
    s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r);
    s.absarc(0, h - r, r, 0, Math.PI, false); s.closePath();
    return s;
  };
  const archOpening = (w: number, h: number, x: number, y: number, z: number, trim = 0.4, paint: Paint = "ivory") => {
    const shape = arch(w + trim * 2, h + trim);
    const inner = arch(w, h);
    shape.holes.push(new THREE.Path(inner.getPoints(18)));
    add(new THREE.ExtrudeGeometry(shape, { depth: 0.35, steps: 1, bevelEnabled: false, curveSegments: 12 }), paint, x, y, z);
  };
  const archedPanel = (w: number, h: number, x: number, y: number, z: number, paint: Paint) =>
    add(new THREE.ShapeGeometry(arch(w, h), 12), paint, x, y, z);
  const window = (x: number, y: number, z: number, w = 2, h = 3.6) => {
    box(w + 0.5, h + 0.5, 0.18, x, y, z, "ivory");
    box(w, h, 0.2, x, y, z + 0.12, "door");
    box(w - 0.35, h - 0.35, 0.12, x, y, z + 0.25, "glass");
    box(0.12, h, 0.18, x, y, z + 0.34, "door");
    box(w, 0.12, 0.18, x, y, z + 0.34, "door");
  };
  const roofEdge = (w: number, d: number, x: number, y: number, z: number, paint: Paint = "ivory") => {
    box(w + 0.8, 0.5, d + 0.8, x, y, z, paint);
    box(w, 0.65, 0.45, x, y + 0.55, z + d / 2, paint);
    box(w, 0.65, 0.45, x, y + 0.55, z - d / 2, paint);
    box(0.45, 0.65, d, x - w / 2, y + 0.55, z, paint);
    box(0.45, 0.65, d, x + w / 2, y + 0.55, z, paint);
  };
  const cross = (x: number, y: number, z: number, size = 1) => {
    box(0.19 * size, 2.5 * size, 0.19 * size, x, y, z, "metal");
    box(1.3 * size, 0.18 * size, 0.19 * size, x, y + 0.35 * size, z, "metal");
  };
  const dome = (x: number, base: number, z: number, radius: number) => {
    cylinder(radius * 0.9, radius * 0.48, x, base, z, "church", radius * 0.9, 24);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      box(0.7, radius * 0.3, 0.22, x + Math.sin(a) * radius * 0.91, base, z + Math.cos(a) * radius * 0.91, "glass", a);
    }
    const top = base + radius * 0.24;
    const cap = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    add(cap, "church", x, top, z, 0, new THREE.Vector3(1, 1.12, 1));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const points = Array.from({ length: 13 }, (_, n) => {
        const t = (n / 12) * Math.PI / 2;
        return new THREE.Vector3(Math.cos(a) * Math.sin(t) * radius * 1.012, Math.cos(t) * radius * 1.13, Math.sin(a) * Math.sin(t) * radius * 1.012);
      });
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.1, 4, false), "ivory", x, top, z);
    }
    const tip = top + radius * 1.12;
    cylinder(radius * 0.17, radius * 0.33, x, tip + radius * 0.1, z, "ivory");
    cylinder(radius * 0.2, radius * 0.24, x, tip + radius * 0.35, z, "church", 0.01);
    cross(x, tip + radius * 0.57, z, radius / 9);
  };

  // The four road edges and low tile are actual geometry, not a picture plane.
  inPart("Entorno", 0, 0, 0, () => {
    box(262, 3.2, 228, -22, -1.7, -18, "base");
    box(262, 0.25, 228, -22, 0, -18, "pavement");
    for (const x of [-82, 82]) box(18, 0.12, 182, x, 0.2, 0, "road");
    for (const z of [-82, 82]) box(182, 0.12, 18, 0, 0.21, z, "road");
    for (const side of [-1, 1]) {
      for (const p of [-54, -36, -18, 0, 18, 36, 54]) {
        box(0.2, 0.02, 6, side * 82, 0.29, p, "paint");
        box(6, 0.02, 0.2, p, 0.3, side * 82, "paint");
      }
      for (const p of [-69, 69]) {
        box(0.24, 0.09, 138, p, 0.38, 0, "yellow");
        box(138, 0.09, 0.24, 0, 0.39, p, "yellow");
      }
      for (const corner of [-64, 64]) {
        for (let i = 0; i < 9; i++) {
          box(12, 0.03, 0.7, side * 82, 0.32, corner - 6 + i * 1.5, "paint");
          box(0.7, 0.03, 12, corner - 6 + i * 1.5, 0.33, side * 82, "paint");
        }
      }
    }
    box(138, 0.45, 138, 0, 0.3, 0, "pavement");
  });

  inPart("Monumento y piletas", 0, 0, 0, () => {
    cylinder(32.4, 0.4, 0, 0.65, 0, "stone", 32.4, 64);
    cylinder(31.1, 0.15, 0, 0.92, 0, "water", 31.1, 64);
    // Walkways divide the water into four curved basins, like the reference.
    box(8.4, 0.6, 187, 0, 1.05, 0, "pavement", Math.PI / 4);
    box(8.4, 0.6, 187, 0, 1.06, 0, "pavement", -Math.PI / 4);
    cylinder(10, 0.3, 0, 1.4, 0, "ivory", 10, 48);
    cylinder(8.6, 0.15, 0, 1.61, 0, "water", 8.6, 48);
    box(5.2, 1.2, 5.2, 0, 2.1, 0, "stone");
    const obelisk = new THREE.CylinderGeometry(1.4, 2.55, 27, 4, 1);
    obelisk.rotateY(Math.PI / 4);
    add(obelisk, "ivory", 0, 15.8, 0);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      cylinder(0.09, 1.2, Math.cos(a) * 28.5, 1.4, Math.sin(a) * 28.5, "pool", 0.05, 5);
    }
  });

  inPart("Jardines", 0, 0, 0, () => {
    for (let side = 0; side < 4; side++) {
      const shape = new THREE.Shape(), a = -Math.PI * 0.25 - 0.1, b = -Math.PI * 0.75 + 0.1;
      shape.moveTo(53, 60); shape.lineTo(-53, 60);
      shape.lineTo(Math.cos(b) * 35.8, -Math.sin(b) * 35.8);
      for (let i = 1; i <= 20; i++) {
        const angle = b + (a - b) * i / 20;
        shape.lineTo(Math.cos(angle) * 35.8, -Math.sin(angle) * 35.8);
      }
      shape.closePath();
      const bed = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, steps: 1 });
      bed.rotateX(-Math.PI / 2);
      add(bed, "grass", 0, 0.7, 0, side * Math.PI / 2);
      for (let i = 0; i < 20; i++) {
        const t = i / 19, angle = b + (a - b) * t;
        const px = Math.cos(angle) * 35.9, pz = Math.sin(angle) * 35.9;
        const turn = side * Math.PI / 2, x = px * Math.cos(turn) + pz * Math.sin(turn), z = pz * Math.cos(turn) - px * Math.sin(turn);
        ball(0.8, x, 1.1, z, "hedge", 1, 0.5, 0.8);
        ball(0.45, x + 0.45, 1.45, z, i % 3 ? "pink" : "flower");
      }
    }
    const trees: [number, number][] = [];
    for (let z = -52; z <= 52; z += 13)
      for (let x = -52; x <= 52; x += 13)
        if (Math.hypot(x, z) > 39 && Math.abs(Math.abs(x) - Math.abs(z)) > 10) trees.push([x, z]);
    trees.forEach(([x, z], i) => {
      const h = 11 + (i * 7 % 5), r = 3.8 + (i % 3) * 0.35;
      cylinder(0.4, h - 3, x, h / 2 - 0.5, z, "trunk", 0.25, 7);
      ball(r, x, h, z, "leaf", 1.15, 1.15, 1.1);
      ball(r * 0.8, x - r * 0.55, h - 1, z + r * 0.45, "leafDark");
      ball(r * 0.85, x + r * 0.5, h - 0.1, z + r * 0.38, "leafLight");
      ball(r * 0.73, x + r * 0.12, h + 2.3, z - r * 0.4, "leaf");
    });
    // Thin palm silhouettes distinguish the formal gardens from a generic park.
    for (const [x, z] of [[-24, -47], [24, -47], [-47, 23], [47, -23], [24, 47], [-24, 47]]) {
      cylinder(0.33, 16, x, 8.6, z, "trunk", 0.23, 7);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(Math.cos(angle) * 2.3, 1.3, Math.sin(angle) * 2.3),
          new THREE.Vector3(Math.cos(angle) * 5.4, -1.9, Math.sin(angle) * 5.4),
        ]);
        add(new THREE.TubeGeometry(curve, 5, 0.42, 4, false), "leafLight", x, 16.5, z);
      }
    }
  });

  inPart("Catedral de referencia", -94, -35, Math.PI / 2, () => {
    box(47, 19, 49, 0, 10, -25, "church");
    box(31, 24, 3.5, 0, 12.5, -0.8, "church");
    box(49, 0.6, 48, 0, 20, -25, "tile");
    roofEdge(47, 49, 0, 20.2, -25);
    // Central portico, deep arched door, pilasters and triangular pediment.
    archedPanel(7.1, 12, 0, 0.7, 1.07, "door");
    archOpening(7.1, 12, 0, 0.7, 1.23, 0.65);
    archOpening(8.7, 13, 0, 0.6, 1.2, 0.35);
    box(0.18, 9, 0.25, 0, 5.2, 1.6, "metal");
    for (const x of [-12.5, -8.8, 8.8, 12.5]) {
      box(0.75, 20, 0.6, x, 10.9, 1.25, "ivory");
      box(1.2, 0.55, 0.9, x, 1, 1.4, "ivory");
      box(1.3, 0.65, 0.9, x, 20.5, 1.4, "ivory");
    }
    window(0, 18, 1.25, 3.2, 4.6);
    box(31, 0.55, 1.3, 0, 14.4, 1.4, "ivory");
    box(32, 0.65, 1.6, 0, 22, 1.3, "ivory");
    const pediment = new THREE.Shape();
    pediment.moveTo(-16, 0); pediment.lineTo(0, 5.8); pediment.lineTo(16, 0); pediment.closePath();
    add(new THREE.ExtrudeGeometry(pediment, { depth: 1, bevelEnabled: false }), "ivory", 0, 22.2, 1.1);
    cross(0, 29, 1.5, 0.7);
    for (const x of [-21.5, 21.5]) {
      box(10.5, 25.5, 10.5, x, 13.2, -1, "church");
      box(8.6, 8, 8.6, x, 30, -1, "church");
      for (const y of [3, 17, 25.7, 34]) box(11.4, 0.65, 11.4, x, y, -1, "ivory");
      archedPanel(3.4, 7.5, x, 17.8, 4.28, "shadow");
      archOpening(3.4, 7.5, x, 17.8, 4.4);
      archedPanel(3.2, 6, x, 26.6, 3.35, "shadow");
      archOpening(3.2, 6, x, 26.6, 3.4);
      cylinder(0.9, 1.7, x, 29, 3.9, "door", 0.5);
      for (const edge of [-1, 1]) {
        box(0.6, 21.5, 0.6, x + edge * 4.3, 14, 4.45, "ivory");
        box(0.55, 6.8, 0.6, x + edge * 3.4, 30, 3.5, "ivory");
      }
      const clock = new THREE.CircleGeometry(1.05, 20);
      add(clock, "ivory", x, 23, 4.85);
      box(0.12, 0.8, 0.15, x, 23.25, 4.97, "metal");
      box(0.65, 0.12, 0.15, x + 0.22, 23, 4.98, "metal");
      dome(x, 35.4, -1, 4.6);
    }
    dome(0, 27, -32, 11.2);
  });

  inPart("Galerías y municipalidad de referencia", 7, -105, 0, () => {
    box(167, 9.3, 28, 0, 15.5, 0, "yellow");
    box(167, 9.8, 20, 0, 5.4, -4, "wall");
    box(167, 0.65, 31, 0, 10.9, 0.5, "ivory");
    roofEdge(167, 29, 0, 20.5, 0);
    for (let i = 0; i < 16; i++) {
      const x = -78 + i * 10.4;
      box(1.25, 10.2, 3, x - 4.55, 5.5, 14.5, "yellow");
      const r = 3.8, spring = 5.4;
      const spandrel = new THREE.Shape();
      spandrel.moveTo(-5.2, 0); spandrel.lineTo(-5.2, 10); spandrel.lineTo(5.2, 10);
      spandrel.lineTo(5.2, 0); spandrel.lineTo(r, 0); spandrel.lineTo(r, spring);
      spandrel.absarc(0, spring, r, 0, Math.PI, false); spandrel.lineTo(-r, 0); spandrel.closePath();
      add(new THREE.ExtrudeGeometry(spandrel, { depth: 1.2, bevelEnabled: false, curveSegments: 12 }), "yellow", x, 0.5, 13.8);
      archOpening(7.6, 9.2, x, 0.5, 15.05, 0.2);
      archedPanel(6, 8.8, x, 0.5, 6.1, "shadow");
      window(x, 15.7, 14.15, 2.5, 4.9);
      if (i % 3 === 0) {
        box(4.5, 0.35, 1.9, x, 12.8, 15.1, "stone");
        box(4.5, 0.1, 0.12, x, 14.1, 16, "metal");
        for (let j = -2; j <= 2; j++) box(0.1, 1.1, 0.1, x + j * 0.8, 13.6, 16, "metal");
      }
    }
    // Raised central gallery with the three large balcony arches.
    box(31, 1.1, 2.8, -30, 20.8, 14.2, "ivory");
    for (const x of [-40, -30, -20]) {
      archedPanel(5.6, 6.9, x, 12, 14.4, "glass");
      archOpening(5.6, 6.9, x, 12, 14.55, 0.5);
    }
    box(31, 0.4, 2.8, -30, 11.8, 15.1, "ivory");
    for (let i = 0; i < 28; i++) box(0.12, 1.2, 0.12, -44 + i, 12.6, 16.3, "metal");
    for (const x of [-48, -12]) box(0.6, 22, 0.7, x, 11.5, 14.8, "ivory");
    for (let i = 0; i < 3; i++) box(1.35, 3.8, 0.08, 6 + i * 1.35, 23.4, 14, i === 1 ? "ivory" : "flag");
    // Roof wells and courtyard walls retain the characteristic open block silhouette.
    for (const x of [-61, 25, 65]) {
      box(18, 0.08, 10, x, 20.8, -1, "shadow");
      for (const edge of [-1, 1]) box(19, 1.7, 0.5, x, 21.6, -1 + edge * 5.5, "ivory");
      for (const edge of [-1, 1]) box(0.5, 1.7, 11, x + edge * 9.5, 21.6, -1, "ivory");
    }
  });

  for (const [index, x, z, w, d, yaw] of [[0, -120, 47, 41, 39, Math.PI / 2], [1, -122, -107, 49, 29, Math.PI / 2]] as const) {
    inPart("Casas del entorno", x, z, yaw, () => {
      box(w, 16.8, d, 0, 8.8, 0, index ? "wall" : "church");
      roofEdge(w, d, 0, 17.5, 0);
      box(w + 0.6, 0.4, 1, 0, 8.3, d / 2, "ivory");
      for (let i = -2; i <= 2; i++) {
        window(i * w / 5.5, 12.1, d / 2 + 0.2, 2.3, 4.1);
        box(2.8, 5.8, 0.3, i * w / 5.5, 3.4, d / 2 + 0.2, "door");
      }
      box(w * 0.45, 0.1, d * 0.35, 0, 17.8, 0, "shadow");
      for (const edge of [-1, 1]) box(w * 0.48, 0.7, 0.35, 0, 18.1, edge * d * 0.19, "ivory");
    });
  }

  inPart("Mobiliario y vida de la plaza", 0, 0, 0, () => {
    const bench = (x: number, z: number, yaw: number) => {
      box(3.8, 0.25, 1, x, 1.1, z, "tile", yaw);
      box(3.8, 1.1, 0.15, x + Math.sin(yaw) * 0.45, 1.7, z + Math.cos(yaw) * 0.45, "tile", yaw);
      for (const edge of [-1, 1]) box(0.16, 0.8, 0.65, x + Math.cos(yaw) * edge * 1.4, 0.65, z - Math.sin(yaw) * edge * 1.4, "metal", yaw);
    };
    for (const side of [-1, 1]) for (const p of [-48, -22, 22, 48]) {
      bench(p, side * 64, side > 0 ? 0 : Math.PI);
      bench(side * 64, p, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    for (const x of [-63, 63]) for (const z of [-57, -28, 0, 28, 57]) {
      cylinder(0.12, 5.8, x, 3.3, z, "metal", 0.08, 7);
      ball(0.4, x, 6.3, z, "ivory");
      cylinder(0.32, 0.15, x, 6.7, z, "metal", 0.05, 8);
    }
    for (const [x, z] of [[-13, -19], [-6, -23], [1, -27]]) {
      cylinder(0.08, 13, x, 7.4, z, "metal", 0.065, 6);
      for (let i = 0; i < 3; i++) box(0.75, 4.2, 0.08, x + 0.4 + i * 0.75, 11, z, i === 1 ? "ivory" : "flag");
    }
    const car = (x: number, z: number, yaw: number, taxi: boolean) => {
      const paint: Paint = taxi ? "taxi" : "ivory";
      box(1.9, 0.75, 4.4, x, 0.9, z, paint, yaw);
      box(1.65, 0.85, 2.15, x, 1.65, z, "glass", yaw);
      box(1.75, 0.2, 1.7, x, 2.13, z, paint, yaw);
      for (const side of [-1, 1]) for (const axle of [-1, 1]) {
        const px = side * 0.91, pz = axle * 1.35;
        ball(0.36, x + px * Math.cos(yaw) + pz * Math.sin(yaw), 0.65, z + pz * Math.cos(yaw) - px * Math.sin(yaw), "metal", 0.45, 1, 1);
      }
    };
    car(78, -38, 0, true); car(-78, 29, 0, true); car(36, 78, Math.PI / 2, false);
    car(-31, -78, Math.PI / 2, true); car(60, 87, Math.PI / 2, true);
    car(-87, -55, 0, false); car(87, 44, 0, false);
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39996, r = 13 + (i * 7 % 44);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // Pedestrians remain on the crossing paths and perimeter walkways.
      const px = i % 2 ? x : Math.sign(x || 1) * 63;
      const pz = i % 2 ? Math.sign(z || 1) * Math.abs(x) : z;
      cylinder(0.18, 0.9, px, 1.22, pz, i % 3 ? "door" : "ivory", 0.23, 5);
      ball(0.22, px, 1.95, pz, "trunk");
    }
  });

  const parts = new Map<string, THREE.Group>();
  for (const { paint, part: name, geometries } of batches.values()) {
    if (!materials.has(paint)) materials.set(paint, new THREE.MeshStandardMaterial({
      color: palette[paint], roughness: paint === "water" ? 0.28 : 0.88,
      metalness: paint === "metal" ? 0.3 : 0,
      side: paint === "flag" ? THREE.DoubleSide : THREE.FrontSide,
    }));
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!geometry) throw Error("No se pudo construir la maqueta de la plaza");
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials.get(paint));
    mesh.name = `${name} · ${paint}`;
    mesh.castShadow = paint !== "water" && paint !== "road" && paint !== "paint";
    mesh.receiveShadow = true;
    mesh.userData.landmarkId = "plaza";
    if (!parts.has(name)) {
      const group = new THREE.Group(); group.name = name;
      parts.set(name, group); root.add(group);
    }
    parts.get(name)!.add(mesh);
  }
  return root;
}
