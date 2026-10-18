import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRequestReportReview, remainingEvidenceSlots, canAddPrivateEvidence, submitPrivateEvidence } from '../src/services/reportFollowup';
import { OperationScope } from '../src/services/operationScope';
import type { Reporte, Usuario, Adjunto } from '../src/types';

const report: Reporte = { id: 42, tipo: 'bache', descripcion: 'En revisión', estado: 'EN_REVISION', latitud: -14, longitud: -75, adjuntos: [], apelaciones: [] };
const user = { id: 1, correoVerificado: true, bloqueado: false } as Usuario;
const attachment: Adjunto = { id: 'private-proof', nombre: 'documento.pdf', url: '/api/uploads/private-proof', mimeType: 'application/pdf', privado: true, tipo: 'EVIDENCIA' };
const pdf = () => new File(['%PDF-1.7\nfixture'], 'documento.pdf', { type: 'application/pdf' });

test('reviews allow EN_REVISION and resolved appeals, but never duplicate a pending appeal', () => {
  assert.equal(canRequestReportReview(report), true);
  assert.equal(canRequestReportReview({ apelaciones: [{ id: 1, motivo: 'Anterior', estado: 'RECHAZADA', creadoEn: '2026-10-15' }] }), true);
  assert.equal(canRequestReportReview({ apelaciones: [{ id: 1, motivo: 'Pendiente', estado: 'PENDIENTE', creadoEn: '2026-10-15' }] }), false);
  assert.equal(canAddPrivateEvidence(report, user), true);
  assert.equal(canAddPrivateEvidence({ ...report, estado: 'FALSO' }, user), false);
  assert.equal(canAddPrivateEvidence(report, { ...user, bloqueado: true }), false);
  assert.equal(canAddPrivateEvidence(report, { ...user, correoVerificado: false }), false);
  assert.equal(remainingEvidenceSlots({ adjuntos: [attachment, attachment, attachment] }), 0);
});

test('additional proofs validate all files first, upload privately and attach to the original report', async () => {
  const calls: string[] = [];
  const operation = new OperationScope(() => 'account-A:42').begin();
  const updated = { ...report, adjuntos: [attachment] };
  const result = await submitPrivateEvidence(report, [pdf()], operation, {
    upload: async (file, privado, tipo, options) => {
      assert.equal(file.type, 'application/pdf'); assert.equal(privado, true); assert.equal(tipo, 'EVIDENCIA');
      assert.equal(options.signal, operation.signal); calls.push('upload'); return attachment;
    },
    attach: async (id, ids, signal) => { assert.equal(id, 42); assert.deepEqual(ids, [attachment.id]); assert.equal(signal, operation.signal); calls.push('attach'); return updated; },
    remove: async () => { throw new Error('No cleanup for attached proof'); },
  });
  assert.deepEqual(result, updated); assert.deepEqual(calls, ['upload', 'attach']);
});

test('forged PDFs and attachment overflow fail before any uploads', async () => {
  let sent = 0;
  const ports = { upload: async () => { sent++; return attachment; }, attach: async () => report, remove: async () => {} };
  const operation = new OperationScope(() => 'A').begin();
  await assert.rejects(submitPrivateEvidence(report, [new File(['not a PDF'], 'x.pdf', { type: 'application/pdf' })], operation, ports), /PDF/);
  await assert.rejects(submitPrivateEvidence({ ...report, adjuntos: [attachment, attachment, attachment] }, [pdf()], operation, ports), /máximo/);
  await assert.rejects(submitPrivateEvidence(report, [], operation, ports), /Selecciona/);
  assert.equal(sent, 0);
});

test('failed private proof submission cleans orphans only while the original operation is still active', async () => {
  const scope = new OperationScope(() => 'A'), operation = scope.begin();
  const removed: string[] = [];
  await assert.rejects(submitPrivateEvidence(report, [pdf()], operation, {
    upload: async () => attachment,
    attach: async () => { throw new Error('fallo'); },
    remove: async id => { removed.push(id); },
  }), /fallo/);
  assert.deepEqual(removed, [attachment.id]);
  const changed = scope.begin();
  await assert.rejects(submitPrivateEvidence(report, [pdf()], changed, {
    upload: async () => { scope.cancel(); return attachment; },
    attach: async () => { throw new Error('must not attach'); },
    remove: async () => { throw new Error('must not remove using later cookies'); },
  }), { name: 'AbortError' });
});

test('public or incorrectly typed uploads cannot become private evidence', async () => {
  let attached = false, cleaned = false;
  await assert.rejects(submitPrivateEvidence(report, [pdf()], new OperationScope(() => 'A').begin(), {
    upload: async () => ({ ...attachment, privado: false }),
    attach: async () => { attached = true; return report; },
    remove: async () => { cleaned = true; },
  }), /privacidad/);
  assert.equal(attached, false); assert.equal(cleaned, true);
});
