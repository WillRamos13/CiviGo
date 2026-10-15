import { api, upload } from './api';
import type { Adjunto } from './types';

export function remainingAttachmentSlots(attachments: readonly unknown[] | undefined) {
    return Math.max(0, 3 - (attachments?.length ?? 0));
}

// Deletion only accepts the current user's unattached files. If the mutation
// committed but its response was lost, the server keeps the associated files.
export async function submitWithAttachments<T>(
    files: readonly File[],
    options: { privado?: boolean; tipo?: 'PUBLICO' | 'EVIDENCIA' | 'IDENTIDAD' },
    submit: (attachments: Adjunto[]) => Promise<T>,
): Promise<T> {
    const attachments: Adjunto[] = [];
    try {
        for (const file of files) attachments.push(await upload(file, options.privado, options.tipo));
        return await submit(attachments);
    } catch (error) {
        await Promise.allSettled(attachments.map(attachment => api(`/uploads/${encodeURIComponent(attachment.id)}`, { method: 'DELETE', timeoutMs: 10000 })));
        throw error;
    }
}
