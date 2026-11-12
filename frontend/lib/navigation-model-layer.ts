import * as THREE from "three";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as MapboxMap,
} from "mapbox-gl";
import type { Posicion } from "./types";
import type { NavigationAvatar } from "./navigation-avatar";
import { createNavigationModel, disposeThreeObject } from "./three-models";

export type NavigationModelState = {
  position: Posicion | null;
  heading: number;
  avatar: NavigationAvatar;
};
export type NavigationModelController = {
  update(state: NavigationModelState): void;
  dispose(): void;
};
export function mountNavigationModel(
  map: MapboxMap,
  initial: NavigationModelState,
  onReady: (ready: boolean) => void,
): NavigationModelController {
  const id = "civigo-navigation-model";
  let state = initial,
    disposed = false,
    lost = false,
    renderer: THREE.WebGLRenderer | undefined,
    scene: THREE.Scene | undefined;
  let model: THREE.Group | undefined,
    camera: THREE.Camera | undefined,
    current: THREE.Vector3 | undefined,
    last = 0,
    heading = initial.heading;
  const materialize = () => {
    if (!scene) return;
    if (model) {
      scene.remove(model);
      disposeThreeObject(model);
    }
    model = createNavigationModel(state.avatar);
    model.rotation.y = Math.PI;
    scene.add(model);
  };
  const release = () => {
    if (scene) disposeThreeObject(scene);
    renderer?.dispose();
    renderer = undefined;
    scene = undefined;
    model = undefined;
    camera = undefined;
    last = 0;
    onReady(false);
  };
  const layer: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      lost = false;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      current = undefined;
      scene.add(new THREE.HemisphereLight("#eef8ff", "#314b68", 3));
      const sun = new THREE.DirectionalLight("#ffffff", 2.8);
      sun.position.set(-10, 20, 8);
      scene.add(sun);
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: false,
      });
      renderer.autoClear = false;
      materialize();
      onReady(false);
    },
    render(_gl, matrix) {
      if (
        disposed ||
        lost ||
        !renderer ||
        !scene ||
        !camera ||
        !model ||
        !state.position ||
        document.hidden
      )
        return;
      const now = performance.now(),
        dt = last ? Math.min(0.1, (now - last) / 1000) : 0.1;
      last = now;
      const point = MercatorCoordinate.fromLngLat(
        [state.position.longitud, state.position.latitud],
        0.3,
      );
      const target = new THREE.Vector3(point.x, point.y, point.z),
        fraction = matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 1
          : 1 - Math.exp(-dt / 0.16);
      if (!current) current = target.clone();
      else current.lerp(target, fraction);
      const turn = ((state.heading - heading + 540) % 360) - 180;
      heading += turn * fraction;
      const metersPerPixel =
        (40075016.686 * Math.cos((state.position.latitud * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom());
      const size = Math.max(1, Math.min(12, (metersPerPixel * 34) / 4.4));
      const scale = point.meterInMercatorCoordinateUnits() * size;
      const projection = new THREE.Matrix4().fromArray(matrix);
      const transform = new THREE.Matrix4()
        .makeTranslation(current.x, current.y, current.z)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(
          new THREE.Matrix4().makeRotationY((-heading * Math.PI) / 180),
        );
      camera.projectionMatrix = projection.multiply(transform);
      renderer.resetState();
      renderer.render(scene, camera);
      map.getCanvas().dataset.navigationDraws = String(
        renderer.info.render.calls,
      );
      if (renderer.info.render.calls > 0) onReady(true);
      if (current.distanceTo(target) > 1e-9 || Math.abs(turn) > 0.2)
        map.triggerRepaint();
    },
    onRemove: release,
  };
  const attach = () => {
    if (!disposed && !map.getLayer(id) && map.isStyleLoaded())
      map.addLayer(layer);
  };
  const lose = () => {
    lost = true;
    onReady(false);
  };
  const restore = () => {
    if (disposed) return;
    if (map.getLayer(id)) map.removeLayer(id);
    attach();
  };
  const repaint = () => {
    if (!document.hidden) map.triggerRepaint();
  };
  map.on("style.load", attach);
  map.on("webglcontextlost", lose);
  map.on("webglcontextrestored", restore);
  document.addEventListener("visibilitychange", repaint);
  attach();
  return {
    update(next) {
      const changed = next.avatar !== state.avatar;
      state = next;
      if (changed) materialize();
      map.triggerRepaint();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off("style.load", attach);
      map.off("webglcontextlost", lose);
      map.off("webglcontextrestored", restore);
      document.removeEventListener("visibilitychange", repaint);
      if (map.getLayer(id)) map.removeLayer(id);
      else release();
      delete map.getCanvas().dataset.navigationDraws;
      onReady(false);
    },
  };
}
