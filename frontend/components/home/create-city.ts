import * as THREE from 'three';

export type CityController = { setPaused(value: boolean): void; setVisible(value: boolean): void; dispose(): void };

// This scene is decorative. It never reads incidents, location, tiles or APIs.
export function createCity(host: HTMLElement, onContextLost: () => void): CityController {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: host.clientWidth > 700, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, host.clientWidth < 700 ? 1.1 : 1.5));
  renderer.setClearColor(0x040d18, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 160);
  camera.position.set(32, 30, 38); camera.lookAt(0, 1, 0);
  const city = new THREE.Group(); scene.add(city);
  scene.add(new THREE.AmbientLight(0x7aaeff, 2.2));
  const sun = new THREE.DirectionalLight(0xc3eeff, 4.8); sun.position.set(-12, 30, 8); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x057aff, 4); rim.position.set(10, 4, -15); scene.add(rim);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const material = (color: number, emissive = 0x000000, intensity = 0) => new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: .12, emissive, emissiveIntensity: intensity });
  const baseMaterial = material(0x041b32), roadMaterial = material(0x092d4a), landmarkMaterial = material(0x2160a6), lightMaterial = material(0x79dcff, 0x139dff, 1.5);
  const block = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(box, mat); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); city.add(mesh); return mesh;
  };
  block(0, -.35, 0, 30, .6, 30, baseMaterial);
  for (let p = -12; p <= 12; p += 4) {
    block(p, .015, 0, .95, .035, 30, roadMaterial);
    block(0, .015, p, 30, .035, .95, roadMaterial);
  }
  const grid = new THREE.GridHelper(30, 30, 0x1c6297, 0x17436a);
  grid.position.y = .02; grid.material.transparent = true; grid.material.opacity = .4; city.add(grid);
  let seed = 72;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const buildings: { x: number; z: number; h: number; w: number; color: number }[] = [];
  for (let x = -14; x <= 14; x += 2) for (let z = -14; z <= 14; z += 2) {
    if (x % 4 === 0 || z % 4 === 0 || Math.abs(x) < 4 && Math.abs(z) < 4) continue;
    const height = .7 + random() * (Math.abs(x) > 8 ? 3 : 6);
    buildings.push({ x: x + (random() - .5) * .2, z, h: height, w: 1.05 + random() * .5, color: random() > .8 ? 0x206dca : 0x17476e });
  }
  const buildingsMaterial = material(0xffffff);
  const instances = new THREE.InstancedMesh(box, buildingsMaterial, buildings.length);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  buildings.forEach((b, i) => {
    dummy.position.set(b.x, b.h / 2, b.z); dummy.scale.set(b.w, b.h, 1.4); dummy.updateMatrix(); instances.setMatrixAt(i, dummy.matrix); instances.setColorAt(i, color.setHex(b.color));
  });
  city.add(instances);
  // A plaza and twin towers evoke Ica without claiming architectural accuracy.
  block(0, .07, 0, 5.8, .12, 5.8, material(0x164c4a));
  block(0, .12, 1.5, 4.5, .06, .8, material(0x367d89));
  block(0, .85, -1, 3.6, 1.6, 1.8, landmarkMaterial);
  block(-1.6, 2.1, -.5, .85, 4.2, .9, landmarkMaterial); block(1.6, 2.1, -.5, .85, 4.2, .9, landmarkMaterial);
  const roofGeometry = new THREE.ConeGeometry(.6, 1, 4);
  for (const x of [-1.6, 1.6]) {
    const roof = new THREE.Mesh(roofGeometry, lightMaterial); roof.position.set(x, 4.7, -.5); roof.rotation.y = Math.PI / 4; city.add(roof);
    block(x, 5.6, -.5, .08, .7, .08, lightMaterial); block(x, 5.7, -.5, .4, .08, .08, lightMaterial);
  }
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, .25, 20), material(0x46b9e5, 0x148ccc, .6)); fountain.position.set(0, .22, 1); city.add(fountain);
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(.42, 1.5, 6), material(0x217b75), 8);
  for (let i = 0; i < 8; i++) { dummy.position.set(i < 4 ? -2.4 : 2.4, .8, -1.9 + (i % 4) * 1.2); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix); }
  city.add(trees);
  const routePoints = [new THREE.Vector3(-14, .12, 8), new THREE.Vector3(-4, .12, 8), new THREE.Vector3(-4, .12, -4), new THREE.Vector3(8, .12, -4), new THREE.Vector3(8, .12, -12)];
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < routePoints.length; i++) path.add(new THREE.LineCurve3(routePoints[i - 1], routePoints[i]));
  city.add(new THREE.Mesh(new THREE.TubeGeometry(path, 100, .075, 6, false), lightMaterial));
  city.add(new THREE.Mesh(new THREE.TubeGeometry(path, 100, .22, 6, false), new THREE.MeshBasicMaterial({ color: 0x0a92ff, transparent: true, opacity: .15, depthWrite: false })));
  const cars = [block(-14, .3, 8, .42, .25, .75, material(0xc8f0ff)), block(-4, .3, 8, .42, .25, .75, material(0x2196ff))];
  const pinShape = new THREE.Shape();
  pinShape.moveTo(0, -.9); pinShape.bezierCurveTo(-1.25, .25, -.85, 1.4, 0, 1.4); pinShape.bezierCurveTo(.85, 1.4, 1.25, .25, 0, -.9);
  const pinHole = new THREE.Path(); pinHole.absarc(0, .55, .3, 0, Math.PI * 2, true); pinShape.holes.push(pinHole);
  const pinGeometry = new THREE.ExtrudeGeometry(pinShape, { depth: .18, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 1, steps: 1, curveSegments: 12 });
  const pins = [[-4, 8], [8, -12], [10, 6]].map(([x, z]) => {
    const pin = new THREE.Mesh(pinGeometry, lightMaterial); pin.position.set(x, 4, z); pin.lookAt(camera.position); city.add(pin);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .9, 28), new THREE.MeshBasicMaterial({ color: 0x4ac8ff, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, .1, z); city.add(ring); return pin;
  });
  let frame = 0, last = 0, elapsed = 0, paused = false, visible = true, disposed = false, lost = false;
  const pointer = new THREE.Vector2(), turn = new THREE.Vector2();
  const draw = () => { if (!disposed && !lost) renderer.render(scene, camera); };
  const active = () => !disposed && !lost && !paused && visible && !document.hidden;
  const animate = (time: number) => {
    frame = 0;
    if (!active()) { last = 0; return; }
    if (!last || time - last >= 33) {
      elapsed += last ? Math.min((time - last) / 1000, .06) : 0; last = time;
      turn.lerp(pointer, .05); city.rotation.y = turn.x * .07; city.rotation.x = turn.y * .025;
      pins.forEach((pin, index) => { pin.position.y = 4 + Math.sin(elapsed * 1.2 + index * 1.6) * .22; });
      cars.forEach((car, index) => { const t = (elapsed * .017 + index * .46) % 1; car.position.copy(path.getPointAt(t)); car.position.y = .3; const tangent = path.getTangentAt(t); car.rotation.y = Math.atan2(tangent.x, tangent.z); });
      draw();
    }
    frame = requestAnimationFrame(animate);
  };
  const sync = () => { if (active() && !frame) frame = requestAnimationFrame(animate); else if (!active() && frame) { cancelAnimationFrame(frame); frame = 0; last = 0; } };
  const resize = () => { const width = host.clientWidth, height = host.clientHeight; if (!width || !height || disposed) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); draw(); };
  const move = (event: PointerEvent) => { if (event.pointerType !== 'mouse' || paused) return; const bounds = host.getBoundingClientRect(); pointer.set((event.clientX - bounds.left) / bounds.width - .5, (event.clientY - bounds.top) / bounds.height - .5); };
  const leave = () => pointer.set(0, 0);
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; sync(); onContextLost(); };
  host.append(renderer.domElement);
  const observer = new ResizeObserver(resize); observer.observe(host);
  host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', sync);
  resize(); sync();
  return {
    setPaused(value) { paused = value; sync(); },
    setVisible(value) { visible = value; sync(); },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', sync); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { geometries.add(object.geometry); const value = object.material; (Array.isArray(value) ? value : [value]).forEach(mat => materials.add(mat)); if (object instanceof THREE.InstancedMesh) object.dispose(); } });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(mat => mat.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
