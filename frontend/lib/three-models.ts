import * as THREE from "three";
import {
  navigationAvatarBase,
  navigationAvatarColor,
  NAVIGATION_VEHICLE_COLORS,
  type NavigationAvatar,
} from "./navigation-avatar";
import { createVehicleModel } from "./vehicle-models";

/** The model controls appearance while the route keeps its chosen transport. */
export function createNavigationModel(avatar: NavigationAvatar, { contactShadow = true } = {}) {
  const group = new THREE.Group();
  const base = navigationAvatarBase(avatar);
  const color =
    NAVIGATION_VEHICLE_COLORS.find(
      (c) => c.id === navigationAvatarColor(avatar),
    )?.hex ?? "#087cff";
  const vehicle = createVehicleModel(base, color);
  if (vehicle) group.add(vehicle);
  const body = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.18,
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
  if (!vehicle && base === "walking") {
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
  } else if (!vehicle) {
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
  }
  // A soft contact shadow avoids an expensive extra shadow pass on phones.
  if (contactShadow) {
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
  }
  group.userData.avatar = avatar;
  const used = new Set<THREE.Material>();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh)
      (Array.isArray(child.material)
        ? child.material
        : [child.material]
      ).forEach((m) => used.add(m));
  });
  [body, rubber, light]
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
