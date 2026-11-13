import * as THREE from "three";
import {
  MercatorCoordinate,
  type Map as MapboxMap,
  type MapMouseEvent,
  type CustomLayerInterface,
} from "mapbox-gl";
import { nearbyMapBusinesses,rememberBusinessSelection, type MapBusinessPoint } from "./map-businesses";
import { disposeThreeObject } from "./three-models";
export function mountBusinessModels(
  map: MapboxMap,
  items: MapBusinessPoint[],
  onSelect: (id: number) => void,
) {
  const id = "civigo-business-models";
  let disposed = false,
    scene: THREE.Scene | undefined,
    renderer: THREE.WebGLRenderer | undefined,
    camera: THREE.Camera | undefined;
  let visible: MapBusinessPoint[] = [],
    origin: MercatorCoordinate | undefined,
    previous = "";
  const release = () => {
    if (scene) disposeThreeObject(scene);
    renderer?.dispose();
    scene = undefined;
    renderer = undefined;
    camera = undefined;
    previous = "";
  };
  const rebuild = () => {
    const center = map.getCenter();
    visible =
      map.getZoom() >= 15.5
        ? nearbyMapBusinesses(items, {
            latitud: center.lat,
            longitud: center.lng,
          })
        : [];
    const key = visible.map((item) => item.id).join(",");
    if (key === previous && scene) return;
    previous = key;
    if (!scene) return;
    for (const child of [...scene.children])
      if (child instanceof THREE.InstancedMesh) {
        scene.remove(child);
        disposeThreeObject(child);
      }
    if (!visible.length) return;
    origin = MercatorCoordinate.fromLngLat(
      [visible[0].longitud, visible[0].latitud],
      0.4,
    );
    const unit = origin.meterInMercatorCoordinateUnits();
    const pieces = [
      { size: [7, 4, 6], y: 2, color: "#237cb6" },
      { size: [7.6, 0.4, 6.6], y: 4.2, color: "#9bcbe5" },
      { size: [2, 2.8, 0.2], y: 1.4, color: "#092a46" },
    ];
    for (const piece of pieces) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(...(piece.size as [number, number, number])),
        new THREE.MeshStandardMaterial({ color: piece.color, roughness: 0.75 }),
        visible.length,
      );
      visible.forEach((business, index) => {
        const point = MercatorCoordinate.fromLngLat([
          business.longitud,
          business.latitud,
        ]);
        const matrix = new THREE.Matrix4().makeTranslation(
          (point.x - origin!.x) / unit,
          piece.y,
          -(point.y - origin!.y) / unit + (piece.size[2] === 0.2 ? 3.1 : 0),
        );
        mesh.setMatrixAt(index, matrix);
      });
      scene.add(mesh);
    }
  };
  const layer: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      scene.add(new THREE.HemisphereLight("#eef8ff", "#415875", 3));
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
      });
      renderer.autoClear = false;
      rebuild();
    },
    render(_gl, matrix) {
      if (
        disposed ||
        !visible.length ||
        !origin ||
        !scene ||
        !camera ||
        !renderer ||
        document.hidden
      )
        return;
      const scale = origin.meterInMercatorCoordinateUnits();
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(
        new THREE.Matrix4()
          .makeTranslation(origin.x, origin.y, origin.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)),
      );
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove: release,
  };
  const attach = () => {
    if (!disposed && !map.getLayer(id) && map.isStyleLoaded())
      map.addLayer(layer);
  };
  const move = () => {
    rebuild();
    map.triggerRepaint();
  };
  const restore = () => {
    if (disposed) return;
    if (map.getLayer(id)) map.removeLayer(id);
    attach();
  };
  const click = (event: MapMouseEvent) => {
    if((event.originalEvent.target as HTMLElement)?.closest?.('.incident-marker'))return;
    const closest = visible
      .map((item) => ({
        item,
        point: map.project([item.longitud, item.latitud]),
      }))
      .filter(
        ({ point }) =>
          Math.hypot(point.x - event.point.x, point.y - event.point.y) < 18,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.point.x - event.point.x, a.point.y - event.point.y) -
          Math.hypot(b.point.x - event.point.x, b.point.y - event.point.y),
      )[0];
    if (closest) {rememberBusinessSelection(map,event.point);onSelect(closest.item.id);}
  };
  map.on("style.load", attach);
  map.on("moveend", move);
  map.on("preclick", click);
  map.on("webglcontextrestored", restore);
  attach();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off("style.load", attach);
      map.off("moveend", move);
      map.off("preclick", click);
      map.off("webglcontextrestored", restore);
      if (map.getLayer(id)) map.removeLayer(id);
      else release();
    },
  };
}
