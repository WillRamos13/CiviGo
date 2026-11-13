/** Start script/connect restrictions in report-only mode so providers remain usable. */
export function webSecurityHeaders(production: boolean) {
  const reportPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.spotify.com https://open.spotify.com https://www.gstatic.com https://*.googleapis.com https://*.firebaseapp.com https://*.i.posthog.com",
    "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://api.mapbox.com",
    "connect-src 'self' https://*.mapbox.com https://*.mapbox.cn https://*.googleapis.com https://*.firebaseapp.com https://*.firebaseio.com wss://*.firebaseio.com https://accounts.spotify.com https://api.spotify.com https://*.spotifycdn.com https://*.i.posthog.com https://*.supabase.co",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
    "frame-src https://open.spotify.com https://*.firebaseapp.com https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        'geolocation=(self), camera=(self), microphone=(self), fullscreen=(self), autoplay=(self "https://open.spotify.com")',
    },
    {
      key: "Content-Security-Policy",
      value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
    { key: "Content-Security-Policy-Report-Only", value: reportPolicy },
    ...(production
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
      : []),
  ];
}
