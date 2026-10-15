export interface ReportDraft { slug: string; description: string; eventDate: string }
export interface DraftStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const pending = new Map<string, Promise<void>>();

export function reportDraftKey(userId: number | null | undefined): string | null {
  return Number.isSafeInteger(userId) && Number(userId) > 0 ? `civigo:report-draft:${userId}` : null;
}

function parseDraft(raw: string | null): ReportDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.slug !== 'string' || !/^[a-z0-9-]{0,100}$/.test(draft.slug)
      || typeof draft.description !== 'string' || draft.description.length > 2000
      || typeof draft.eventDate !== 'string' || draft.eventDate.length > 32) return null;
    return { slug: draft.slug, description: draft.description, eventDate: draft.eventDate };
  } catch { return null; }
}

export async function readReportDraft(userId: number | undefined, storage: DraftStorage): Promise<ReportDraft | null> {
  const key = reportDraftKey(userId);
  if (!key) return null;
  await pending.get(key)?.catch(() => {});
  return parseDraft(await storage.get(key));
}

function enqueue(key: string, action: () => Promise<void>): Promise<void> {
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}

export function saveReportDraft(userId: number | undefined, draft: ReportDraft, storage: DraftStorage): Promise<void> {
  const key = reportDraftKey(userId);
  return key ? enqueue(key, () => storage.set(key, JSON.stringify(draft))) : Promise.resolve();
}

export function clearReportDraft(userId: number | undefined, storage: DraftStorage): Promise<void> {
  const key = reportDraftKey(userId);
  // Removal follows pending saves so logout cannot resurrect a private draft.
  return key ? enqueue(key, () => storage.remove(key)) : Promise.resolve();
}
