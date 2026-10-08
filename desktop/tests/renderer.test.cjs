const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(name, imports, browser, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const code = ts.transpileModule(source, { fileName: name, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { if (!(name in imports)) throw new Error('Import inesperado: ' + name); return imports[name]; }, window: browser, crypto, DOMException, setInterval, clearInterval, Uint8Array, FormData, Blob, Date, console, ...globals }, { filename: name });
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

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map(child => findNode(child, predicate)).find(Boolean) ?? null;
  return predicate(tree) ? tree : findNode(tree.props?.children, predicate);
}
function componentFixture(file, imports = {}) {
  let current;
  const react = {
    useState(initial) {
      const store = current, index = store.index++;
      if (!(index in store.values)) store.values[index] = typeof initial === 'function' ? initial() : initial;
      return [store.values[index], value => { store.values[index] = typeof value === 'function' ? value(store.values[index]) : value; }];
    },
    useRef(initial) { return react.useState(() => ({ current: initial }))[0]; },
  };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
  const source = loadSource(file, { react, 'react/jsx-runtime': runtime, ...imports }, {}, {
    FormData: class { constructor(fields) { this.fields = fields; } get(name) { return this.fields[name] ?? null; } },
  });
  function mount(Component, props = {}) {
    const store = { index: 0, values: [] };
    return { render() { current = store; store.index = 0; return Component(props); } };
  }
  return { source, mount };
}
function usersFixture(user = null) {
  const requests = [], saved = [];
  const common = { useRemote: route => ({ data: route === '/catalog' ? { distritos: ['Ica'] } : user ? [user] : [], reload() {}, loading: false }), Feedback: 'feedback', RemoteStatus: 'remote', number: String, message: error => error.message };
  const renderer = componentFixture('components/management/UsersPanel.tsx', {
    '@/lib/api': { api: async (route, options) => { requests.push({ route, method: options.method, body: JSON.parse(options.body) }); } },
    '@/components/AuthProvider': { useAuth: () => ({ usuario: { id: 1 }, refresh: async () => {} }) }, './common': common,
    '@/components/EditorPanel': { default: 'editor-panel' },
  });
  const panel = renderer.mount(renderer.source.default);
  findNode(panel.render(), node => node.type === 'button' && node.props.children === (user ? 'Administrar' : 'Crear usuario')).props.onClick();
  const form = findNode(panel.render(), node => typeof node.type === 'function' && node.props.user === user);
  return { requests, saved, form: renderer.mount(form.type, { ...form.props, save: feedback => saved.push(feedback) }) };
}
const createFields = { nombres: 'Ana', apellidos: 'Ejemplo', nickname: 'ana_fixture', correo: 'ana@gmail.com', telefono: '+51912345678', fechaNacimiento: '1990-01-01', password: 'fixture-password' };

test('crear usuario envía identidad, rol y verificación justificada por la ruta administrativa', async () => {
  const fixture = usersFixture();
  let tree = fixture.form.render();
  findNode(tree, node => node.type === 'input' && node.props.name === 'correoVerificado').props.onChange({ target: { checked: true } });
  tree = fixture.form.render();
  findNode(tree, node => node.type === 'textarea' && node.props.name === 'motivoVerificacion').props.onChange({ target: { value: 'Comprobado con el titular por el administrador.' } });
  await findNode(fixture.form.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: createFields });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].route, '/admin/users');
  assert.equal(fixture.requests[0].method, 'POST');
  assert.equal(fixture.requests[0].body.nickname, 'ana_fixture');
  assert.equal(fixture.requests[0].body.password, createFields.password);
  assert.equal(fixture.requests[0].body.rol, 'USUARIO');
  assert.equal(fixture.requests[0].body.correoVerificado, true);
  assert.equal(fixture.requests[0].body.motivoVerificacion, 'Comprobado con el titular por el administrador.');
  assert.equal(fixture.saved.length, 1);
});

test('crear ciudadano rechaza correo ajeno a Gmail y verificar requiere motivo', async () => {
  const fixture = usersFixture();
  let tree = fixture.form.render();
  await findNode(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { ...createFields, correo: 'ana@example.test' } });
  assert.equal(fixture.requests.length, 0);
  assert.match(findNode(fixture.form.render(), node => node.type === 'feedback').props.error, /Gmail/);
  findNode(fixture.form.render(), node => node.type === 'input' && node.props.name === 'correoVerificado').props.onChange({ target: { checked: true } });
  await findNode(fixture.form.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: createFields });
  assert.equal(fixture.requests.length, 0);
  assert.match(findNode(fixture.form.render(), node => node.type === 'feedback').props.error, /10 caracteres/);
});

test('crear agente admite correo institucional y conserva su distrito y permisos', async () => {
  const fixture = usersFixture();
  findNode(fixture.form.render(), node => node.type === 'select' && node.props.value === 'USUARIO').props.onChange({ target: { value: 'AGENTE' } });
  findNode(fixture.form.render(), node => node.type === 'select' && node.props.value === '').props.onChange({ target: { value: 'Ica' } });
  await findNode(fixture.form.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { ...createFields, correo: 'agente@example.test' } });
  assert.equal(fixture.requests[0].body.correo, 'agente@example.test');
  assert.equal(fixture.requests[0].body.rol, 'AGENTE');
  assert.equal(fixture.requests[0].body.tipoAgente, 'SERENAZGO');
  assert.equal(fixture.requests[0].body.distrito, 'Ica');
  assert.deepEqual(fixture.requests[0].body.permisos, []);
  assert.equal(fixture.requests[0].body.correoVerificado, false);
  assert.equal('motivoVerificacion' in fixture.requests[0].body, false);
});

