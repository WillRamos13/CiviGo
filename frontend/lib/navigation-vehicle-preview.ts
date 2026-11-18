import * as THREE from "three";
import type { NavigationAvatar } from "./navigation-avatar";
import { createNavigationModel, disposeThreeObject } from "./three-models";

type PreviewAngle = "picker" | "map";
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let canRender = true;

function previewRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setSize(128, 128, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  clearTimeout(idle);
  idle = setTimeout(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = undefined;
  }, 1000);
  return renderer;
}

/** Both map and picker previews are renders of the same mesh used in 3D navigation. */
export function vehiclePreview(avatar: NavigationAvatar, angle: PreviewAngle): string | null {
  const key = `${angle}/${avatar}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!canRender) return null;

  const scene = new THREE.Scene();
  try {
    const view = previewRenderer();
    const model = createNavigationModel(avatar, { contactShadow: false });
    scene.add(model);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const offset = angle === "map" ? new THREE.Vector3(0, 7, -5) : new THREE.Vector3(5, 5, 7);
    const forward = offset.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
    const up = forward.cross(right);
    const size = bounds.getSize(new THREE.Vector3());
    const span = (axis: THREE.Vector3) =>
      size.x * Math.abs(axis.x) + size.y * Math.abs(axis.y) + size.z * Math.abs(axis.z);
    const extent = Math.max(span(right), span(up)) * 0.56;
    const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 80);
    camera.position.copy(center).add(offset);
    camera.lookAt(center);
    scene.add(new THREE.HemisphereLight("#ecf6ff", "#335075", 2.3));
    const keyLight = new THREE.DirectionalLight("#fff2df", 3);
    keyLight.position.set(-4, 7, 5);
    const rim = new THREE.DirectionalLight("#90bbff", 1.2);
    rim.position.set(4, 3, -4);
    scene.add(keyLight, rim);
    view.render(scene, camera);
    const url = view.domElement.toDataURL("image/png");
    if (!url.startsWith("data:image/png;base64,")) return null;
    cache.set(key, url);
    return url;
  } catch {
    canRender = false;
    return null;
  } finally {
    disposeThreeObject(scene);
  }
}
