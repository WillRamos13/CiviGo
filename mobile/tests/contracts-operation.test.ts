import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OperationScope } from '../src/services/operationScope';
import { incidentAfterParticipation, resolutionMessage, submitProximityAction } from '../src/services/incidentParticipation';
import type { Incidente } from '../src/types';

const point = { latitud: -14.0678, longitud: -75.7286 };

test('participation applies only same-incident state, validated counters and chat status', () => {
  const original: Incidente = { id: 8, tipo: 'Bache', estado: 'ACTIVO', nivelRiesgo: 2,
    totalReportes: 1, ...point, chatAbierto: true, resoluciones: 0, validacion: 0.5 };
  const resolved = incidentAfterParticipation(original, { id: 8, estado: 'RESUELTO', resoluciones: 5,
    confirmaciones: 3, chatAbierto: true, validacion: 1, tipo: 'Texto no autorizado', latitud: 0 });
  assert.ok(resolved);
  assert.equal(resolved.estado, 'RESUELTO');
  assert.equal(resolved.chatAbierto, false);
  assert.equal(resolved.resoluciones, 5);
  assert.equal(resolved.confirmaciones, 3);
  assert.equal(resolved.validacion, 1);
  assert.equal(resolved.tipo, original.tipo);
  assert.equal(resolved.latitud, original.latitud);
  assert.equal(original.estado, 'ACTIVO');
  for (const invalid of [null, {}, { id: 9, estado: 'RESUELTO' }, { id: '8', estado: 'RESUELTO' },
    { id: NaN, estado: 'RESUELTO' }, { id: 8, estado: 'DESCONOCIDO' }]) {
    assert.equal(incidentAfterParticipation(original, invalid), null);
  }
  const active = incidentAfterParticipation(original, { id: 8, estado: 'VALIDADO', resoluciones: -1,
    confirmaciones: Infinity, validacion: 2, chatAbierto: 'false' });
  assert.ok(active);
  assert.equal(active.estado, 'VALIDADO');
  assert.equal(active.resoluciones, 0);
  assert.equal(active.validacion, 0.5);
  assert.equal(active.confirmaciones, undefined);
  assert.equal(active.chatAbierto, true);
});

test('a resolution vote reports success only when the backend actually resolves the incident', async () => {
  const scope = new OperationScope(() => 'user-1:incident-8');
  for (const estado of ['ACTIVO', 'VALIDADO', 'PENDIENTE', 'RESUELTO']) {
    const operation = scope.begin();
    const result = await submitProximityAction(8, 'resolver', operation, {
      locate: async () => point,
      send: async () => ({ id: 8, estado, resoluciones: estado === 'RESUELTO' ? 5 : 1 }),
    });
    if (estado === 'RESUELTO') assert.equal(resolutionMessage(result), '¡Incidente marcado como resuelto!');
    else {
      assert.match(resolutionMessage(result), /aviso de resolución quedó registrado/);
      assert.doesNotMatch(resolutionMessage(result), /¡Incidente marcado como resuelto!/);
    }
    operation.finish();
  }
  assert.doesNotMatch(resolutionMessage(null), /¡Incidente marcado como resuelto!/);
});

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
