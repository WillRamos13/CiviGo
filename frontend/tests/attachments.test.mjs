import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { submitWithAttachments, remainingAttachmentSlots } = loadTs('lib/attachments.ts');
const { post, ApiError } = loadTs('lib/api.ts');
const file = name => new File(['synthetic private evidence'], name, { type: 'application/pdf' });
const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });

test('evidence capacity counts existing report attachments and never becomes negative', () => {
    assert.equal(remainingAttachmentSlots(undefined), 3);
    assert.equal(remainingAttachmentSlots([{}, {}]), 1);
    assert.equal(remainingAttachmentSlots([{}, {}, {}]), 0);
    assert.equal(remainingAttachmentSlots([{}, {}, {}, {}]), 0);
});

test('successful private evidence submission retains associated files and returns its receipt', async () => {
    const original = globalThis.fetch, requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return url.endsWith('/uploads') ? reply(201, { id: 'proof-1', privado: true }) : reply(200, { accepted: true });
    };
    try {
        const receipt = await submitWithAttachments([file('proof.pdf')], { privado: true, tipo: 'EVIDENCIA' }, attachments =>
            post('/reports/7/evidence', { adjuntosIds: attachments.map(item => item.id) }));
        assert.deepEqual(receipt, { accepted: true });
        assert.equal(requests.length, 2);
        assert.equal(requests[0].options.body.get('tipo'), 'EVIDENCIA');
        assert.equal(requests[0].options.body.get('privado'), 'true');
        assert.deepEqual(JSON.parse(requests[1].options.body), { adjuntosIds: ['proof-1'] });
        assert.ok(requests.every(request => request.options.credentials === 'include'));
    } finally { globalThis.fetch = original; }
});

test('a partial batch upload releases earlier successful files and never submits the report', async () => {
    const original = globalThis.fetch, requests = []; let submitted = false, uploads = 0;
    globalThis.fetch = async (url, options) => {
        requests.push({ url, method: options.method });
        if (options.method === 'DELETE') return reply(200, { eliminado: true });
        return ++uploads === 1 ? reply(201, { id: 'proof-1' }) : reply(413, { error: 'El archivo es demasiado grande.' });
    };
    try {
        await assert.rejects(submitWithAttachments([file('one.pdf'), file('two.pdf')], { privado: true, tipo: 'EVIDENCIA' }, async () => { submitted = true; }),
            error => error instanceof ApiError && error.status === 413);
        assert.equal(submitted, false);
        assert.deepEqual(requests.map(request => request.method), ['POST', 'POST', 'DELETE']);
        assert.equal(requests[2].url, '/api/uploads/proof-1');
    } finally { globalThis.fetch = original; }
});

test('a rejected identity request removes its unassociated document and preserves the actual error', async () => {
    const original = globalThis.fetch, requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/uploads')) return reply(201, { id: 'identity-1' });
        if (options.method === 'DELETE') return reply(200, { eliminado: true });
        return reply(409, { error: 'Ya existe una solicitud pendiente.', code: 'PENDING_RECOVERY' });
    };
    try {
        await assert.rejects(submitWithAttachments([file('identity.pdf')], { privado: true, tipo: 'IDENTIDAD' }, attachments =>
            post('/users/recovery', { adjuntoId: attachments[0]?.id })),
            error => error.code === 'PENDING_RECOVERY' && error.status === 409);
        assert.equal(requests[0].options.body.get('tipo'), 'IDENTIDAD');
        assert.equal(requests.at(-1).url, '/api/uploads/identity-1');
        assert.equal(requests.at(-1).options.method, 'DELETE');
    } finally { globalThis.fetch = original; }
});

test('cleanup denial after a lost mutation response never replaces the original error or retries the mutation', async () => {
    const original = globalThis.fetch, requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url, method: options.method });
        if (url.endsWith('/uploads')) return reply(201, { id: 'associated-proof' });
        if (options.method === 'DELETE') return reply(409, { error: 'Ya está asociado a un reporte.' });
        throw new TypeError('synthetic lost response');
    };
    try {
        await assert.rejects(submitWithAttachments([file('proof.pdf')], { privado: true, tipo: 'EVIDENCIA' }, attachments =>
            post('/reports/7/evidence', { adjuntosIds: attachments.map(item => item.id) })),
            error => error instanceof ApiError && error.status === 0);
        assert.equal(requests.filter(request => request.url.endsWith('/evidence')).length, 1);
        assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
    } finally { globalThis.fetch = original; }
});

test('verified phone recovery without an identity document still submits once without upload', async () => {
    let calls = 0;
    const result = await submitWithAttachments([], { privado: true, tipo: 'IDENTIDAD' }, async attachments => {
        calls++; assert.deepEqual(attachments, []); return { accepted: true };
    });
    assert.equal(calls, 1); assert.equal(result.accepted, true);
});
