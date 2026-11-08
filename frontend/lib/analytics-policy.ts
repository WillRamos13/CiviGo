const pages = new Set(['/', '/mapa', '/reportar', '/mis-reportes', '/alertas', '/ranking', '/recompensas', '/contactanos', '/perfil', '/premium', '/ingresar', '/registro', '/verificar']);
const actions = new Set(['hero_map', 'closing_map', 'feature_0', 'feature_1', 'feature_2', 'feature_3']);
const modes = new Set(['walking', 'cycling', 'driving']);
export const PRODUCT_EVENTS = new Set(['$pageview', 'civigo_home_action', 'civigo_route_started', 'civigo_route_finished', 'civigo_performance']);

export function analyticsPage(path: string): string {
  const clean = path.split(/[?#]/, 1)[0];
  return pages.has(clean) ? clean : '/otra';
}

// A whitelist also strips SDK-added referrers, original URLs and user properties.
export function sanitizeAnalyticsProperties(input: Record<string, unknown>): Record<string, unknown> {
  const page = analyticsPage(typeof input.page === 'string' ? input.page : '/otra');
  const result: Record<string, unknown> = { page, app_platform: 'web', $current_url: `https://civigo.online${page}`, $pathname: page, $host: 'civigo.online', $process_person_profile: false, $geoip_disable: true };
  for (const key of ['token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version', '$insert_id']) {
    if (typeof input[key] === 'string' && input[key].length <= 180) result[key] = input[key];
  }
  if (typeof input.action === 'string' && actions.has(input.action)) result.action = input.action;
  if (typeof input.transport === 'string' && modes.has(input.transport)) result.transport = input.transport;
  for (const [key, max] of [['ttfb_ms', 60000], ['lcp_ms', 120000], ['cls', 100], ['duration_seconds', 86400]] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) result[key] = Math.min(max, Math.round(input[key] * 100) / 100);
  }
  return result;
}
