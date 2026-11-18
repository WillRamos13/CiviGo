import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadTs } from './helpers/ts-module.mjs';

const { createHuacachinaModel } = loadTs('components/home/create-huacachina-model.ts');
const { OASIS_BUILDINGS, OASIS_ELEVATION } = loadTs('components/home/huacachina-geography.ts');
const { cityPosition, CITY_LANDMARKS } = loadTs('lib/city-scene.ts');
const data = JSON.parse(readFileSync('public/home/ica-city.json', 'utf8'));
const landmark = CITY_LANDMARKS.find(item => item.id === 'huacachina');
const [x, z] = cityPosition(landmark.longitud, landmark.latitud, data.origin, data.metersPerUnit);
const model = createHuacachinaModel(data, { x, z });

test('the lagoon mesh uses the georeferenced shoreline', () => {
  const mesh = model.getObjectByName('Laguna').getObjectByName('pool');
  const positions = mesh.geometry.getAttribute('position');
  const expected = data.footprints.find(footprint => footprint.osmId === landmark.osmId).ring;
  const shoreline = expected.map(([mx, mz]) =>
    [(mx - x) * data.metersPerUnit, (mz - z) * data.metersPerUnit]);
  for (const [tx, tz] of shoreline) {
    assert.ok(Array.from({ length: positions.count }, (_, i) =>
      Math.hypot(positions.getX(i) - tx, positions.getZ(i) - tz)).some(distance => distance < 0.025));
  }
  assert.ok(model.getObjectByName('Edificios del oasis').children.length > 2);
  assert.ok(model.getObjectByName('Palmeras y vegetación').getObjectByName('bark'));
});

test('the terrain has continuous relief within the detailed scene budget', () => {
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  assert.ok(size.x >= 400 && size.x < 500 && size.z > 320 && size.z < 420);
  assert.ok(size.y > 50 && size.y < 100);
  let triangles = 0, meshes = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    assert.equal(node.userData.landmarkId, landmark.id);
    const positions = node.geometry.getAttribute('position');
    assert.ok(positions.array.every(Number.isFinite));
    triangles += (node.geometry.index?.count ?? positions.count) / 3;
    meshes++;
  });
  assert.ok(triangles > 20000 && triangles < 75000);
  assert.ok(meshes < 28);
});

test('the detail scene uses mapped ground plans and sampled relief', () => {
  assert.equal(model.userData.buildingFootprintCount, OASIS_BUILDINGS.length);
  const library = OASIS_BUILDINGS.find(([way]) => way === 389395378);
  assert.ok(library);
  const [mapX, mapZ] = library[2][0];
  const buildings = model.getObjectByName('Edificios del oasis');
  const includesCorner = buildings.children.some(mesh => {
    const points = mesh.geometry.getAttribute('position');
    for (let i = 0; i < points.count; i++) {
      if (Math.hypot(points.getX(i) - mapX, points.getZ(i) - mapZ) < 0.025) return true;
    }
    return false;
  });
  assert.ok(includesCorner);
  const samples = OASIS_ELEVATION.flat();
  const sand = model.getObjectByName('Dunas de Huacachina');
  sand.geometry.computeBoundingBox();
  assert.ok(Math.abs(sand.geometry.boundingBox.max.y - Math.max(...samples)) < 1.25);
});
