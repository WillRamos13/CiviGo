import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url), modules = new Map();
export function loadTs(filename) {
    const file = path.resolve(filename);
    if (modules.has(file)) return modules.get(file);
    const loadedModule = {exports: {}};
    modules.set(file, loadedModule.exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
    const run = vm.runInThisContext(`(function(module,exports,require){${source}\n})`, {filename: file});
    run(loadedModule, loadedModule.exports, specifier => specifier.startsWith('.') ? loadTs(path.resolve(path.dirname(file), `${specifier}.ts`)) : require(specifier));
    return loadedModule.exports;
}
