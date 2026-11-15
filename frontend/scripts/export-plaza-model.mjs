import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPlazaModel } from '../components/home/create-plaza-model.ts';

// GLTFExporter uses the browser FileReader for the binary container. No textures,
// credentials or external URLs are included in this self-contained model.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = buffer;
      this.onloadend?.();
    }).catch(error => this.onerror?.(error));
  }
};
const model = createPlazaModel();
try {
  model.traverse(node => {
    if (!node.isMesh) return;
    const original = node.geometry;
    node.geometry = mergeVertices(original);
    original.dispose();
  });
  const glb = await new GLTFExporter().parseAsync(model, { binary: true });
  const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models/plaza-armas-ica.glb');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(glb));
  console.log(`Modelo exportado: ${glb.byteLength} bytes`);
} finally {
  const geometries = new Set(), materials = new Set();
  model.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
