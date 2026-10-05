import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';

const { GoogleEmailFlow, firebaseEmailConfig, googleEmailErrorMessage } = loadTs('lib/firebase-email.ts');
const config = { apiKey: 'fixture-public-key', authDomain: 'fixture.firebaseapp.com', projectId: 'fixture-project', appId: 'fixture-public-app' };
const challenge = () => ({ challengeId: '123', projectId: config.projectId, expiresAt: new Date(Date.now() + 600000).toISOString() });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));

function fixture(overrides = {}) {
    const calls = { load: 0, request: 0, popup: 0, token: 0, commit: 0, signOut: 0 };
    const proofs = [];
    const sdk = {
        open: async email => { assert.equal(email, 'person@example.com'); calls.popup++; return { getIdToken: async () => { calls.token++; return 'fixture-id-token'; } }; },
        signOut: async () => { calls.signOut++; },
        ...overrides.sdk,
    };
    const load = overrides.load || (async actual => { assert.deepEqual(actual, config); calls.load++; return sdk; });
    const flow = new GoogleEmailFlow(overrides.config === undefined ? config : overrides.config, overrides.projectId === undefined ? config.projectId : overrides.projectId, load);
    const request = overrides.request || (async () => { calls.request++; return challenge(); });
    const commit = overrides.commit || (async proof => { calls.commit++; proofs.push(proof); return { verified: true }; });
    return { flow, calls, proofs, sdk, request, commit, verify: async () => { await flow.prepare(request); return flow.verify('person@example.com', commit); } };
}

test('Firebase requiere las cuatro variables públicas y no inventa configuración', () => {
    const names = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
        names.forEach(name => delete process.env[name]);
        assert.equal(firebaseEmailConfig(), null);
        names.forEach((name, index) => { process.env[name] = ` fixture-${index} `; });
        assert.deepEqual(firebaseEmailConfig(), { apiKey: 'fixture-0', authDomain: 'fixture-1', projectId: 'fixture-2', appId: 'fixture-3' });
        for (const name of names) { const previous = process.env[name]; process.env[name] = ' '; assert.equal(firebaseEmailConfig(), null); process.env[name] = previous; }
    } finally { names.forEach(name => { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }); }
});

test('Google verifica mediante una prueba en memoria y cierra solo el adaptador temporal', async () => {
    const f = fixture();
    assert.deepEqual(await f.verify(), { verified: true });
    assert.deepEqual(f.proofs, [{ challengeId: '123', idToken: 'fixture-id-token' }]);
    assert.deepEqual(f.calls, { load: 1, request: 1, popup: 1, token: 1, commit: 1, signOut: 1 });
});

test('Preparar no abre Google; el segundo clic abre la ventana antes de la primera suspensión asíncrona', async () => {
    let opened = false;
    const pending = defer();
    const f = fixture({ sdk: { open: email => { assert.equal(email, 'person@example.com'); opened = true; return pending.promise; } } });
    await f.flow.prepare(f.request);
    assert.equal(f.flow.prepared, true); assert.equal(opened, false);
    const verification = f.flow.verify('person@example.com', f.commit);
    assert.equal(opened, true);
    assert.equal(f.calls.request, 1);
    pending.resolve({ getIdToken: async () => 'fixture-id-token' });
    await verification;
    assert.equal(f.flow.prepared, false); assert.equal(f.flow.hasProof, false);
});

test('Verificar sin preparar no carga SDK, no solicita una prueba ni abre Google', async () => {
    const f = fixture();
    await assert.rejects(f.flow.verify('person@example.com', f.commit), /Primero prepara/);
    assert.equal(f.calls.load, 0); assert.equal(f.calls.request, 0); assert.equal(f.calls.popup, 0);
});

test('Configuración ausente o de otro proyecto impide cargar el SDK y solicitar una prueba', async () => {
    for (const options of [{ config: null }, { projectId: null }, { projectId: 'otro-proyecto' }]) {
        const f = fixture(options);
        await assert.rejects(f.verify(), /todavía no está disponible/);
        assert.equal(f.calls.load, 0); assert.equal(f.calls.request, 0); assert.equal(f.calls.popup, 0);
    }
});

test('Una solicitud inválida o de otro proyecto no abre la ventana Google', async () => {
    for (const value of [null, { ...challenge(), projectId: 'otro' }, { ...challenge(), challengeId: 'token-privado' }, { ...challenge(), expiresAt: 'invalida' }, { ...challenge(), expiresAt: new Date(0).toISOString() }]) {
        const f = fixture({ request: async () => value });
        await assert.rejects(f.verify(), /preparar la verificación/);
        assert.equal(f.calls.popup, 0); assert.equal(f.calls.commit, 0);
    }
});

