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
import { createNavigationModel, disposeThreeObject } from "@/lib/three-models";

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
): IcaCityController {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: host.clientWidth > 700,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  renderer.setClearColor("#031021", 0);
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, host.clientWidth < 700 ? 1.1 : 1.5),
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.05, 350),
    selection = new CitySelection();
  const overview = new THREE.Vector3(33, 43, 45),
    look = new THREE.Vector3(0, 0, 0);
  camera.position.copy(overview);
  camera.lookAt(look);
  scene.add(new THREE.AmbientLight("#7695c4", 2.5));
  const sunlight = new THREE.DirectionalLight("#d8efff", 4.4);
  sunlight.position.set(-25, 55, 15);
  scene.add(sunlight);
  const rim = new THREE.DirectionalLight("#087cff", 3);
  rim.position.set(25, 12, -30);
  scene.add(rim);
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
  scene.add(ground);
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
  scene.add(
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
      scene.add(
        new THREE.Mesh(
          geometry,
          footprint.kind === "water" ? waterMaterial : parkMaterial,
        ),
      );
  }
  if (ordinary.length) {
    const merged = mergeGeometries(ordinary, false);
    if (merged) scene.add(new THREE.Mesh(merged, buildingMaterial));
    ordinary.forEach((g) => g.dispose());
  }
  const models = new Map<
    LandmarkId,
    {
      root: THREE.Group;
      visual: THREE.Group;
      scale: number;
      anchor: THREE.Vector3;
      radius: number;
    }
  >();
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
      visual = new THREE.Group();
    root.position.copy(anchor);
    root.add(visual);
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
    visual.add(mesh);
    selectable.push(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      outlineMaterial,
    );
    visual.add(edges);
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
    scene.add(base);
    geometry.computeBoundingSphere();
    const radius = Math.max(0.1, geometry.boundingSphere?.radius ?? 1);
    models.set(landmark.id, {
      root,
      visual,
      anchor,
      radius,
      scale: Math.max(2, Math.min(16, 8 / (radius * 2))),
    });
  }
  const pathData = data.roads
    .filter((points) => points.length > 3 && points.length < 30)
    .slice(0, 3);
  const cars = pathData.map((points, index) => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++)
      path.add(
        new THREE.LineCurve3(
          new THREE.Vector3(points[i - 1][0], 0.045, points[i - 1][1]),
          new THREE.Vector3(points[i][0], 0.045, points[i][1]),
        ),
      );
    const car = createNavigationModel(
      index === 1 ? "sedan:teal" : "compact:blue",
    );
    car.scale.setScalar(0.018);
    scene.add(car);
    return { car, path };
  });
  let disposed = false,
    lost = false,
    paused = false,
    visible = true,
    frame = 0,
    last = 0,
    elapsed = 0,
    orbit = 0.2,
    zoom = 1,
    dirty = true;
  let drag: { x: number; y: number; lastX: number } | null = null;
  const pointer = new THREE.Vector2(),
    raycaster = new THREE.Raycaster();
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
      const selected = state.active ? models.get(state.active) : undefined;
      for (const [id, item] of models) {
        const focus = state.active === id ? state.eased : 0;
        const expansion = THREE.MathUtils.smoothstep(focus, 0.15, 1),
          turn = THREE.MathUtils.smoothstep(focus, 0.45, 1);
        item.visual.position.set(0, focus * 4.5, 0);
        item.visual.scale.setScalar(1 + (item.scale - 1) * expansion);
        item.visual.rotation.y = turn * orbit;
      }
      host.dataset.liftedModels = String(
        [...models.values()].filter((item) => item.visual.position.y > 0.001)
          .length,
      );
      const fade = selected ? 1 - state.eased * 0.48 : 1;
      buildingMaterial.color.setRGB(0.04 * fade, 0.18 * fade, 0.34 * fade);
      if (selected) {
        const target = selected.anchor
          .clone()
          .add(
            new THREE.Vector3(
              0,
              4.5 + selected.radius * selected.scale * 0.1,
              0,
            ),
          );
        const distance =
          zoom *
          Math.max(
            14,
            9 /
              (Math.tan(THREE.MathUtils.degToRad(19)) *
                Math.min(1, camera.aspect)),
          );
        const angle = 0.65 + orbit * 0.12;
        const eye = target
          .clone()
          .add(
            new THREE.Vector3(
              Math.sin(angle) * distance,
              distance * 0.65,
              Math.cos(angle) * distance,
            ),
          );
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
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / host.clientHeight;
    const direction=new THREE.Vector3(33,43,45).normalize(),right=new THREE.Vector3(0,1,0).cross(direction).normalize(),up=direction.clone().cross(right).normalize();
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=50;
    for(const x of [-28,28])for(const z of [-21.5,21.5]){const corner=new THREE.Vector3(x,0,z),depth=corner.dot(direction);distance=Math.max(distance,Math.abs(corner.dot(right))/(tangent*camera.aspect)+depth,Math.abs(corner.dot(up))/tangent+depth);}
    overview.copy(direction.multiplyScalar(distance*1.04));
    camera.updateProjectionMatrix();
    invalidate();
  };
  const down = (event: PointerEvent) => {
    drag = { x: event.clientX, y: event.clientY, lastX: event.clientX };
  };
  const move = (event: PointerEvent) => {
    if (
      drag &&
      selection.active &&
      Math.abs(event.clientX - drag.x) > Math.abs(event.clientY - drag.y) * 1.5
    ) {
      orbit += (event.clientX - drag.lastX) * 0.008;
      drag.lastX = event.clientX;
      invalidate();
    }
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
    const hit = raycaster.intersectObjects(selectable, false)[0];
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
      zoom = 1;
      selection.select(id);
      invalidate();
    },
    rotate(delta) {
      orbit += delta;
      invalidate();
    },
    zoom(delta) {
      zoom = THREE.MathUtils.clamp(zoom + delta, 0.65, 1.5);
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
