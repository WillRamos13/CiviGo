import { api, crearReporte, post, upload } from './api';
import type { Adjunto } from '../types';

export const MAX_REPORT_FILES = 3;
export const MAX_REPORT_FILE_BYTES = 15 * 1024 * 1024;
export const REPORT_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
const allowed = new Set(REPORT_FILE_ACCEPT.split(','));

export interface EvidenceRules {
  fotoObligatoria: boolean;
  individual: boolean;
  maxVideoBytes?: number;
}

export interface ReportSubmissionContext {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

function assertActive(context: ReportSubmissionContext): void {
  if (context.signal?.aborted || context.isCurrent?.() === false) {
    throw new DOMException('El envío se canceló porque cambió la sesión o se cerró el formulario.', 'AbortError');
  }
}

export function reportVideoLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1024 * 1024
    ? Math.min(value, MAX_REPORT_FILE_BYTES)
    : MAX_REPORT_FILE_BYTES;
}

function hasSignature(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  switch (mime) {
    case 'image/jpeg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/png': return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case 'image/gif': return /^GIF8[79]a$/.test(ascii(0, 6));
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4': return ascii(4, 4) === 'ftyp';
    case 'video/quicktime': return ascii(4, 4) === 'ftyp' && ascii(8, 4) === 'qt  ';
    case 'video/webm': return [26, 69, 223, 163].every((byte, index) => bytes[index] === byte);
    default: return false;
  }
}

async function decodeImage(file: File): Promise<void> {
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(file);
    try {
      if (!image.width || !image.height) throw new Error('Imagen vacía.');
    } finally { image.close(); }
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('Imagen vacía.'));
      image.onerror = () => reject(new Error('Imagen dañada.'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function validateEvidenceFile(
  file: File,
  maxVideoBytes = MAX_REPORT_FILE_BYTES,
  decode: (file: File) => Promise<void> = decodeImage,
  context: ReportSubmissionContext = {},
): Promise<void> {
  assertActive(context);
  if (!allowed.has(file.type)) throw new Error('Solo se admiten fotos JPEG, PNG, WebP o GIF y videos MP4, MOV o WebM.');
  const limit = file.type.startsWith('video/') ? reportVideoLimit(maxVideoBytes) : MAX_REPORT_FILE_BYTES;
  if (file.size === 0) throw new Error('El archivo está vacío. Selecciona otra foto o video.');
  if (file.size > limit) throw new Error(`El archivo supera el límite de ${Math.round(limit / 1048576)} MB.`);
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  assertActive(context);
  if (!hasSignature(bytes, file.type)) throw new Error('El contenido del archivo no coincide con su formato.');
  if (file.type.startsWith('image/')) {
    try { await decode(file); }
    catch {
      assertActive(context);
      throw new Error('No se pudo leer la fotografía. Selecciona una imagen válida.');
    }
    assertActive(context);
  }
}

export async function validateReportEvidence(files: File[], rules: EvidenceRules, context: ReportSubmissionContext = {}): Promise<void> {
  assertActive(context);
  if (files.length > MAX_REPORT_FILES) throw new Error('Adjunta como máximo tres archivos.');
  for (const file of files) {
    assertActive(context);
    await validateEvidenceFile(file, rules.maxVideoBytes, undefined, context);
    assertActive(context);
  }
  if (rules.fotoObligatoria && !files.some((file) => file.type.startsWith('image/'))) {
    throw new Error('Este tipo de incidente requiere al menos una fotografía válida; un video no la reemplaza.');
  }
}

type CreatedReport = Awaited<ReturnType<typeof crearReporte>>;
export interface ReportTransport {
  upload: (file: File, privado: boolean, tipo: 'PUBLICO', options?: { signal?: AbortSignal }) => Promise<Adjunto>;
  create: (data: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<CreatedReport>;
  remove: (id: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

const transport: ReportTransport = {
  upload,
  create: (data, options) => post<CreatedReport>('/reports', data, options),
  remove: (id, options) => api(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE', signal: options?.signal }),
};

export async function submitReportWithEvidence(
  data: Record<string, unknown>,
  files: File[],
  rules: EvidenceRules,
  ports: ReportTransport = transport,
  context: ReportSubmissionContext = {},
): Promise<CreatedReport> {
  assertActive(context);
  await validateReportEvidence(files, rules, context);
  assertActive(context);
  const uploaded: string[] = [];
  try {
    for (const file of files) {
      assertActive(context);
      // Reports consume PUBLICO attachments; individual reports additionally require privacy.
      const attachment = await ports.upload(file, rules.individual, 'PUBLICO', { signal: context.signal });
      assertActive(context);
      if (typeof attachment.id !== 'string' || !attachment.id || uploaded.includes(attachment.id)) {
        throw new Error('El servidor no devolvió un adjunto válido.');
      }
      uploaded.push(attachment.id);
      if (rules.individual && attachment.privado !== true) {
        throw new Error('No se pudo confirmar la privacidad de la evidencia.');
      }
    }
    assertActive(context);
    const result = await ports.create({ ...data, adjuntosIds: uploaded }, { signal: context.signal });
    assertActive(context);
    return result;
  } catch (error) {
    // Orphan cleanup belongs to the original session; never delete using a later account's cookies.
    if (context.signal?.aborted || context.isCurrent?.() === false) throw error;
    await Promise.allSettled(uploaded.map(async (id) => {
      assertActive(context);
      await ports.remove(id, { signal: context.signal });
      assertActive(context);
    }));
    throw error;
  }
}
