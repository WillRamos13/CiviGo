import { api, post, upload } from './api';
import { canParticipate } from './auth';
import { MAX_REPORT_FILE_BYTES, REPORT_FILE_ACCEPT, validateEvidenceFile } from './reportEvidence';
import type { OperationToken } from './operationScope';
import type { Adjunto, Reporte, Usuario } from '../types';

export const PRIVATE_EVIDENCE_ACCEPT = `${REPORT_FILE_ACCEPT},application/pdf`;

export function canRequestReportReview(report: Pick<Reporte, 'apelaciones'>): boolean {
  return !report.apelaciones?.some(appeal => appeal.estado === 'PENDIENTE');
}

export function remainingEvidenceSlots(report: Pick<Reporte, 'adjuntos'>): number {
  return Math.max(0, 3 - (report.adjuntos?.length || 0));
}

export function canAddPrivateEvidence(report: Reporte, user: Usuario | null): boolean {
  return canParticipate(user) && !['FALSO', 'RETIRADO'].includes(report.estado) && remainingEvidenceSlots(report) > 0;
}

interface FollowupPorts {
  upload: (file: File, privado: true, tipo: 'EVIDENCIA', options: { signal: AbortSignal }) => Promise<Adjunto>;
  attach: (id: number, ids: string[], signal: AbortSignal) => Promise<Reporte>;
  remove: (id: string, signal: AbortSignal) => Promise<unknown>;
  validateImage?: (file: File) => Promise<void>;
}

const transport: FollowupPorts = {
  upload,
  attach: (id, ids, signal) => post(`/reports/${id}/evidence`, { adjuntosIds: ids }, { signal }),
  remove: (id, signal) => api(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
};

export async function submitPrivateEvidence(
  report: Reporte, files: File[], operation: OperationToken, ports: FollowupPorts = transport,
): Promise<Reporte> {
  operation.assertActive();
  if (!Number.isSafeInteger(report.id) || report.id <= 0 || ['FALSO', 'RETIRADO'].includes(report.estado))
    throw new Error('Solicita y espera la revisión de tu apelación antes de añadir pruebas.');
  if (!files.length || files.length > remainingEvidenceSlots(report))
    throw new Error(`Selecciona entre uno y ${remainingEvidenceSlots(report)} archivos; el máximo es tres por reporte.`);
  const context = { signal: operation.signal, isCurrent: operation.isActive };
  for (const file of files) {
    operation.assertActive();
    if (file.type === 'application/pdf') {
      if (!file.size || file.size > MAX_REPORT_FILE_BYTES) throw new Error('El documento debe tener contenido y pesar como máximo 15 MB.');
      const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      operation.assertActive();
      if (String.fromCharCode(...bytes) !== '%PDF-') throw new Error('El contenido del documento no coincide con su formato PDF.');
    } else await validateEvidenceFile(file, undefined, ports.validateImage, context);
  }
  operation.assertActive();
  const uploaded: string[] = [];
  try {
    for (const file of files) {
      operation.assertActive();
      const attachment = await ports.upload(file, true, 'EVIDENCIA', { signal: operation.signal });
      operation.assertActive();
      if (typeof attachment.id !== 'string' || !attachment.id || uploaded.includes(attachment.id)) throw new Error('No se recibió un identificador válido para la prueba.');
      uploaded.push(attachment.id);
      if (attachment.privado !== true || attachment.tipo !== 'EVIDENCIA') throw new Error('No se pudo confirmar la privacidad de la prueba.');
    }
    operation.assertActive();
    const updated = await ports.attach(report.id, uploaded, operation.signal);
    operation.assertActive();
    if (!updated || updated.id !== report.id || !Array.isArray(updated.adjuntos)) throw new Error('Actualiza tus reportes para comprobar si las pruebas quedaron registradas.');
    return updated;
  } catch (error) {
    // Never clean up with a later account's cookie or a disposed screen.
    if (operation.isActive()) await Promise.allSettled(uploaded.map(id => ports.remove(id, operation.signal)));
    throw error;
  }
}
