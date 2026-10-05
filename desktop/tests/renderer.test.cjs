const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(name, imports, browser) {
  const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const code = ts.transpileModule(source, { fileName: name, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { if (!(name in imports)) throw new Error('Import inesperado: ' + name); return imports[name]; }, window: browser, crypto, DOMException, setInterval, clearInterval, Uint8Array, FormData, Blob, Date, console }, { filename: name });
  return exports;
}
const ok = data => ({ ok: true, data });
const unwrap = value => { if (!value.ok) throw new Error(value.error.message); return value.data; };

test('AbortSignal del renderer cancela en main la lectura correspondiente', async () => {
  const cancellations = []; let requested;
  const api = loadSource('lib/api.ts', {}, { civigoDesktop: { request: value => { requested = value; return new Promise(() => {}); }, cancelRead: async id => { cancellations.push(id); return ok(); } } });
  const controller = new AbortController();
  const pending = api.api('/admin/users', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0], requested.requestId);
  assert.equal(requested.method, 'GET');
});

test('la cancelación de interfaz no intenta abortar una mutación ya enviada', async () => {
  let finish; const cancellations = [];
  const api = loadSource('lib/api.ts', {}, { civigoDesktop: { request: () => new Promise(resolve => { finish = resolve; }), cancelRead: async id => { cancellations.push(id); return ok(); } } });
  const controller = new AbortController();
  const pending = api.post('/admin/config', { piloto: true }, { signal: controller.signal });
  controller.abort(); finish(ok({ realizado: true }));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancellations.length, 0);
});

function authFixture(bridge) {
  const state = []; const effects = []; let index = 0;
  const react = { createContext: () => ({ Provider: 'Provider' }), useState: initial => { const position = index++; state[position] = initial; return [initial, value => { state[position] = typeof value === 'function' ? value(state[position]) : value; }]; }, useCallback: value => value, useContext: () => null, useRef: value => ({ current: value }), useEffect: value => effects.push(value) };
  const source = loadSource('components/AuthProvider.tsx', { react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) }, '@/lib/api': { unwrap } }, { civigoDesktop: bridge });
  const tree = source.AuthProvider({ children: null });
  return { auth: tree.props.value, state, effects };
}

test('un refresh antiguo fallido no elimina una sesión iniciada después', async () => {
  let reject; const pending = new Promise((_resolve, fail) => { reject = fail; });
  const current = { id: 2, rol: 'ADMIN', nickname: 'second-fixture' };
  const fixture = authFixture({ session: () => pending, login: async () => ok(current) });
  const refresh = fixture.auth.refresh();
  await fixture.auth.login('second@example.test', 'fixture');
  reject(new Error('refresh viejo')); await refresh;
  assert.equal(fixture.state[0], current);
});

test('un refresh antiguo exitoso no repone usuario después de logout', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const fixture = authFixture({ session: () => pending, logout: async () => ok() });
  const refresh = fixture.auth.refresh();
  await fixture.auth.logout(); resolve(ok({ id: 1, rol: 'ADMIN' })); await refresh;
  assert.equal(fixture.state[0], null);
});

test('un evento de sesión nuevo prevalece sobre una consulta vieja', async () => {
  let resolve; let listener; const pending = new Promise(done => { resolve = done; });
  const fixture = authFixture({ session: () => pending, onSession: callback => { listener = callback; return () => {}; } });
  const cleanup = fixture.effects[0]();
  const current = { id: 3, rol: 'ADMIN' }; listener(current);
  resolve(ok({ id: 1, rol: 'ADMIN' }));
  await new Promise(done => setImmediate(done));
  assert.equal(fixture.state[0], current);
  cleanup();
});
