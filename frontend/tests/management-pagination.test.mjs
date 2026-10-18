import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('la bandeja de agentes vuelve a una página existente al resolver el último pendiente', async () => {
  const values = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0;
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useCallback(value) { return value; },
    useEffect(effect) { effects.push(effect); },
  };
  const requests = [];
  let pageData = { items: [{ id: 51 }], total: 51, page: 2, pageSize: 50, pages: 2 };
  const code = ts.transpileModule(fs.readFileSync('components/management/common.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URLSearchParams, AbortController,
    require: name => ({ react, 'react/jsx-runtime': {}, 'next/link': {}, '@/components/AuthProvider': {}, '@/lib/api': { api: async path => { requests.push(path); return pageData; } } })[name],
    window: { addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true }, setInterval: () => 0, clearInterval() {},
  });
  const cleanups = [];
  async function render() {
    stateIndex = 0; refIndex = 0; effects.length = 0;
    const result = exports.usePagedRemote('/admin/incidents', { estado: 'REVISION' });
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    await new Promise(resolve => setImmediate(resolve));
    return result;
  }
  try {
    const first = await render(); first.setPage(2);
    await render();
    pageData = { items: [], total: 50, page: 2, pageSize: 50, pages: 1 };
    await render(); await render();
    pageData = { items: [{ id: 1 }], total: 50, page: 1, pageSize: 50, pages: 1 };
    const recovered = await render();
    assert.equal(recovered.page, 1);
    assert.ok(requests.at(-1).includes('page=1&limit=50&estado=REVISION'));
  } finally { for (const cleanup of cleanups) cleanup(); }
});
