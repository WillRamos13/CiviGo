import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTs } from './helpers/ts-module.mjs';
const { createPlazaModel } = loadTs('components/home/create-plaza-model.ts');
const { frameModel, modelFramingPoints } = loadTs('lib/three-framing.ts');

test('plaza is real bounded geometry with distinct architectural and garden features', () => {
  const model = createPlazaModel(), bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  assert.ok(size.x > 165 && size.x < 175);
  assert.ok(size.z > 165 && size.z < 175);
  assert.ok(size.y > 11 && size.y < 20);
  assert.ok(Math.abs(center.x) < 2 && Math.abs(center.z) < 2, 'orbit has a stable centred pivot');
  for (const name of ['Obelisco de dos agujas', 'Piletas', 'Ficus y mobiliario', 'Pérgola', 'Portales y fachadas', 'Volúmenes de la manzana']) {
    assert.ok(model.getObjectByName(name)?.children.length, name);
  }
  assert.equal(model.userData.basinCount, 7);
  assert.ok(Number.isFinite(model.userData.frontYaw));
  let triangles = 0, meshes = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    const positions = node.geometry.getAttribute('position');
    for (const coordinate of positions.array) assert.ok(Number.isFinite(coordinate));
    triangles += (node.geometry.index?.count ?? positions.count) / 3;
    assert.ok(node.material.isMeshStandardMaterial);
    assert.equal(node.userData.landmarkId, 'plaza');
  });
  assert.ok(triangles > 15000 && triangles < 100000, `triangle budget: ${triangles}`);
  assert.ok(meshes < 100, `static objects are batched: ${meshes}`);
});

test('the fountain water is recessed through a real opening in the pavement', () => {
  const model = createPlazaModel();
  model.updateMatrixWorld(true);
  const surface = model.getObjectByName('Pavimento y jardines').getObjectByName('paver');
  const water = model.getObjectByName('Piletas').getObjectByName('water');
  const ray = new THREE.Raycaster(new THREE.Vector3(2.8, 25, 0), new THREE.Vector3(0, -1, 0));
  const samples = [[2.8, 0], ...Array.from({ length: 6 }, (_, segment) => {
    const angle = segment * Math.PI / 3 + Math.PI / 2 + 18 * Math.PI / 180;
    return [6.9 * Math.cos(angle), -6.9 * Math.sin(angle)];
  })];
  for (const [x, z] of samples) {
    ray.ray.origin.set(x, 25, z);
    assert.equal(ray.intersectObject(surface).length, 0);
    const [basin] = ray.intersectObject(water);
    assert.ok(basin && basin.point.y < 0.1);
  }
  ray.ray.origin.set(17, 25, 0);
  const [paving] = ray.intersectObject(surface);
  assert.ok(paving && paving.point.y > 0.31);
  assert.equal(ray.intersectObject(water).length, 0);
});

test('asymmetric plaza fits and stays centred on a portrait and a landscape camera', () => {
  const model = createPlazaModel(), points = [];
  for (const part of model.children) {
    const bounds = new THREE.Box3().setFromObject(part);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
  }
  for (const aspect of [0.7, 1.7, 3]) for (const angle of [0, 0.7, 2.4]) {
    const turned = points.map(p => p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    const direction = new THREE.Vector3(0.65, 0.65, 0.8).normalize();
    const frame = frameModel(turned, direction, 38, aspect);
    const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 5000);
    camera.position.copy(frame.center).addScaledVector(direction, frame.distance);camera.lookAt(frame.center);camera.updateMatrixWorld();
    const projected = turned.map(p => p.clone().project(camera));
    for (const point of projected) assert.ok(Math.abs(point.x) < 0.91 && Math.abs(point.y) < 0.91);
    const horizontal = projected.map(p => p.x), vertical = projected.map(p => p.y);
    assert.ok(Math.abs(Math.max(...horizontal) + Math.min(...horizontal)) < 0.04);
    assert.ok(Math.abs(Math.max(...vertical) + Math.min(...vertical)) < 0.04);
  }
});

test('framing an unrendered geographically anchored model uses its actual world transform', () => {
  const root = new THREE.Group(), visual = new THREE.Group(), model = createPlazaModel();
  const anchor = new THREE.Vector3(9.2, 0, -12.4);
  root.position.copy(anchor);root.add(visual);visual.add(model);model.scale.setScalar(0.01);
  const points = modelFramingPoints(model, anchor);
  const bounds = new THREE.Box3().setFromPoints(points), center = bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x) < 0.01 && Math.abs(center.z) < 0.01);
  const modelSize = new THREE.Box3().setFromObject(createPlazaModel()).getSize(new THREE.Vector3());
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - modelSize.x * 0.01) < 0.001);
  assert.ok(points.every(p => Number.isFinite(p.y)));
});

test('downloadable GLB is self-contained, readable and matches the integrated model scale', async () => {
  const binary = await readFile('public/models/plaza-armas-ica.glb');
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  assert.equal(binary.readUInt32LE(4), 2);
  assert.equal(binary.readUInt32LE(8), binary.byteLength);
  assert.ok(binary.byteLength < 2500000, 'download remains below 2.5 MB');
  const loaded = await new GLTFLoader().parseAsync(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), '');
  const size = new THREE.Box3().setFromObject(loaded.scene).getSize(new THREE.Vector3());
  const expected = new THREE.Box3().setFromObject(createPlazaModel()).getSize(new THREE.Vector3());
  assert.ok(size.distanceTo(expected) < 0.01);
  const model = loaded.scene.children.find(node => node.userData.basinCount === 7);
  assert.ok(model);
  assert.ok(model.children.some(node => node.name.startsWith('Obelisco')));
  let meshes = 0;
  loaded.scene.traverse(node => { if (node.isMesh) meshes++; });
  assert.ok(meshes > 20 && meshes < 100);
});
