import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadTs } from './helpers/ts-module.mjs';

const { createIcaArchitecture, ICA_ARCHITECTURE_REFERENCES } = loadTs('components/home/create-ica-architecture.ts');
const landmarks = [
  { id: 'catedral', width: [20, 22], height: [20, 24], depth: [63, 66], axis: [0.95, -0.31], maxTriangles: 18000 },
  { id: 'luren', width: [37, 40], height: [39, 41], depth: [57, 61], axis: [-0.27, -0.96], maxTriangles: 33000 },
];

test('Ica landmarks keep their georeferenced facade directions and grounded metre scale', () => {
  for (const { id, width, height, depth, axis } of landmarks) {
    const model = createIcaArchitecture(id);
    assert.equal(model.userData.landmarkId, id);
    assert.equal(model.rotation.y, model.userData.frontYaw);
    const direction = new THREE.Vector3(0, 0, 1).applyEuler(model.rotation);
    assert.ok(direction.distanceTo(new THREE.Vector3(axis[0], 0, axis[1])) < 0.02);

    model.rotation.y = 0;
    const bounds = new THREE.Box3().setFromObject(model, true);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(bounds.min.y) < 0.001);
    assert.ok(size.x >= width[0] && size.x <= width[1], `${id} width: ${size.x}`);
    assert.ok(size.y >= height[0] && size.y <= height[1], `${id} height: ${size.y}`);
    assert.ok(size.z >= depth[0] && size.z <= depth[1], `${id} depth: ${size.z}`);
  }
  assert.equal(createIcaArchitecture('plaza'), null);
  assert.equal(createIcaArchitecture('huacachina'), null);
});

test('Ica landmark meshes are batched, selectable and linked to photographic references', () => {
  for (const { id, maxTriangles } of landmarks) {
    const model = createIcaArchitecture(id);
    let triangles = 0;
    assert.ok(model.children.length >= 7 && model.children.length <= 10);
    for (const mesh of model.children) {
      assert.equal(mesh.userData.landmarkId, id);
      assert.ok(mesh.geometry.boundingSphere.radius > 0);
      const positions = mesh.geometry.getAttribute('position');
      assert.ok(positions.array.every(Number.isFinite));
      triangles += positions.count / 3;
    }
    assert.ok(triangles < maxTriangles, `${id}: ${triangles} triangles`);
    assert.ok(ICA_ARCHITECTURE_REFERENCES[id].length >= 2);
  }
});

function inspectBuilding(id) {
  const model = createIcaArchitecture(id);
  model.rotation.y = 0;
  model.updateMatrixWorld(true);

  return (origin, direction) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
    return ray.intersectObjects(model.children)[0];
  };
}

test('the Cathedral preserves both cupolas and documents the difference between a vault and a collapsed bay', () => {
  const inspect = inspectBuilding('catedral');
  for (const x of [-8.12, 8.12]) {
    const cupola = inspect([x, 19.1, 40], [0, 0, -1]);
    assert.equal(cupola?.object.name, 'catedral-trim');
    assert.ok(cupola.point.z > 28);
  }
  assert.equal(inspect([-8.12, 15.6, 40], [0, 0, -1])?.object.name, 'catedral-wood');
  const damagedBay = inspect([0, 30, 12], [0, -1, 0]);
  const survivingVault = inspect([0, 30, 22], [0, -1, 0]);
  assert.ok(damagedBay && damagedBay.point.y < 2);
  assert.ok(survivingVault && survivingVault.point.y > 12);
});

test('Luren has a recessed portal and an elevated dome behind its nave', () => {
  const inspect = inspectBuilding('luren');
  const door = inspect([2.25, 2.7, 40], [0, 0, -1]);
  const portal = inspect([5.1, 2.7, 40], [0, 0, -1]);
  assert.equal(door?.object.name, 'luren-wood');
  assert.ok(portal && portal.point.z - door.point.z > 2);

  const dome = inspect([2.9, 29, -15.48], [0, -1, 0]);
  const nave = inspect([2.25, 29, 5], [0, -1, 0]);
  assert.ok(dome && dome.point.y > 24 && dome.point.y < 26);
  assert.ok(nave && nave.point.y > 14 && nave.point.y < 17);
});
