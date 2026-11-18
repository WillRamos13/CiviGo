import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadTs } from './helpers/ts-module.mjs';

const { createIcaArchitecture, ICA_ARCHITECTURE_REFERENCES } = loadTs('components/home/create-ica-architecture.ts');
const editions = [
  { id: 'catedral', width: [20, 22], height: [18, 22], depth: [63, 66], axis: [0.95, -0.31] },
  { id: 'luren', width: [37, 40], height: [33, 38], depth: [57, 61], axis: [-0.27, -0.96] },
  { id: 'museo', width: [39, 41], height: [8, 11], depth: [58, 62], axis: [-0.01, -1] },
];

test('Ica landmarks keep their georeferenced facade directions and grounded metre scale', () => {
  for (const { id, width, height, depth, axis } of editions) {
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
  for (const { id } of editions) {
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
    assert.ok(triangles > 2500 && triangles < 6000, `${id}: ${triangles} triangles`);
    assert.ok(ICA_ARCHITECTURE_REFERENCES[id].length >= 2);
  }
});
