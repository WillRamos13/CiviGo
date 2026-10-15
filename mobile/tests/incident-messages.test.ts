import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIncidentMessages } from '../src/services/incidentMessages';
import type { Mensaje } from '../src/types';

const message = (id: number, creadoEn = '2026-10-15T15:00:00Z'): Mensaje => ({ id, creadoEn, mensaje: `Mensaje ${id}` });

test('a late initial chat snapshot preserves a newly acknowledged message', async () => {
  let release!: (messages: Mensaje[]) => void;
  let comments: Mensaje[] = [];
  const load = new Promise<Mensaje[]>((resolve) => { release = resolve; })
    .then((snapshot) => { comments = mergeIncidentMessages(snapshot, comments); });
  comments = mergeIncidentMessages(comments, [message(99, '2026-10-15T15:01:00Z')]);
  release([message(98)]);
  await load;
  assert.deepEqual(comments.map((item) => item.id), [98, 99]);
});

test('chat read and send responses may arrive in either order without duplicate messages', () => {
  const snapshot = [message(99), message(98)];
  for (const batch of [[snapshot, [message(99)]], [[message(99)], snapshot]]) {
    const merged = mergeIncidentMessages(...batch);
    assert.deepEqual(merged.map((item) => item.id), [98, 99]);
  }
  assert.deepEqual(mergeIncidentMessages([], [message(99)]).map((item) => item.id), [99]);
  const current = { ...message(99), mensaje: 'Respuesta confirmada del envío' };
  assert.equal(mergeIncidentMessages(snapshot, [current])[1].mensaje, snapshot[0].mensaje);
});

test('a moderated snapshot wins over the original send acknowledgment in either arrival order', () => {
  const acknowledgment = message(99);
  const removed = { ...acknowledgment, mensaje: '[Mensaje retirado por moderación]' };
  let comments = mergeIncidentMessages([], [acknowledgment]);
  comments = mergeIncidentMessages([removed], comments);
  assert.equal(comments[0].mensaje, removed.mensaje);
  comments = mergeIncidentMessages([removed], []);
  comments = mergeIncidentMessages(comments, [acknowledgment]);
  assert.equal(comments[0].mensaje, removed.mensaje);
  assert.equal(comments.length, 1);
});

test('merged chat messages retain server chronology, using IDs to order equal timestamps', () => {
  assert.deepEqual(mergeIncidentMessages([message(3, '2026-10-15T15:00:01Z'), message(2)], [message(1)])
    .map((item) => item.id), [1, 2, 3]);
});