test('editar la verificación envía bandera y motivo sin inventar nuevos datos de identidad', async () => {
  const fixture = usersFixture({ id: 2, nickname: 'user_fixture', correo: 'ana@gmail.com', rol: 'USUARIO', correoVerificado: false, premium: false, bloqueado: false, permisos: [] });
  findNode(fixture.form.render(), node => node.type === 'input' && node.props.name === 'correoVerificado').props.onChange({ target: { checked: true } });
  findNode(fixture.form.render(), node => node.type === 'textarea' && node.props.name === 'motivoVerificacion').props.onChange({ target: { value: 'Titular comprobado durante revisión administrativa.' } });
  await findNode(fixture.form.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: {} });
  assert.equal(fixture.requests[0].route, '/admin/users/2');
  assert.equal(fixture.requests[0].method, 'PATCH');
  assert.equal(fixture.requests[0].body.correoVerificado, true);
  assert.equal(fixture.requests[0].body.motivoVerificacion, 'Titular comprobado durante revisión administrativa.');
  assert.equal('correo' in fixture.requests[0].body, false);
  assert.equal('password' in fixture.requests[0].body, false);
});

test('descargar adjunto usa el puente autenticado y entrega sus errores a la interfaz', async () => {
  const ids = [];
  const api = loadSource('lib/api.ts', {}, { civigoDesktop: { download: async id => { ids.push(id); return ok({ guardado: true }); } } });
  assert.equal((await api.downloadAttachment('private-fixture')).guardado, true);
  assert.deepEqual(ids, ['private-fixture']);
  const renderer = componentFixture('components/AttachmentDownload.tsx', { '@/lib/api': { downloadAttachment: async () => { throw new Error('No tienes permiso para este archivo.'); }, errorMessage: error => error.message } });
  const view = renderer.mount(renderer.source.default, { id: 'private-fixture', children: 'Descargar documento' });
  await findNode(view.render(), node => node.type === 'button').props.onClick();
  assert.equal(findNode(view.render(), node => node.props.role === 'alert').props.children, 'No tienes permiso para este archivo.');
  assert.equal(findNode(view.render(), node => node.type === 'button').props.disabled, false);
});

test('cancelar descarga no anuncia archivo guardado y evita dos diálogos simultáneos', async () => {
  let finish, count = 0;
  const renderer = componentFixture('components/AttachmentDownload.tsx', { '@/lib/api': { downloadAttachment: () => { count++; return new Promise(resolve => { finish = resolve; }); }, errorMessage: error => error.message } });
  const view = renderer.mount(renderer.source.default, { id: 'private-fixture', children: 'Descargar documento' });
  const button = findNode(view.render(), node => node.type === 'button');
  const first = button.props.onClick();
  await button.props.onClick();
  assert.equal(count, 1);
  finish({ cancelado: true }); await first;
  assert.equal(findNode(view.render(), node => node.props.role === 'status'), null);
  assert.equal(findNode(view.render(), node => node.type === 'button').props.disabled, false);
});

test('abrir o cambiar el editor lleva el foco y desplaza su contenedor debajo de la cabecera sin interrumpir la escritura', () => {
  const calls = [];
  const panel = {
    style: {},
    focus: options => calls.push(['focus', { ...options }]),
    scrollIntoView: options => calls.push(['scroll', { ...options }]),
  };
  let previous, pending;
  const react = {
    useRef: () => ({ current: panel }),
    useLayoutEffect(effect, dependencies) {
      if (!previous || dependencies.some((value, index) => value !== previous[index])) pending = effect;
      previous = dependencies;
    },
  };
  const source = loadSource('components/EditorPanel.tsx', {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  }, {}, { document: { querySelector: selector => {
    assert.equal(selector, '.desktop-header');
    return { getBoundingClientRect: () => ({ height: 82 }) };
  } } });
  function render(selectionKey, children) {
    const tree = source.default({ selectionKey, children, label: 'Administrar usuario' });
    if (pending) { const effect = pending; pending = undefined; effect(); }
    return tree;
  }
  const tree = render('2:1', 'Formulario inicial');
  assert.equal(tree.props.role, 'region');
  assert.equal(tree.props.tabIndex, -1);
  assert.equal(tree.props['aria-label'], 'Administrar usuario');
  assert.equal(panel.style.scrollMarginTop, '98px');
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { block: 'start', behavior: 'auto' }]]);
  render('2:1', 'Datos escritos por el administrador');
  assert.equal(calls.length, 2, 'Escribir no debe desplazar la vista ni robar el foco al campo.');
  render('2:2', 'El mismo usuario abierto desde su botón otra vez');
  assert.equal(calls.length, 4, 'Volver a abrir el mismo usuario debe mostrar otra vez su editor.');
  render('3:3', 'Otro usuario seleccionado');
  assert.equal(calls.length, 6, 'Seleccionar otro usuario debe volver a mostrar su editor.');
});
