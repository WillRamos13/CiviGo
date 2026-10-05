import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {SessionController, canParticipate} = loadTs('lib/session.ts');
const user = id => ({id, nickname: `usuario${id}`, rol: 'USUARIO', telefono: '', correo: '', premium: false, correoVerificado: true, credibilidad: 100, monedas: 0});
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const tick = () => new Promise(done => setImmediate(done));
function fixture(extra = {}) {
    const entries = new Map(), states = [];
    const storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key)};
    const controller = new SessionController({storage, loadUser: async () => user(1), endSession: async () => {}, networkAvailable: () => true, isUnavailable: error => error.status === 0 || error.status >= 500, onChange: state => states.push(state), ...extra});
    return {controller, entries, storage, states, state: () => states.at(-1)};
}
test('late /me cannot restore an account after logout', async () => {
    const old = defer(); let signal;
    const f = fixture({loadUser: received => { signal = received; return old.promise; }});
    const refresh = f.controller.refresh(); await tick();
    await f.controller.logout();
    assert.equal(signal.aborted, true);
    old.resolve(user(1)); await refresh;
    assert.equal(f.state().usuario, null);
    assert.equal(f.entries.has('civigo:offline-account'), false);
});
test('newer account refresh wins when older response arrives last', async () => {
    const first = defer(), second = defer(); let count = 0;
    const f = fixture({loadUser: () => ++count === 1 ? first.promise : second.promise});
    const a = f.controller.refresh(); await tick();
    const b = f.controller.refresh(); await tick();
    second.resolve(user(2)); await b; first.resolve(user(1)); await a;
    assert.equal(f.state().usuario.id, 2);
    assert.equal(JSON.parse(f.entries.get('civigo:offline-account')).id, 2);
});
test('offline logout closes local account even when browser storage is blocked', async () => {
    let online = true, ended = 0;
    const blocked = () => { throw new Error('SecurityError'); };
    const f = fixture({storage: {getItem: blocked, setItem: blocked, removeItem: blocked}, networkAvailable: () => online, endSession: async () => { ended++; }});
    await f.controller.refresh(); online = false;
    await assert.rejects(f.controller.logout(), /sesión local se cerró/);
    assert.equal(f.state().usuario, null);
    online = true; await f.controller.prepareLogin();
    assert.equal(ended, 1);
});
test('queued logout is flushed before a new login can create its session', async () => {
    let online = false; const order = [];
    const f = fixture({networkAvailable: () => online, endSession: async () => { order.push('logout'); }});
    f.entries.set('civigo:offline-account', JSON.stringify(user(1)));
    await f.controller.refresh(); await f.controller.logout();
    online = true; await f.controller.prepareLogin(); order.push('login');
    assert.deepEqual(order, ['logout', 'login']);
    assert.equal(f.entries.has('civigo:logout-pending'), false);
});
test('persisted revocation prevents cached identity from reappearing offline', async () => {
    const f = fixture({networkAvailable: () => false});
    f.entries.set('civigo:logout-pending', 'true');
    f.entries.set('civigo:offline-account', JSON.stringify(user(1)));
    await f.controller.refresh();
    assert.equal(f.state().usuario, null); assert.equal(f.state().offline, true);
});
test('cached identity cannot grant role, verified email, participation, credibility or coins', async () => {
    const f = fixture({networkAvailable: () => false});
    f.entries.set('civigo:offline-account', JSON.stringify({...user(1), rol: 'ADMIN', monedas: 900, credibilidad: 100}));
    await f.controller.refresh();
    assert.equal(f.state().usuario.rol, 'USUARIO');
    assert.equal(f.state().usuario.correoVerificado, false);
    assert.equal(canParticipate(f.state().usuario), false);
    assert.equal(f.state().usuario.credibilidad, null); assert.equal(f.state().usuario.monedas, 0);
});
test('authorization denial never falls back to a cached account', async () => {
    const f = fixture({loadUser: async () => { throw {status: 401}; }});
    f.entries.set('civigo:offline-account', JSON.stringify(user(1)));
    await f.controller.refresh();
    assert.equal(f.state().usuario, null); assert.equal(f.state().offline, false);
    assert.equal(f.entries.has('civigo:offline-account'), false);
});
test('service outage uses readonly cache without leaving session loading', async () => {
    const f = fixture({loadUser: async () => { throw {status: 503}; }});
    f.entries.set('civigo:offline-account', JSON.stringify(user(1)));
    await f.controller.refresh();
    assert.equal(f.state().usuario.id, 1); assert.equal(f.state().offline, true); assert.equal(f.state().loading, false);
});
test('offline consultation preserves the saved advertising preference', async () => {
    let online = true;
    const f = fixture({networkAvailable: () => online, loadUser: async () => ({...user(1), premium: true, ocultarAnuncios: true})});
    await f.controller.refresh(); online = false; await f.controller.refresh();
    assert.equal(f.state().usuario.ocultarAnuncios, true);
    assert.equal(f.state().usuario.correoVerificado, false);
});
test('participation requires verified email and ignores legacy phone verification', () => {
    assert.equal(canParticipate({...user(1), telefonoVerificado: false}), true);
    assert.equal(canParticipate({...user(1), correoVerificado: false, telefonoVerificado: true}), false);
    assert.equal(canParticipate({...user(1), telefonoVerificado: true, bloqueado: true}), false);
    assert.equal(canParticipate(null), false);
    assert.equal(canParticipate(undefined), false);
});
test('participation only accepts a confirmed boolean email verification', () => {
    for (const correoVerificado of [undefined, null, false, 1, 'true']) {
        assert.equal(canParticipate({...user(1), correoVerificado}), false);
    }
    assert.equal(canParticipate({...user(1), correo: 'demo@civigo.test'}), true);
});
