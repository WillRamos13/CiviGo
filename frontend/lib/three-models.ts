import * as THREE from "three";
import {
  navigationAvatarBase,
  navigationAvatarColor,
  NAVIGATION_VEHICLE_COLORS,
  type NavigationAvatar,
} from "./navigation-avatar";

/** Original low-poly meshes: appearance only; never changes the travel profile. */
export function createNavigationModel(avatar: NavigationAvatar) {
  const group = new THREE.Group();
  const base = navigationAvatarBase(avatar);
  const color =
    NAVIGATION_VEHICLE_COLORS.find(
      (c) => c.id === navigationAvatarColor(avatar),
    )?.hex ?? "#087cff";
  const body = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.18,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#b9e5fb",
    roughness: 0.22,
    metalness: 0.25,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: "#18232f",
    roughness: 0.9,
  });
  const light = new THREE.MeshStandardMaterial({
    color: "#eef8ff",
    emissive: "#b4dbff",
    emissiveIntensity: 0.35,
  });
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const wheel = (x: number, z: number, r = 0.34, width = 0.24) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, width, 12),
      rubber,
    );
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, r, z);
    group.add(mesh);
  };
  if (base === "walking") {
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.65, 3, 8),
      body,
    );
    torso.position.y = 1.2;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), light);
    head.position.y = 2;
    group.add(head);
    box(0.2, 0.8, 0.22, -0.19, 0.45, 0, rubber);
    box(0.2, 0.8, 0.22, 0.19, 0.45, 0.12, rubber);
    box(0.16, 0.65, 0.18, -0.43, 1.2, 0.06, body);
    box(0.16, 0.65, 0.18, 0.43, 1.2, -0.06, body);
  } else if (base === "motorcycle" || base === "bicycle") {
    wheel(0, -0.9, base === "bicycle" ? 0.5 : 0.42, 0.17);
    wheel(0, 0.9, base === "bicycle" ? 0.5 : 0.42, 0.17);
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.07) => {
      const delta = b.clone().sub(a),
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, delta.length(), 8),
          body,
        );
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
      group.add(mesh);
    };
    tube(new THREE.Vector3(0, 0.5, -0.9), new THREE.Vector3(0, 1.1, -0.35));
    tube(new THREE.Vector3(0, 0.5, 0.9), new THREE.Vector3(0, 1.25, 0.65));
    tube(new THREE.Vector3(0, 1.1, -0.35), new THREE.Vector3(0, 1.25, 0.65));
    tube(new THREE.Vector3(0, 0.5, -0.9), new THREE.Vector3(0, 0.55, 0));
    tube(new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(0, 1.25, 0.65));
    box(0.55, 0.12, 0.35, 0, 1.16, -0.35, rubber);
    box(0.85, 0.09, 0.1, 0, 1.4, 0.65, rubber);
    if (base === "motorcycle") box(0.5, 0.5, 0.8, 0, 0.75, 0.05, body);
  } else if (base === "arrow") {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.8);
    shape.lineTo(-0.9, -1.15);
    shape.lineTo(0, -0.65);
    shape.lineTo(0.9, -1.15);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.28,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 1,
      steps: 1,
    });
    const mesh = new THREE.Mesh(geometry, body);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.32;
    group.add(mesh);
  } else {
    const suv = base === "suv",
      sport = base === "sport",
      compact = base === "compact";
    const length = compact ? 3.5 : suv ? 4.65 : 4.4,
      width = suv ? 2 : 1.8,
      height = suv ? 0.8 : 0.6;
    box(width, height, length, 0, 0.7, 0, body);
    box(
      width * 0.8,
      suv ? 0.8 : sport ? 0.44 : 0.63,
      length * 0.5,
      0,
      suv ? 1.4 : 1.15,
      -0.15,
      glass,
    );
    box(
      width * 0.85,
      0.09,
      length * 0.44,
      0,
      suv ? 1.84 : sport ? 1.41 : 1.51,
      -0.2,
      body,
    );
    for (const x of [-width / 2, width / 2])
      for (const z of [-length * 0.31, length * 0.31])
        wheel(x, z, suv ? 0.4 : 0.34);
    for (const x of [-width * 0.32, width * 0.32])
      box(0.35, 0.17, 0.08, x, 0.75, length / 2 + 0.02, light);
    if (sport) box(width * 0.9, 0.1, 0.3, 0, 1.2, -length * 0.42, rubber);
  }
  // A soft contact shadow avoids an expensive extra shadow pass on phones.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(base === "walking" ? 0.65 : 1.7, 18),
    new THREE.MeshBasicMaterial({
      color: "#001221",
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);
  group.userData.avatar = avatar;
  const used = new Set<THREE.Material>();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh)
      (Array.isArray(child.material)
        ? child.material
        : [child.material]
      ).forEach((m) => used.add(m));
  });
  [body, glass, rubber, light]
    .filter((m) => !used.has(m))
    .forEach((m) => m.dispose());
  return group;
}

export function disposeThreeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Line
    ) {
      geometries.add(child.geometry);
      (Array.isArray(child.material)
        ? child.material
        : [child.material]
      ).forEach((material) => materials.add(material));
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
