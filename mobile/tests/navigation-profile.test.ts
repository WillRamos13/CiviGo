import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileOperationScope, submitProfileRecovery } from '../src/services/profileOperations';
import type { Adjunto } from '../src/types';

const attachment: Adjunto = { id: 'private-upload-a', nombre: 'DNI', mimeType: 'image/jpeg', privado: true, url: null };
const file = new File(['private-test-fixture'], 'identity.jpg', { type: 'image/jpeg' });
const input = { telefonoNuevo: '+51999999999', motivo: 'Solicitud de prueba aislada' };

test('late identity upload after unmount never posts recovery using a subsequent account cookie', async () => {
  let owner: number | undefined = 1;
  const scope = new ProfileOperationScope(() => owner);
  scope.activate(owner);
  const operation = scope.start();
  let resolveUpload: (value: Adjunto) => void = () => {};
  const calls: string[] = [];
  const pending = submitProfileRecovery(operation, input, file, {
    upload: async (_file, privateFile, kind, options) => {
      assert.equal(privateFile, true); assert.equal(kind, 'IDENTIDAD'); assert.equal(options?.signal, operation.signal);
      return new Promise<Adjunto>((resolve) => { resolveUpload = resolve; });
    },
    recover: async () => { calls.push('POST recovery'); },
    remove: async () => { calls.push('DELETE orphan'); },
  });
  scope.invalidate(); // ProfilePage unmounts, so its account ref will never render again.
  owner = 2; scope.activate(owner);
  resolveUpload(attachment);
  assert.equal(await pending, false);
  assert.equal(operation.signal.aborted, true);
  assert.deepEqual(calls, []);
  assert.equal(scope.start().isCurrent(), true);
});

test('account render change invalidates old operation before effect cleanup runs', async () => {
  let owner: number | undefined = 1;
  const scope = new ProfileOperationScope(() => owner); scope.activate(owner);
  const operation = scope.start();
  owner = 2;
  let calls = 0;
  assert.equal(await submitProfileRecovery(operation, input, null, {
    upload: async () => { calls++; return attachment; },
    recover: async () => { calls++; }, remove: async () => { calls++; },
  }), false);
  assert.equal(calls, 0);
});

test('failed recovery cleans an uploaded orphan only while the same profile session remains authorized', async () => {
  let owner: number | undefined = 1;
  const scope = new ProfileOperationScope(() => owner); scope.activate(owner);
  const operation = scope.start();
  const removed: string[] = [];
  await assert.rejects(() => submitProfileRecovery(operation, input, file, {
    upload: async () => attachment,
    recover: async (data, signal) => { assert.equal(data.adjuntoId, attachment.id); assert.equal(signal, operation.signal); throw new Error('Rejected'); },
    remove: async (id, signal) => { assert.equal(signal.aborted, false); removed.push(id); },
  }), /Rejected/);
  assert.deepEqual(removed, [attachment.id]);

  const oldOperation = scope.start();
  await assert.rejects(() => submitProfileRecovery(oldOperation, input, file, {
    upload: async () => attachment,
    recover: async () => { scope.invalidate(); owner = 2; scope.activate(owner); throw new Error('Late failure'); },
    remove: async () => { throw new Error('Must never delete with account B'); },
  }), /Late failure/);
});

test('unmount aborts every in-flight profile mutation and prevents reuse of its generation', () => {
  let owner: number | undefined = 1;
  const scope = new ProfileOperationScope(() => owner); scope.activate(owner);
  const nickname = scope.start(), password = scope.start(), favorite = scope.start();
  scope.invalidate();
  for (const operation of [nickname, password, favorite]) { assert.equal(operation.signal.aborted, true); assert.equal(operation.isCurrent(), false); operation.finish(); }
  scope.activate(owner);
  assert.equal(nickname.isCurrent(), false);
  assert.equal(scope.start().isCurrent(), true);
});
