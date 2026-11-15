import * as THREE from "three";

export function modelFramingPoints(model: THREE.Group, origin: THREE.Vector3) {
  // A newly attached model has not been rendered yet. Update its ancestors too;
  // otherwise a geographic anchor would be subtracted from local coordinates.
  model.updateWorldMatrix(true, true);
  const points: THREE.Vector3[] = [];
  for (const part of model.children) {
    const bounds = new THREE.Box3().setFromObject(part);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          points.push(new THREE.Vector3(x, y, z).sub(origin));
  }
  return points;
}

/** Fit an asymmetric diorama without reserving empty space above its low parts. */
export function frameModel(
  points: readonly THREE.Vector3[], direction: THREE.Vector3,
  fieldOfView: number, aspect: number, padding = 1.12,
) {
  const forward = direction.clone().normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
  const up = forward.clone().cross(right).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2));
  const center = new THREE.Vector3();
  let distance = 1;
  // Perspective makes the near edge larger; bounded centring passes compensate.
  for (let pass = 0; pass < 8; pass++) {
    distance = 1;
    for (const point of points) {
      const p = point.clone().sub(center), depth = p.dot(forward);
      distance = Math.max(distance,
        Math.abs(p.dot(right)) * padding / (tangent * aspect) + depth,
        Math.abs(p.dot(up)) * padding / tangent + depth);
    }
    if (pass === 7) break;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of points) {
      const p = point.clone().sub(center), depth = distance - p.dot(forward);
      const x = p.dot(right) / depth, y = p.dot(up) / depth;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    center.addScaledVector(right, (minX + maxX) * distance / 2);
    center.addScaledVector(up, (minY + maxY) * distance / 2);
  }
  return { center, distance };
}
