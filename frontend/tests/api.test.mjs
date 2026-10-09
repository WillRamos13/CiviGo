import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {api, ApiError} = loadTs('lib/api.ts');
async function expectResponseError(status, payload, message) {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ok: false, status, json: async () => payload});
    try {
        await assert.rejects(api('/synthetic'), error => {
            assert.ok(error instanceof ApiError);
            assert.equal(error.status, status);
            assert.equal(error.code, payload?.code);
            assert.equal(error.message, message);
            return true;
        });
    }
    finally { globalThis.fetch = original; }
}

const rawPrismaError = 'PrismaClientInitializationError: database connection failed with password=SYNTHETIC_SECRET_DO_NOT_DISPLAY';
const serviceUnavailableMessage = 'El servicio de CiviGo no está disponible en este momento. Inténtalo de nuevo.';

for (const status of [500, 502, 503]) {
    test(`HTTP ${status} hides raw Prisma details from both error payload fields`, async () => {
        await expectResponseError(status, {error: rawPrismaError, code: 'INTERNAL_ERROR'}, serviceUnavailableMessage);
        await expectResponseError(status, {mensaje: rawPrismaError}, serviceUnavailableMessage);
    });
}

for (const [code, message] of [
    ['ROADS_UNAVAILABLE', 'Los datos de calles no están disponibles en este momento. Inténtalo de nuevo más tarde.'],
    ['PLACES_SEARCH_UNAVAILABLE', 'No se pudo ampliar la búsqueda de lugares. Prueba con otro nombre o dirección, o inténtalo más tarde.'],
    ['EMAIL_GOOGLE_CONFIG', 'La verificación con Google no está disponible en este momento. Inténtalo de nuevo más tarde.'],
    ['EMAIL_GOOGLE_UNAVAILABLE', 'La verificación con Google no está disponible en este momento. Inténtalo de nuevo más tarde.'],
    ['STORAGE_PRIVATE_BUCKET_REQUIRED', 'No se pudo acceder al archivo. Inténtalo de nuevo más tarde o comunícalo al administrador.'],
    ['STORAGE_CONFIG', 'No se pudo acceder al archivo. Inténtalo de nuevo más tarde o comunícalo al administrador.'],
]) {
    test(`HTTP 503 ${code} uses a fixed readable message without exposing the payload`, async () => {
        await expectResponseError(503, {error: rawPrismaError, mensaje: rawPrismaError, code}, message);
        await expectResponseError(500, {error: rawPrismaError, code}, serviceUnavailableMessage);
    });
}

test('HTTP 400 keeps ordinary validation messages and error codes', async () => {
    await expectResponseError(400, {error: 'Regístrate con un correo Gmail.', code: 'EMAIL_GMAIL_REQUIRED'}, 'Regístrate con un correo Gmail.');
    await expectResponseError(400, {mensaje: 'Completa los campos requeridos.'}, 'Completa los campos requeridos.');
});

test('HTTP 403 ACCOUNT_BLOCKED keeps the account message and code', async () => {
    const message = 'Tu cuenta está bloqueada. Puedes solicitar revisión desde Mis reportes.';
    await expectResponseError(403, {error: message, code: 'ACCOUNT_BLOCKED'}, message);
});

test('caller abort remains cancellation instead of a misleading network outage', async () => {
    const original = globalThis.fetch, controller = new AbortController();
    globalThis.fetch = async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); };
    try { await assert.rejects(api('/synthetic', {signal: controller.signal}), error => error.name === 'AbortError' && !(error instanceof ApiError)); }
    finally { globalThis.fetch = original; }
});
test('abort during JSON reading cannot return incomplete successful data', async () => {
    const original = globalThis.fetch, controller = new AbortController();
    globalThis.fetch = async () => ({ok: true, json: async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }});
    try { await assert.rejects(api('/synthetic', {signal: controller.signal}), error => error.name === 'AbortError'); }
    finally { globalThis.fetch = original; }
});
test('real network failure keeps the readable connection error and zero status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('synthetic network failure'); };
    try { await assert.rejects(api('/synthetic'), error => error instanceof ApiError && error.status === 0 && /conectar/.test(error.message)); }
    finally { globalThis.fetch = original; }
});
