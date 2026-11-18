import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const ICA_MUSEUM_REFERENCES = [
  { label: "Fachada y ficha del Ministerio de Cultura", url: "https://museos.cultura.pe/museos/museo-regional-de-ica-adolfo-berm%C3%BAdez-jenkins" },
  { label: "Ingreso y patios en la reapertura de 2023", url: "https://elperuano.pe/noticia/220335-museo-regional-de-ica-inaugura-hoy-sus-renovadas-instalaciones" },
  { label: "Huella del museo · OpenStreetMap", url: "https://www.openstreetmap.org/way/364396783" },
] as const;

const paint = {
  wall: "#d5b365", frame: "#e3c57a", inner: "#baa667", stone: "#c7bfab", roof: "#b3afa4",
  concrete: "#aaa7a0", asphalt: "#82817e", glass: "#324655", glassHigh: "#53636a", metal: "#78817f",
  door: "#653131", interior: "#222822", letters: "#342f22", curb: "#c5a246", clay: "#805746",
  clayLip: "#9d7662", soil: "#776a4b", bark: "#645344", foliage: "#5c6c50", foliageDark: "#4a5a43",
  flower: "#99566d", flowerPink: "#b9758d", white: "#e1dfca",
};
type Surface = keyof typeof paint;
type Point = readonly [number, number, number];

const glyphs: Record<string, string> = {
  A: "0,0 2,5 4,0;1,2 3,2", B: "0,0 0,5 3,5 4,4 4,3 3,2.5 0,2.5;3,2.5 4,2 4,1 3,0 0,0",
  C: "4,4 3,5 1,5 0,4 0,1 1,0 3,0 4,1", D: "0,0 0,5 3,5 4,4 4,1 3,0 0,0",
  E: "4,0 0,0 0,5 4,5;0,2.5 3.3,2.5", F: "0,0 0,5 4,5;0,2.5 3.3,2.5",
  G: "4,4 3,5 1,5 0,4 0,1 1,0 3,0 4,1 4,2.5 2.2,2.5", I: "0,0 4,0;2,0 2,5;0,5 4,5",
  J: "0,1 1,0 3,0 4,1 4,5;1,5 4,5", K: "0,0 0,5;4,5 0,2.3 4,0", L: "0,5 0,0 4,0",
  M: "0,0 0,5 2,2.7 4,5 4,0", N: "0,0 0,5 4,0 4,5", O: "1,0 0,1 0,4 1,5 3,5 4,4 4,1 3,0 1,0",
  R: "0,0 0,5 3,5 4,4 4,3.2 3,2.5 0,2.5;2,2.5 4,0", S: "4,4 3,5 1,5 0,4 0,3 4,2 4,1 3,0 1,0 0,1",
  T: "0,5 4,5;2,5 2,0", U: "0,5 0,1 1,0 3,0 4,1 4,5", Z: "0,5 4,5 0,0 4,0",
};

