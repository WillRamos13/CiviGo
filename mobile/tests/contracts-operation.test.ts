import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OperationScope } from '../src/services/operationScope';
import { submitProximityAction } from '../src/services/incidentParticipation';

const point = { latitud: -14.0678, longitud: -75.7286 };

test('proximity action uses the real incident ID, coordinates and abort signal after obtaining GPS', async () => {
  const scope = new OperationScope(() => 'user-1:incident-8');
  const operation = scope.begin();
  const result = await submitProximityAction(8, 'confirmar', operation, {
    locate: async () => point,
    send: async (path, body, options) => {
      assert.equal(path, '/incidents/8/confirmar');
      assert.deepEqual(body, point);
      assert.equal(options.signal, operation.signal);
      return { confirmado: true };
    },
  });
  assert.deepEqual(result, { confirmado: true });
  operation.finish();
});

test('changing accounts while GPS is pending prevents confirming with the next account', async () => {
  let identity = 'user-1:incident-8';
  const scope = new OperationScope(() => identity);
  const operation = scope.begin();
  let release!: (value: typeof point) => void;
  let posts = 0;
  const result = submitProximityAction(8, 'confirmar', operation, {
    locate: () => new Promise((resolve) => { release = resolve; }),
    send: async () => { posts++; },
  });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  identity = 'user-2:incident-8';
  release(point);
  await rejected;
  assert.equal(posts, 0);
});

test('changing incident or closing the detail during GPS lookup prevents resolving the stale incident', async () => {
  for (const change of ['incident', 'close'] as const) {
    let identity = 'user-1:incident-8';
    let mounted = true;
    const scope = new OperationScope(() => identity, () => mounted);
    const operation = scope.begin();
    let release!: (value: typeof point) => void;
    let posts = 0;
    const result = submitProximityAction(8, 'resolver', operation, {
      locate: () => new Promise((resolve) => { release = resolve; }),
      send: async () => { posts++; },
    });
    const rejected = assert.rejects(result, { name: 'AbortError' });
    if (change === 'incident') identity = 'user-1:incident-9';
    else { mounted = false; scope.cancel(); }
    release(point);
    await rejected;
    assert.equal(posts, 0, change);
    assert.equal(operation.isActive(), false);
  }
});

test('stale mutation results cannot be committed after the account or selected incident changes', async () => {
  let identity = 'user-1:incident-8';
  const scope = new OperationScope(() => identity);
  const operation = scope.begin();
  let entered!: () => void;
  const posted = new Promise<void>((resolve) => { entered = resolve; });
  let release!: (value: unknown) => void;
  let committed = false;
  const result = submitProximityAction(8, 'resolver', operation, {
    locate: async () => point,
    send: () => { entered(); return new Promise((resolve) => { release = resolve; }); },
  }).then(() => { committed = true; });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await posted;
  identity = 'user-2:incident-9';
  release({ resuelto: true });
  await rejected;
  assert.equal(committed, false);
});

test('cancelling a scope aborts in-flight signals while a new owner can start a fresh operation', () => {
  let identity = 'user-1:incident-8';
  const scope = new OperationScope(() => identity);
  const first = scope.begin();
  scope.cancel();
  assert.equal(first.signal.aborted, true);
  assert.throws(() => first.assertActive(), { name: 'AbortError' });
  identity = 'user-2:incident-8';
  const next = scope.begin();
  assert.equal(next.isActive(), true);
  assert.equal(next.signal.aborted, false);
  next.finish();
});
