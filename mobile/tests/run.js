import { build } from 'esbuild';
import { readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const testsRoot = path.join(root, 'tests');
const outputRoot = path.join(root, '.test-build');

async function discover(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? discover(path.join(dir, entry.name))
    : /\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []));
  return nested.flat().sort();
}

let output;
try {
  const selected = process.argv.slice(2);
  const files = selected.length ? selected.map(name => {
    const resolved = path.resolve(root, name);
    if (!resolved.startsWith(testsRoot + path.sep) || !/\.[cm]?[jt]sx?$/.test(resolved)) {
      throw new Error('Sólo se pueden ejecutar archivos dentro de mobile/tests.');
    }
    return resolved;
  }) : await discover(testsRoot);
  if (!files.length) throw new Error('No se encontraron pruebas.');
  await mkdir(outputRoot, { recursive: true });
  output = await mkdtemp(path.join(outputRoot, 'run-'));
  await build({
    entryPoints: files,
    outbase: testsRoot,
    outdir: output,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'inline',
    jsx: 'automatic',
    logLevel: 'error',
    define: {
      'import.meta.env': JSON.stringify({
        MODE: 'test', DEV: true, PROD: false, BASE_URL: '/',
        VITE_API_URL: '/api', VITE_MAPBOX_TOKEN: '',
      }),
    },
  });
  const compiled = files.map(file => path.join(output,
    path.relative(testsRoot, file).replace(/\.[cm]?[jt]sx?$/, '.mjs')));
  const requested = Number(process.env.CIVIGO_TEST_TIMEOUT_MS);
  const timeout = Number.isFinite(requested) && requested >= 100 && requested <= 60000 ? requested : 15000;
  const childEnv = { ...process.env, NODE_ENV: 'test' };
  // A runner self-test starts a fresh test process, not a recursive node:test child.
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [
    '--test', '--test-concurrency=1', `--test-timeout=${timeout}`,
    '--import', pathToFileURL(path.join(testsRoot, 'network-guard.js')).href, ...compiled,
  ], { cwd: root, stdio: 'inherit', env: childEnv });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
} catch (error) {
  console.error('No se pudieron completar las pruebas móviles:', error);
  process.exitCode = 1;
} finally {
  // Only remove this invocation's generated directory, never existing sources.
  if (output?.startsWith(outputRoot + path.sep)) await rm(output, { recursive: true, force: true });
}