/** The mapped exterior envelope, with the Ayabaca entrance modelled from photographs in metres. */
export function createIcaMuseum(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Museo Regional de Ica";
  const frontYaw = Math.atan2(-0.0115, -1);
  root.rotation.y = frontYaw;
  root.userData = { landmarkId: "museo", units: "metres", frontYaw, references: ICA_MUSEUM_REFERENCES };
  let section = "Ingreso de Ayabaca";
  const batches = new Map<string, Map<Surface, THREE.BufferGeometry[]>>();

  function add(surface: Surface, buffer: THREE.BufferGeometry, [x, y, z]: Point) {
    buffer.translate(x, y, z);
    const geometry = buffer.index ? buffer.toNonIndexed() : buffer;
    if (buffer !== geometry) buffer.dispose();
    geometry.deleteAttribute("uv");
    const surfaces = batches.get(section) ?? new Map<Surface, THREE.BufferGeometry[]>();
    batches.set(section, surfaces);
    const pieces = surfaces.get(surface) ?? [];
    pieces.push(geometry);
    surfaces.set(surface, pieces);
  }
  const box = (surface: Surface, width: number, height: number, depth: number, point: Point) =>
    add(surface, new THREE.BoxGeometry(width, height, depth), point);
  const rect = (surface: Surface, x0: number, x1: number, y0: number, y1: number, z: number, depth = 0.15) =>
    box(surface, x1 - x0, y1 - y0, depth, [(x0 + x1) / 2, (y0 + y1) / 2, z]);

  function branch(surface: Surface, start: Point, end: Point, radius: number, tip: number, sides = 7) {
    const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const centre = from.clone().add(to).multiplyScalar(0.5);
    const segment = new THREE.CylinderGeometry(tip, radius, direction.length(), sides);
    segment.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    add(surface, segment, [centre.x, centre.y, centre.z]);
  }
  function signage(content: string, x: number, y: number, z: number, maxWidth: number, height: number) {
    const advance = maxWidth / content.length;
    for (const [i, character] of [...content].entries()) {
      const base = character.normalize("NFD")[0];
      const strokes = glyphs[base]?.split(";") ?? [];
      if (character === "Ú") strokes.push("2,5.7 3,6.6");
      for (const stroke of strokes) {
        const points = stroke.split(" ").map(text => text.split(",").map(Number));
        for (let j = 1; j < points.length; j++) {
          const [ax, ay] = points[j - 1], [bx, by] = points[j];
          const dx = (bx - ax) * advance / 5, dy = (by - ay) * height / 5;
          const ink = new THREE.BoxGeometry(Math.hypot(dx, dy) + height * 0.055, height * 0.094, 0.027);
          ink.rotateZ(Math.atan2(dy, dx));
          add("letters", ink, [x - maxWidth / 2 + i * advance + (ax + bx) * advance / 10, y + (ay + by) * height / 10, z]);
        }
      }
    }
  }

  const front = 27.6, recess = 25.23, top = 7.43;
  const mainLeft = -8.37, mainRight = -1.29;
  const ministryLeft = 7.08, ministryRight = 9.74;

  // The exterior volume is based on the outline. Door and window openings remain genuinely recessed.
  box("wall", 38.4, 7.1, 51.35, [0, 3.8, -2.65]);
  box("roof", 38.42, 0.19, 54.84, [0, 7.28, 0.29]);
  rect("frame", -19.2, 19.2, top - 0.61, top, front - 0.30, 0.8);
  rect("wall", -19.2, mainLeft, 0.28, 3.59, front - 0.22, 0.49);
  rect("wall", mainRight, ministryLeft, 0.28, 3.59, front - 0.22, 0.49);
  rect("wall", ministryRight, 19.2, 0.28, 3.59, front - 0.22, 0.49);
  rect("wall", ministryLeft, ministryRight, 2.48, 3.63, front - 0.22, 0.49);
  rect("frame", -19.2, -17.78, 3.58, top - 0.61, front - 0.21, 0.51);
  rect("frame", -10.18, mainLeft, 3.58, top - 0.61, front - 0.21, 0.51);
  rect("frame", mainRight, -0.64, 3.58, top - 0.61, front - 0.21, 0.51);
  rect("frame", 6.45, 6.95, 3.58, top - 0.61, front - 0.21, 0.51);
  rect("wall", 14.12, 19.2, 3.58, top - 0.61, front - 0.21, 0.51);
  rect("inner", -17.78, -10.18, 3.57, top - 0.61, front - 0.27, 0.25);

  for (const [left, right] of [[-0.64, 6.45], [6.95, 14.12]]) {
    rect("wall", left, right, 3.59, 5.91, front - 0.20, 0.27);
    rect("inner", left, right, 5.91, 6.43, front - 0.25, 0.14);
    rect("glass", left + 0.15, right - 0.15, 5.93, 6.33, front - 0.15, 0.052);
    rect("frame", left, right, 6.43, top - 0.61, front - 0.21, 0.51);
    rect("stone", left + 0.13, right - 0.13, 5.93, 5.98, front - 0.11, 0.055);
    for (const division of [0.22, 0.43, 0.67, 0.88]) {
      const x = THREE.MathUtils.lerp(left, right, division);
      rect("metal", x - 0.022, x + 0.022, 5.98, 6.32, front - 0.11, 0.055);
    }
  }

  // White interior of the two-level portal, divided by the stone museum sign.
  const entryMiddle = (mainLeft + mainRight) / 2;
  for (const edge of [mainLeft + 0.13, mainRight - 0.13]) {
    box("stone", 0.26, 6.77, front - recess, [edge, 3.68, (front + recess) / 2]);
  }
  box("inner", mainRight - mainLeft, 0.18, front - recess, [entryMiddle, 6.82, (front + recess) / 2]);
  rect("stone", mainLeft, mainRight, 2.87, 3.60, front - 0.03, 0.42);
  rect("frame", mainLeft, mainRight, 3.25, 3.58, front + 0.12, 0.10);
  rect("stone", mainLeft + 0.24, mainRight - 0.24, 2.18, 2.86, recess + 0.13);
  rect("glass", mainLeft + 0.25, mainRight - 0.21, 3.56, 5.84, recess + 0.15);
  rect("glassHigh", mainLeft + 0.25, mainRight - 0.21, 5.23, 5.85, recess + 0.23, 0.06);
  rect("metal", mainLeft + 0.25, mainRight - 0.21, 5.20, 5.26, recess + 0.28, 0.07);
  rect("stone", mainLeft + 0.23, mainRight - 0.19, 5.83, 6.78, recess + 0.20, 0.10);
  for (let i = 1; i < 7; i++) {
    const x = THREE.MathUtils.lerp(mainLeft + 0.23, mainRight - 0.21, i / 7);
    rect("metal", x - 0.023, x + 0.023, 3.59, 5.85, recess + 0.27, 0.07);
  }
  rect("interior", -7.98, -5.61, 0.28, 2.21, recess + 0.08);
  rect("stone", -5.15, mainRight - 0.22, 0.27, 2.20, recess + 0.12);
  rect("door", -5.65, -5.15, 0.26, 2.22, recess + 0.23, 0.08);
  rect("door", -8.11, -7.99, 0.26, 2.25, recess + 0.22, 0.08);
  rect("glassHigh", mainLeft + 0.28, mainRight - 0.25, 2.34, 2.67, recess + 0.25, 0.08);
  for (const x of [-7.33, -6.01, -4.82, -3.39, -2.17]) rect("metal", x - 0.02, x + 0.02, 2.35, 2.67, recess + 0.31, 0.07);

  const ministryMiddle = (ministryLeft + ministryRight) / 2;
  rect("interior", ministryLeft, ministryRight, 0.35, 2.45, front - 1.23, 0.10);
  for (const wall of [ministryLeft + 0.06, ministryRight - 0.06]) {
    box("door", 0.12, 2.16, 1.30, [wall, 1.38, front - 0.64]);
  }
  rect("door", ministryLeft, ministryRight, 2.43, 2.51, front - 0.54, 0.80);
  rect("stone", 3.58, 4.49, 1.47, 1.87, front + 0.055, 0.035);
  rect("white", 10.91, 12.00, 1.02, 2.75, front + 0.054, 0.032);
  signage("MUSEO REGIONAL DE ICA", entryMiddle, 3.30, front + 0.198, 5.95, 0.25);
  signage("ADOLFO BERMÚDEZ JENKINS", entryMiddle, 2.97, front + 0.198, 5.85, 0.20);
  signage("MINISTERIO DE CULTURA", ministryMiddle, 3.21, front + 0.053, 7.45, 0.29);
  signage("ICA", ministryMiddle, 2.80, front + 0.053, 1.01, 0.29);

  section = "Cubierta y costados";
  // Small raised daylight volume and the pale curved side return visible from the forecourt.
  box("white", 4.71, 0.89, 3.83, [2.53, 7.72, 17.24]);
  box("glass", 4.08, 0.32, 0.055, [2.53, 7.66, 19.17]);
  for (const x of [1.03, 2.63, 4.11]) box("metal", 0.045, 0.33, 0.04, [x, 7.66, 19.21]);
  const curve = new THREE.Shape();
  curve.moveTo(0, 0);
  curve.lineTo(0, 2.45);
  curve.quadraticCurveTo(2.73, 2.05, 2.78, 0);
  curve.closePath();
  for (const [y, height, surface] of [[0.31, 1.43, "white"], [1.74, 1.03, "glass"], [2.77, 4.55, "white"]] as const) {
    const geometry = new THREE.ExtrudeGeometry(curve, { depth: height, bevelEnabled: false, curveSegments: 12 });
    add(surface, geometry.rotateX(-Math.PI / 2), [18.91, y, front + 1.67]);
  }
  branch("interior", [13.11, 7.37, 14.23], [13.11, 8.41, 14.23], 0.61, 0.55, 12);

  section = "Atrio y acceso";
  box("concrete", 46.4, 0.40, 75.6, [0, -0.21, 4.5]);
  box("asphalt", 45.8, 0.09, 13.55, [0, 0.04, 35.45]);
  box("concrete", 42.5, 0.15, 3.42, [-0.35, 0.08, front + 1.49]);
  box("curb", 42.5, 0.12, 0.23, [-0.35, 0.15, front + 3.24]);
  box("stone", 7.32, 0.23, 2.17, [entryMiddle, 0.18, front + 0.22]);
  box("stone", 6.78, 0.17, 2.27, [entryMiddle, 0.165, (front + recess) / 2]);
  box("stone", 3.10, 0.11, 1.2, [ministryMiddle, 0.17, front + 0.35]);
  const ramp = new THREE.BoxGeometry(1.18, 0.12, 2.49).rotateX(-0.12);
  add("concrete", ramp, [-7.15, 0.20, front + 1.99]);
  const railX = -6.53;
  branch("metal", [railX, 0.85, front + 0.62], [railX, 0.57, front + 3.13], 0.045, 0.045);
  branch("metal", [railX, 0.26, front + 1.10], [railX, 0.8, front + 1.10], 0.038, 0.038);
  branch("metal", [railX, 0.17, front + 2.89], [railX, 0.59, front + 2.89], 0.038, 0.038);
  for (let i = 0; i < 6; i++) {
    const mark = new THREE.PlaneGeometry(0.065, 3.85).rotateX(-Math.PI / 2).rotateY(-0.12);
    add("concrete", mark, [-17 + i * 3.3, 0.094, front + 7.60]);
  }
  box("concrete", 0.73, 0.17, 0.73, [-9.81, 0.15, front + 5.10]);
  branch("white", [-9.81, 0.24, front + 5.10], [-9.81, 10.82, front + 5.10], 0.06, 0.042, 9);

  for (const [x, scale, depth] of [[-4.62, 1.01, 0.61], [-2.79, 1.11, 0.71]]) {
    const pot = [[0.05, 0], [0.17, 0.08], [0.35, 0.31], [0.45, 0.58], [0.36, 0.84], [0.25, 0.94],
      [0.245, 1.01], [0.195, 1.01], [0.195, 0.93], [0.31, 0.81], [0.39, 0.58], [0.29, 0.33], [0.06, 0.1]];
    const contours = pot.map(([r, y]) => new THREE.Vector2(r * scale, y * scale));
    add("clay", new THREE.LatheGeometry(contours, 26), [x, 0.30, front - depth]);
    add("clayLip", new THREE.TorusGeometry(0.222 * scale, 0.027, 7, 25).rotateX(-Math.PI / 2), [x, 0.30 + 1.01 * scale, front - depth]);
  }

  section = "Jardín de la fachada";
  box("soil", 5.43, 0.09, 2.34, [-17.05, 0.10, front + 2.13]);
  box("soil", 33.6, 0.10, 0.82, [0.26, 0.13, front + 0.51]);
  const nativeTree: Point = [-16.72, 0.20, front + 2.20];
  const fork: Point = [-16.96, 2.02, front + 1.84];
  branch("bark", nativeTree, fork, 0.35, 0.25, 11);
  for (const [index, [targetX, targetY, targetZ]] of [[-19.22, 4.88, 30.29], [-18.22, 5.48, 28.81], [-15.08, 5.95, 30.53], [-14.04, 5.08, 29.91], [-15.20, 7.38, 29.12]].entries()) {
    const crest: Point = [targetX, targetY, targetZ];
    branch("bark", fork, crest, 0.18, 0.048);
    for (let j = 0; j < 11; j++) {
      const phase = index * 6.31 + j * 2.399;
      const spread = 1.10 + 0.17 * j;
      const x = targetX + Math.cos(phase) * spread;
      const y = targetY + 0.38 + Math.sin(phase * 1.8) * 0.75;
      const z = targetZ + Math.sin(phase) * spread * 0.61;
      const twigEnd: Point = [x, y, z];
      branch("bark", crest, twigEnd, 0.033, 0.009, 5);
      const canopy = new THREE.IcosahedronGeometry(0.86 + (j % 4) * 0.16, 1).scale(1.25, 0.53, 0.94);
      add(j % 3 === 0 ? "foliageDark" : "foliage", canopy, twigEnd);
    }
  }

  for (const [index, [x, height]] of [[-10.43, 2.67], [0.18, 1.77], [4.32, 2.23], [14.73, 3.15], [16.78, 4.42], [18.07, 2.85]].entries()) {
    const tendril: Point = [x + (index % 2 === 0 ? 0.45 : -0.38), height, front + 0.17];
    branch("bark", [x, 0.23, front + 0.57], tendril, 0.045, 0.014, 5);
    for (let i = 0; i < 15; i++) {
      const y = height * (0.45 + (i / 15) * 0.53);
      const twirl = Math.sin(i * 2.35 + index * 1.2);
      const location: Point = [tendril[0] + twirl * 0.52, y, front + 0.20 + (i % 3) * 0.094];
      const leaf = new THREE.IcosahedronGeometry(0.16 + 0.08 * (i % 3), 0).scale(1.60, 1.0, 0.51);
      add(i % 5 === 0 ? "flowerPink" : i % 4 === 0 ? "flower" : "foliage", leaf, location);
    }
  }
  for (let i = 0; i < 49; i++) {
    const x = -17.3 + i * 0.72;
    if (x > -8.3 && x < -1.0 || x > 6.7 && x < 9.9) continue;
    const z = front + 0.56 + Math.cos(i * 2.47) * 0.10;
    const y = 0.24 + 0.015 * (i % 5);
    const leaf = new THREE.IcosahedronGeometry(0.23 + 0.047 * (i % 4), 1).scale(1.42, 0.66, 0.83);
    add(i % 3 ? "foliage" : "foliageDark", leaf, [x, y, z]);
  }

  const materials = new Map<Surface, THREE.MeshStandardMaterial>();
  for (const [name, surfaces] of batches) {
    const group = new THREE.Group();
    group.name = name;
    for (const [surface, parts] of surfaces) {
      const geometry = mergeGeometries(parts);
      parts.forEach(item => item.dispose());
      if (!geometry) throw new Error(`No se pudo construir la superficie ${surface} del museo`);
      const glazed = surface === "glass" || surface === "glassHigh";
      const material = materials.get(surface) ?? new THREE.MeshStandardMaterial({ color: paint[surface], roughness: glazed ? 0.38 : 0.88 });
      materials.set(surface, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = surface;
      mesh.userData.landmarkId = "museo";
      mesh.castShadow = surface !== "asphalt" && surface !== "soil";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    root.add(group);
  }
  return root;
}
