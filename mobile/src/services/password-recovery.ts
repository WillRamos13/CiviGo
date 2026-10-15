const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function trustedOrigins(): string[] {
  const values = [import.meta.env.VITE_PUBLIC_APP_URL || 'https://civigo.online'];
  if (typeof location !== 'undefined') values.push(location.origin);
  return values.flatMap(value => {
    try {
      const url = new URL(value);
      return url.username || url.password ? [] : [url.origin];
    } catch { return []; }
  });
}

export function isPasswordResetLocation(href: string): boolean {
  try {
    const url = new URL(href);
    return /^\/recuperar\/?$/.test(url.pathname) && new URLSearchParams(url.hash.slice(1)).has('token');
  } catch { return false; }
}

/** Extract only; a pasted link is never opened or fetched. */
export function passwordResetToken(input: string, origins: readonly string[] = trustedOrigins()): string | null {
  const value = input.trim();
  if (TOKEN_PATTERN.test(value)) return value;
  if (value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || !origins.includes(url.origin) ||
        !/^\/recuperar\/?$/.test(url.pathname) || url.search) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    if (Array.from(params.keys()).length !== 1 || params.getAll('token').length !== 1) return null;
    const token = params.get('token');
    return token && TOKEN_PATTERN.test(token) ? token : null;
  } catch { return null; }
}

/** Remove recovery secrets from this page's history, preserving unrelated URLs. */
export function consumePasswordResetLocation(
  currentLocation: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState' | 'state'>
): string | null {
  if (!isPasswordResetLocation(currentLocation.href)) return null;
  const url = new URL(currentLocation.href);
  const token = passwordResetToken(url.href, [url.origin]);
  history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  return token;
}
