import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadTs } from './helpers/ts-module.mjs';

const { createIcaMuseum } = loadTs('components/home/create-ica-museum.ts');

test('the Ayabaca facade has two recessed entrances and high window strips', () => {
  const museum = createIcaMuseum();
  museum.updateMatrixWorld(true);
  const facade = museum.getObjectByName('Ingreso de Ayabaca');
  const front = new THREE.Vector3(0, 0, 1).transformDirection(museum.matrixWorld);
  assert.ok(front.z < -0.98);
  const hitAt = (x, y) => {
    const origin = museum.localToWorld(new THREE.Vector3(x, y, 33));
    return new THREE.Raycaster(origin, front.clone().negate()).intersectObject(facade, true)[0];
  };
  assert.ok(hitAt(-6.74, 1.52).distance - hitAt(-11.6, 1.52).distance > 1.8);
  assert.ok(hitAt(8.41, 1.46).distance - hitAt(6.25, 1.46).distance > 0.9);
  assert.equal(hitAt(3.32, 6.12).object.name, 'glass');
  assert.equal(hitAt(3.32, 4.25).object.name, 'wall');
  assert.ok(facade.getObjectByName('letters'));
  assert.ok(museum.getObjectByName('Atrio y acceso').getObjectByName('clay'));
});
