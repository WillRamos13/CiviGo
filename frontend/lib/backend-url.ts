import { isIP } from 'node:net';

type BackendEnvironment = { BACKEND_URL?: string; VERCEL?: string };
const LOCAL_BACKEND = 'http://127.0.0.1:4000';
const PRIVATE_SUFFIXES = new Set(['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'intranet', 'corp', 'private', 'test', 'invalid', 'example', 'onion', 'arpa']);
const CONFIGURATION_HINT = 'Configura BACKEND_URL en Vercel con el dominio HTTPS público del backend de Railway, por ejemplo https://tu-api.up.railway.app, sin /api, rutas, credenciales, parámetros ni fragmentos.';

function invalidBackend(): Error {
    // Never include the supplied URL: an accidental value may contain a password or token.
    return new Error(`BACKEND_URL debe ser un origen HTTPS público para Vercel. ${CONFIGURATION_HINT} No se permiten localhost, dominios internos ni direcciones IP.`);
}

export function resolveBackendUrl(environment: BackendEnvironment = { BACKEND_URL: process.env.BACKEND_URL, VERCEL: process.env.VERCEL }): string {
    if (environment.VERCEL !== '1') return (environment.BACKEND_URL || LOCAL_BACKEND).replace(/\/$/, '');

    const value = environment.BACKEND_URL?.trim();
    if (!value) throw new Error(`Falta BACKEND_URL para compilar CiviGo en Vercel. ${CONFIGURATION_HINT}`);

    // Require an origin, not an endpoint. Check the original form too so URL
    // normalization cannot silently remove a path such as /api/.. or a bare ?/#.
    if (!/^https:\/\/[^\s/?#\\]+\/?$/i.test(value)) throw invalidBackend();
    let url: URL;
    try { url = new URL(value); } catch { throw invalidBackend(); }
    if (url.protocol !== 'https:' || url.username || url.password || value.includes('@') || url.search || url.hash || url.pathname !== '/') throw invalidBackend();

    const hostname = url.hostname.replace(/\.$/, '');
    const address = hostname.replace(/^\[|\]$/g, '');
    const labels = hostname.split('.');
    if (isIP(address) || labels.length < 2 || hostname.length > 253
        || PRIVATE_SUFFIXES.has(labels.at(-1) ?? '')
        || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalidBackend();

    url.hostname = hostname;
    return url.origin;
}