test('Dos clics concurrentes crean una sola solicitud y una sola ventana', async () => {
    const pending = defer();
    const f = fixture({ request: () => { f.calls.request++; return pending.promise; } });
    const first = f.verify(); await tick();
    await assert.rejects(f.verify(), /ya está en curso/);
    pending.resolve(challenge()); await first;
    assert.equal(f.calls.request, 1); assert.equal(f.calls.popup, 1); assert.equal(f.calls.commit, 1);
});

test('Navegar mientras el backend responde impide abrir después Google', async () => {
    const pending = defer();
    const f = fixture({ request: () => pending.promise });
    const first = f.verify(); await tick(); f.flow.dispose(); pending.resolve(challenge());
    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(f.calls.popup, 0); assert.equal(f.calls.commit, 0);
    assert.ok(f.calls.signOut > 0);
});

test('La respuesta tardía de una ventana desmontada no envía un token a CiviGo', async () => {
    const pending = defer();
    const f = fixture({ sdk: { open: () => pending.promise } });
    const first = f.verify(); await tick(); f.flow.dispose();
    pending.resolve({ getIdToken: async () => { f.calls.token++; return 'fixture-private-token'; } });
    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(f.calls.token, 0); assert.equal(f.calls.commit, 0); assert.ok(f.calls.signOut > 0);
});

test('Un fallo de conexión al guardar reutiliza el token sin otra ventana ni solicitud', async () => {
    let attempts = 0;
    const f = fixture({ commit: async proof => { attempts++; f.proofs.push(proof); if (attempts === 1) throw Object.assign(new Error('Servicio no disponible'), { status: 503 }); return { verified: true }; } });
    await assert.rejects(f.verify(), /Servicio no disponible/);
    assert.deepEqual(await f.verify(), { verified: true });
    assert.equal(f.calls.request, 1); assert.equal(f.calls.popup, 1); assert.equal(f.calls.token, 1);
    assert.deepEqual(f.proofs[0], f.proofs[1]);
});

test('Una cuenta incorrecta libera la prueba y permite elegir otra sin crear otra solicitud', async () => {
    let attempts = 0;
    const f = fixture({ commit: async () => { if (++attempts === 1) throw Object.assign(new Error('Elige el correo registrado'), { code: 'EMAIL_GOOGLE_EMAIL_MISMATCH' }); return { verified: true }; } });
    await assert.rejects(f.verify(), /correo registrado/);
    assert.equal(f.calls.popup, 1); assert.equal(f.calls.signOut, 1);
    await f.verify();
    assert.equal(f.calls.request, 1); assert.equal(f.calls.popup, 2); assert.equal(f.calls.token, 2); assert.equal(f.calls.signOut, 2);
});

test('Una solicitud vencida requiere una nueva prueba solo al siguiente clic', async () => {
    let attempts = 0;
    const f = fixture({ commit: async () => { if (++attempts === 1) throw Object.assign(new Error('Solicitud vencida'), { code: 'VERIFICATION_EXPIRED' }); return { verified: true }; } });
    await assert.rejects(f.verify(), /Solicitud vencida/);
    assert.equal(f.calls.request, 1); assert.equal(f.calls.popup, 1);
    await f.verify();
    assert.equal(f.calls.request, 2); assert.equal(f.calls.popup, 2);
});

test('Popup bloqueado conserva la solicitud para un segundo clic explícito', async () => {
    let popups = 0;
    const f = fixture({ sdk: { open: async () => { if (++popups === 1) throw { code: 'auth/popup-blocked', message: 'fixture-remote-secret' }; return { getIdToken: async () => 'fixture-id-token' }; } } });
    await assert.rejects(f.verify(), error => error.code === 'auth/popup-blocked');
    await f.verify(); assert.equal(f.calls.request, 1); assert.equal(popups, 2);
});

test('Los errores Firebase se traducen sin mostrar mensajes remotos ni datos privados', () => {
    const secret = 'fixture-remote-secret-person@example.com';
    for (const code of ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/unauthorized-domain', 'auth/too-many-requests', 'auth/network-request-failed', secret]) {
        const message = googleEmailErrorMessage({ code, message: secret, customData: { email: secret } });
        assert.ok(message.length > 10); assert.ok(!message.includes(secret)); assert.ok(!message.includes('auth/'));
    }
});
