import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CITY_LANDMARKS,
  CitySelection,
  cityPosition,
  type CitySceneData,
  type LandmarkId,
  type CityPoint,
} from "@/lib/city-scene";
import { disposeThreeObject } from "@/lib/three-models";
import { createHuacachinaModel } from "./create-huacachina-model";
import { createIcaArchitecture } from "./create-ica-architecture";
import { createPlazaModel } from "./create-plaza-model";
import { frameModel, modelFramingPoints } from "@/lib/three-framing";

type LandmarkModel = {
  root: THREE.Group;
  visual: THREE.Group;
  anchor: THREE.Vector3;
  overview: THREE.Group;
  detail?: {
    scale: number;
    framing: THREE.Vector3[];
    frontYaw: number;
  };
};

const VIEW_ELEVATION: Record<LandmarkId, number> = {
  plaza: 37,
  huacachina: 36,
  catedral: 23,
  luren: 23,
  museo: 19,
};

export type IcaCityController = {
  select(id: LandmarkId | null): void;
  rotate(delta: number): void;
  zoom(delta: number): void;
  setPaused(value: boolean): void;
  setVisible(value: boolean): void;
  dispose(): void;
};
export function createIcaCity(
  host: HTMLElement,
  data: CitySceneData,
  onSelect: (id: LandmarkId) => void,
  onLost: () => void,
  initialSelection: LandmarkId | null = null,
): IcaCityController {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: host.clientWidth > 700,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  renderer.setClearColor("#031021", 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.05, 350),
    selection = new CitySelection();
  const overview = new THREE.Vector3(33, 43, 45),
    look = new THREE.Vector3(0, 0, 0);
  camera.position.copy(overview);
  camera.lookAt(look);
  const ambient = new THREE.AmbientLight("#7695c4", 2.5);
  scene.add(ambient);
  const reflectedLight = new THREE.HemisphereLight("#eaf5ff", "#ad8a68", 0);
  scene.add(reflectedLight);
  const sunlight = new THREE.DirectionalLight("#d8efff", 4.4);
  sunlight.position.set(-25, 55, 15);
  sunlight.shadow.mapSize.setScalar(host.clientWidth < 700 ? 1024 : 2048);
  Object.assign(sunlight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 70 });
  sunlight.shadow.bias = -0.0001;
  sunlight.shadow.normalBias = 0.013;
  sunlight.shadow.radius = 2;
  scene.add(sunlight.target);
  scene.add(sunlight);
  const rim = new THREE.DirectionalLight("#087cff", 3);
  rim.position.set(25, 12, -30);
  scene.add(rim);
  const environment = new THREE.Group();
  scene.add(environment);
  const material = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.12 });
  const buildingMaterial = material("#184d7c"),
    parkMaterial = material("#1b5d6b"),
    waterMaterial = material("#086da5"),
    landmarkMaterial = material("#3c9bdf");
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(56, 0.24, 43),
    material("#061b32"),
  );
  ground.position.y = -0.16;
  environment.add(ground);
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: "#63bcff",
    transparent: true,
    opacity: 0.72,
  });
  const roadPositions: number[] = [];
  for (const road of data.roads)
    for (let i = 1; i < road.length; i++)
      roadPositions.push(
        road[i - 1][0],
        0.015,
        road[i - 1][1],
        road[i][0],
        0.015,
        road[i][1],
      );
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(roadPositions, 3),
  );
  environment.add(
    new THREE.LineSegments(
      roadGeometry,
      new THREE.LineBasicMaterial({
        color: "#286a9b",
        transparent: true,
        opacity: 0.62,
      }),
    ),
  );
  const landmarkIds = new Set(CITY_LANDMARKS.map((item) => item.osmId)),
    ordinary: THREE.BufferGeometry[] = [];
  const shape = (ring: CityPoint[]) => {
    const polygon = new THREE.Shape();
    ring.forEach(([x, z], i) => {
      if (i) polygon.lineTo(x, -z);
      else polygon.moveTo(x, -z);
    });
    polygon.closePath();
    return polygon;
  };
  const extrude = (ring: CityPoint[], height: number) => {
    const geometry = new THREE.ExtrudeGeometry(shape(ring), {
      depth: height,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  };
  for (const footprint of data.footprints) {
    if (landmarkIds.has(footprint.osmId)) continue;
    const height = Math.max(0.035, footprint.height / data.metersPerUnit);
    const geometry = extrude(footprint.ring, height);
    if (footprint.kind === "building") ordinary.push(geometry);
    else
      environment.add(
        new THREE.Mesh(
          geometry,
          footprint.kind === "water" ? waterMaterial : parkMaterial,
        ),
      );
  }
  if (ordinary.length) {
    const merged = mergeGeometries(ordinary, false);
    if (merged) environment.add(new THREE.Mesh(merged, buildingMaterial));
    ordinary.forEach((g) => g.dispose());
  }
  const models = new Map<LandmarkId, LandmarkModel>();
  const selectable: THREE.Object3D[] = [];
  for (const landmark of CITY_LANDMARKS) {
    const footprint = data.footprints.find((f) => f.osmId === landmark.osmId);
    if (!footprint) continue;
    const center = cityPosition(
        landmark.longitud,
        landmark.latitud,
        data.origin,
        data.metersPerUnit,
      ),
      anchor = new THREE.Vector3(center[0], 0, center[1]);
    const root = new THREE.Group(),
      visual = new THREE.Group(),
      outline = new THREE.Group();
    root.position.copy(anchor);
    root.add(outline, visual);
    scene.add(root);
    const local = footprint.ring.map(
      ([x, z]) => [x - anchor.x, z - anchor.z] as CityPoint,
    );
    const height = Math.max(0.045, footprint.height / data.metersPerUnit);
    const geometry = extrude(local, height),
      mesh = new THREE.Mesh(
        geometry,
        footprint.kind === "water"
          ? waterMaterial
          : footprint.kind === "park"
            ? parkMaterial
            : landmarkMaterial,
      );
    mesh.userData.landmarkId = landmark.id;
    selectable.push(mesh);
    outline.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geometry), outlineMaterial));
    const base = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        footprint.ring.map(([x, z]) => new THREE.Vector3(x, 0.03, z)),
      ),
      new THREE.LineBasicMaterial({
        color: "#248cdb",
        transparent: true,
        opacity: 0.38,
      }),
    );
    environment.add(base);
    models.set(landmark.id, { root, visual, anchor, overview: outline });
  }
  const prepareDetail = (id: LandmarkId) => {
    const item = models.get(id);
    if (!item || item.detail) return item;
    const model = id === "plaza" ? createPlazaModel()
      : id === "huacachina" ? createHuacachinaModel(data, item.anchor)
      : createIcaArchitecture(id);
    if (!model?.children.length) return item;
    model.scale.setScalar(1 / data.metersPerUnit);
    item.visual.add(model);
    const framing = modelFramingPoints(model, item.anchor);
    if (!framing.length) {
      model.removeFromParent();
      disposeThreeObject(model);
      return item;
    }
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.userData.landmarkId = id;
        selectable.push(child);
      }
    });
    const size = new THREE.Box3().setFromPoints(framing).getSize(new THREE.Vector3());
    item.detail = {
      framing,
      scale: THREE.MathUtils.clamp(9 / Math.max(size.x, size.y, size.z), 1, 16),
      frontYaw: Number.isFinite(model.userData.frontYaw) ? model.userData.frontYaw : 0.65,
    };
    return item;
  };
  const pathData = data.roads
    .filter((points) => points.length > 3 && points.length < 30)
    .slice(0, 3);
  const trafficGeometry = new THREE.BoxGeometry(0.035, 0.025, 0.08);
  const trafficMaterials = [
    new THREE.MeshBasicMaterial({ color: "#55abf5" }),
    new THREE.MeshBasicMaterial({ color: "#52dbd3" }),
  ];
  const cars = pathData.map((points, index) => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++)
      path.add(
        new THREE.LineCurve3(
          new THREE.Vector3(points[i - 1][0], 0.045, points[i - 1][1]),
          new THREE.Vector3(points[i][0], 0.045, points[i][1]),
        ),
      );
    const car = new THREE.Mesh(trafficGeometry, trafficMaterials[index % 2]);
    environment.add(car);
    return { car, path };
  });
  if (initialSelection) {
    selection.select(initialSelection);
    for (let i = 0; i < 20; i++) selection.tick(0.1);
  }
  let disposed = false,
    lost = false,
    paused = false,
    visible = true,
    frame = 0,
    last = 0,
    elapsed = 0,
    orbit = 0.2,
    elevationOffset = 0,
    zoom = 1,
    dirty = true;
  let drag: { x: number; y: number; lastX: number; lastY: number } | null = null;
  const pointer = new THREE.Vector2(),
    raycaster = new THREE.Raycaster(),
    vertical = new THREE.Vector3(0, 1, 0);
  const draw = () => {
    if (!disposed && !lost) renderer.render(scene, camera);
  };
  const active = () => !disposed && !lost && visible && !document.hidden;
  const moving = () =>
    (!paused && !selection.active) ||
    selection.requested !== selection.active ||
    (!!selection.active && selection.progress < 1);
  const animate = (time: number) => {
    frame = 0;
    if (!active()) {
      last = 0;
      return;
    }
    if (!last || time - last >= 33) {
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0.033;
      last = time;
      if (!paused) elapsed += dt;
      const state = selection.tick(dt);
      host.dataset.selectionPhase = state.phase;
      host.dataset.selectedLandmark = state.active ?? "";
      const selected = state.active ? prepareDetail(state.active) : undefined;
      const detail = selected?.detail;
      const detailFocused = Boolean(detail && state.eased > 0.45);
      const angle = detail ? detail.frontYaw + 0.45 : 0;
      environment.visible = !detailFocused;
      for (const [id, item] of models) {
        item.root.visible = !detailFocused || state.active === id;
        item.visual.visible = state.active === id && !!item.detail;
        item.overview.visible = !item.visual.visible;
      }
      sunlight.castShadow = detailFocused;
      ambient.intensity = detailFocused ? 0 : 2.5;
      reflectedLight.intensity = detailFocused ? 1.35 : 0;
      sunlight.color.set(detailFocused ? "#fff3df" : "#d8efff");
      sunlight.intensity = detailFocused ? 2.45 : 4.4;
      rim.intensity = detailFocused ? 0 : 3;
      if (detailFocused && selected) {
        const sunlightAzimuth = angle - 0.7;
        sunlight.position.set(
          selected.anchor.x + Math.sin(sunlightAzimuth) * 16,
          20,
          selected.anchor.z + Math.cos(sunlightAzimuth) * 16,
        );
        sunlight.target.position.set(selected.anchor.x, 5, selected.anchor.z);
        renderer.shadowMap.needsUpdate = true;
      } else {
        sunlight.position.set(-25, 55, 15);
        sunlight.target.position.set(0, 0, 0);
      }
      for (const [id, item] of models) {
        const focus = state.active === id ? state.eased : 0;
        const expansion = THREE.MathUtils.smoothstep(focus, 0.15, 1),
          turn = THREE.MathUtils.smoothstep(focus, 0.45, 1);
        item.visual.position.set(0, focus * 4.5, 0);
        item.visual.scale.setScalar(1 + ((item.detail?.scale ?? 1) - 1) * expansion);
        item.visual.rotation.y = turn * orbit;
      }
      host.dataset.liftedModels = String(
        [...models.values()].filter((item) => item.visual.position.y > 0.001)
          .length,
      );
      const fade = selected ? 1 - state.eased * 0.48 : 1;
      buildingMaterial.color.setRGB(0.04 * fade, 0.18 * fade, 0.34 * fade);
      if (selected && detail && state.active) {
        const elevation = THREE.MathUtils.degToRad(
          THREE.MathUtils.clamp(VIEW_ELEVATION[state.active] + elevationOffset, 13, 65),
        );
        const direction = new THREE.Vector3(
          Math.sin(angle) * Math.cos(elevation), Math.sin(elevation), Math.cos(angle) * Math.cos(elevation),
        );
        const points = detail.framing.map((point) => point.clone()
          .multiplyScalar(detail.scale).applyAxisAngle(vertical, orbit));
        const framed = frameModel(points, direction, camera.fov, camera.aspect);
        const target = selected.anchor.clone().addScaledVector(vertical, 4.5).add(framed.center);
        const eye = target.clone().addScaledVector(direction, framed.distance * zoom);
        camera.position.lerpVectors(overview, eye, state.eased);
        look.lerpVectors(new THREE.Vector3(), target, state.eased);
      } else {
        camera.position.copy(overview);
        look.set(0, 0, 0);
      }
      camera.lookAt(look);
      if (!paused && !selected)
        cars.forEach(({ car, path }, index) => {
          const t = (elapsed * 0.035 + index * 0.3) % 1;
          car.position.copy(path.getPointAt(t));
          const tangent = path.getTangentAt(t);
          car.rotation.y = Math.atan2(tangent.x, tangent.z);
        });
      draw();
      dirty = false;
    }
    if (dirty || moving()) frame = requestAnimationFrame(animate);
  };
  const sync = () => {
    if (active() && !frame && (dirty || moving()))
      frame = requestAnimationFrame(animate);
    else if (!active() && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
  };
  const invalidate = () => {
    dirty = true;
    last = 0;
    sync();
  };
  const resize = () => {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    const pixelRatio = Math.min(devicePixelRatio, host.clientWidth < 700 ? 1.25 : 1.5);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    const direction=new THREE.Vector3(33,43,45).normalize(),right=new THREE.Vector3(0,1,0).cross(direction).normalize(),up=direction.clone().cross(right).normalize();
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=50;
    for(const x of [-28,28])for(const z of [-21.5,21.5]){const corner=new THREE.Vector3(x,0,z),depth=corner.dot(direction);distance=Math.max(distance,Math.abs(corner.dot(right))/(tangent*camera.aspect)+depth,Math.abs(corner.dot(up))/tangent+depth);}
    overview.copy(direction.multiplyScalar(distance*1.04));
    camera.updateProjectionMatrix();
    invalidate();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY };
  };
  const move = (event: PointerEvent) => {
    if (!drag || !selection.active) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (event.pointerType === "touch" && Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) return;
    orbit += (event.clientX - drag.lastX) * 0.008;
    if (event.pointerType !== "touch") {
      const elevation = VIEW_ELEVATION[selection.active];
      elevationOffset = THREE.MathUtils.clamp(
        elevationOffset - (event.clientY - drag.lastY) * 0.18,
        13 - elevation,
        65 - elevation,
      );
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    invalidate();
  };
  const up = (event: PointerEvent) => {
    if (!drag) return;
    const click =
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7;
    drag = null;
    if (!click) return;
    const bounds = host.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectable, false).find((entry) => {
      let node: THREE.Object3D | null = entry.object;
      while (node) { if (!node.visible) return false; node = node.parent; }
      return true;
    });
    if (hit?.object.userData.landmarkId)
      onSelect(hit.object.userData.landmarkId);
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    sync();
    onLost();
  };
  const cancel = () => {
    drag = null;
  };
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", cancel);
  host.addEventListener("pointerleave", cancel);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  document.addEventListener("visibilitychange", sync);
  resize();
  sync();
  return {
    select(id) {
      orbit = 0.2;
      elevationOffset = 0;
      zoom = 1;
      selection.select(id);
      invalidate();
    },
    rotate(delta) {
      orbit += delta;
      invalidate();
    },
    zoom(delta) {
      zoom = THREE.MathUtils.clamp(zoom + delta, 0.45, 1.5);
      invalidate();
    },
    setPaused(value) {
      paused = value;
      invalidate();
    },
    setVisible(value) {
      visible = value;
      if (value) invalidate();
      else sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      selection.reset();
      resizeObserver.disconnect();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", cancel);
      host.removeEventListener("pointerleave", cancel);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", sync);
      disposeThreeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.selectionPhase;
      delete host.dataset.selectedLandmark;
      delete host.dataset.liftedModels;
    },
  };
}
