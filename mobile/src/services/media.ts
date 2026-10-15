import { BASE_API_URL } from './api';

const uploadPath = /^\/api\/uploads\/[A-Za-z0-9_-]+$/;

// Attachment URLs must remain on the configured API origin, including private evidence.
export function resolveMediaUrl(value: string | null | undefined, apiBase = BASE_API_URL): string | null {
  if (!value) return null;
  const origin = typeof location !== 'undefined' ? location.origin : undefined;
  let endpoint: URL | null = null;
  try {
    endpoint = new URL(apiBase, origin);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) return null;
  } catch { /* Relative web API in offline tests. */ }
  if (uploadPath.test(value)) return endpoint ? new URL(value, endpoint.origin).href : value;
  try {
    const url = new URL(value);
    if (!endpoint || url.origin !== endpoint.origin || !['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash || !uploadPath.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
