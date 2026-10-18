import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { AuthService, SessionController, SessionRevocation, updateAuthNetworkStatus, type SessionState } from '../src/services/auth';
import { api, ApiError, advanceApiSession, onUnauthorized, resolveApiUrl } from '../src/services/api';
import { firebaseEmailConfig, createNativeGoogleEmailSdk, GoogleEmailFlow, GoogleEmailError, googleEmailErrorMessage, type GoogleEmailSdk } from '../src/services/firebase-email';
import type { Usuario } from '../src/types';
import { StorageService } from '../src/services/native';
import { passwordResetToken, isPasswordResetLocation, consumePasswordResetLocation } from '../src/services/password-recovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const user = { id: 7, nickname: 'Ciudadano', correo: 'ciudadano@gmail.com', rol: 'AGENTE', correoVerificado: true, permisos: ['validar'], telefono: '+51999999999', monedas: 120, premium: false, ocultarAnuncios: false, credibilidad: 4 } as Usuario;

test('server logout works when the WebView lacks AbortSignal.timeout', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
  const originalFetch = globalThis.fetch;
  const controller = new SessionController(() => {}, () => true);
  let logouts = 0;
  updateAuthNetworkStatus(true);
  try {
    Object.defineProperty(AbortSignal, 'timeout', { ...descriptor, value: undefined });
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /\/users\/logout$/);
      assert.equal(options?.method, 'POST');
      assert.ok(options?.signal instanceof AbortSignal);
      logouts++;
      return new Response(JSON.stringify({ mensaje: 'Sesión cerrada.' }));
    };
    await controller.logout();
    assert.equal(logouts, 1);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', descriptor);
    globalThis.fetch = originalFetch;
    controller.invalidate();
  }
});
function fixture() {
  const data = new Map<string, string>();
  let online = true;
  let loadCalls = 0;
  let revokeCalls = 0;
  let revoke: () => Promise<unknown> = async () => {};
  let load: () => Promise<Usuario> = async () => user;
  let state: SessionState = { usuario: null, loading: true, offline: false };
  const storage = { get: async (key: string) => data.get(key) ?? null, set: async (key: string, value: string) => { data.set(key, value); }, remove: async (key: string) => { data.delete(key); } };
  const boundary = new SessionRevocation(storage, async () => { revokeCalls++; return revoke(); }, () => online);
  const create = () => new SessionController(next => { state = next; }, () => online, { revocation: boundary, loadUser: async () => { loadCalls++; return load(); } });
  const controller = create();
  return { data, boundary, controller, create, storage, get state() { return state; }, get loadCalls() { return loadCalls; }, get revokeCalls() { return revokeCalls; }, setOnline(value: boolean) { online = value; }, setLoad(value: typeof load) { load = value; }, setRevoke(value: typeof revoke) { revoke = value; } };
}

describe('Real session lifecycle with isolated storage and transport', () => {
  test('offline logout immediately clears UI, persists a boolean and cannot restore on restart', async () => {
    const f = fixture();
    await f.controller.refresh();
    f.data.set('civigo:report-draft:7', JSON.stringify({ description: 'private current account draft' }));
    f.data.set('civigo:report-draft:8', JSON.stringify({ description: 'another account draft' }));
    f.setOnline(false);
    const logout = f.controller.logout();
    assert.equal(f.state.usuario, null);
    await logout;
    assert.equal(f.data.get('civigo:logout-pending'), 'true');
    assert.equal(f.data.has('civigo:offline-account'), false);
    assert.equal(f.data.has('civigo:report-draft:7'), false);
    assert.equal(f.data.has('civigo:report-draft:8'), true);
    const restartedBoundary = new SessionRevocation(f.storage, async () => {}, () => false);
    const restarted = new SessionController(next => assert.equal(next.usuario, null), () => false, { revocation: restartedBoundary, loadUser: async () => { throw new Error('network must not run'); } });
    await restarted.refresh();
    assert.equal(f.revokeCalls, 0);
  });

  test('retry revokes the old cookie before /me or a new login; 401 also acknowledges revocation', async () => {
    const f = fixture();
    f.setOnline(false);
    await f.controller.logout();
    f.setOnline(true);
    const order: string[] = [];
    f.setRevoke(async () => { order.push('logout'); throw new ApiError('expired', 401); });
    f.setLoad(async () => { order.push('me'); return user; });
    await f.controller.refresh();
    assert.deepEqual(order, ['logout', 'me']);
    assert.equal(f.data.has('civigo:logout-pending'), false);
    f.setOnline(false); await f.controller.logout(); f.setOnline(true);
    await f.boundary.authenticate(async () => { order.push('login'); });
    assert.deepEqual(order, ['logout', 'me', 'logout', 'login']);
  });

  test('failed revocation blocks refresh and login without resurrecting the old account', async () => {
    const f = fixture();
    f.setOnline(false); await f.controller.logout(); f.setOnline(true);
    f.setRevoke(async () => { throw new ApiError('offline', 0); });
    await f.controller.refresh();
    assert.equal(f.state.usuario, null);
    assert.equal(f.loadCalls, 0);
    let loginRan = false;
    await assert.rejects(f.boundary.authenticate(async () => { loginRan = true; }));
    assert.equal(loginRan, false);
    assert.equal(f.data.get('civigo:logout-pending'), 'true');
  });

  test('late /me and offline cache reads cannot undo logout', async () => {
    const f = fixture();
    const response = deferred<Usuario>();
    const started = deferred<void>();
    f.setLoad(async () => { started.resolve(); return response.promise; });
    const refreshing = f.controller.refresh();
    await started.promise;
    f.setOnline(false); await f.controller.logout();
    response.resolve(user); await refreshing;
    assert.equal(f.state.usuario, null);
    assert.equal(f.data.has('civigo:offline-account'), false);
  });

  test('in-flight login is followed by logout before another cookie can be restored', async () => {
    const f = fixture();
    const response = deferred<string>();
    const started = deferred<void>();
    const order: string[] = [];
    f.setRevoke(async () => { order.push('logout'); });
    const login = f.boundary.authenticate(async () => { order.push('login-start'); started.resolve(); const value = await response.promise; order.push('login-cookie'); return value; });
    const rejection = assert.rejects(login, /cancelado/);
    await started.promise;
    const logout = f.controller.logout();
    assert.equal(f.state.usuario, null);
    response.resolve('unused');
    await rejection; await logout;
    assert.deepEqual(order, ['login-start', 'login-cookie', 'logout']);
  });

  test('cached account contains display hints only and never grants online capabilities', async () => {
    const f = fixture();
    await f.controller.refresh();
    assert.deepEqual(Object.keys(JSON.parse(f.data.get('civigo:offline-account')!)).sort(), ['id', 'nickname', 'ocultarAnuncios', 'premium']);
    f.setOnline(false); await f.controller.refresh();
    assert.equal(f.state.usuario?.rol, 'USUARIO');
    assert.equal(f.state.usuario?.correoVerificado, false);
    assert.equal(f.state.usuario?.correo, '');
    assert.equal(f.state.usuario?.telefono, '');
  });

  test('401 session expiry clears cached account immediately', async () => {
    const f = fixture();
    await f.controller.refresh();
    f.data.set('civigo:report-draft:7', 'private current account draft');
    f.data.set('civigo:report-draft:8', 'another account draft');
    f.controller.expire();
    assert.equal(f.state.usuario, null);
    await f.boundary.store(async () => {});
    f.setOnline(false); await f.controller.refresh();
    assert.equal(f.state.usuario, null);
    assert.equal(f.data.has('civigo:report-draft:7'), false);
    assert.equal(f.data.has('civigo:report-draft:8'), true);
  });
  test('401 on cold start clears the cached account draft before any user was restored', async () => {
    const f = fixture();
    f.data.set('civigo:offline-account', JSON.stringify({ id: 7, nickname: 'Ciudadano' }));
    f.data.set('civigo:report-draft:7', 'private current account draft');
    f.data.set('civigo:report-draft:8', 'another account draft');
    f.controller.expire();
    await f.boundary.store(async () => {});
    assert.equal(f.data.has('civigo:offline-account'), false);
    assert.equal(f.data.has('civigo:report-draft:7'), false);
    assert.equal(f.data.has('civigo:report-draft:8'), true);
  });
});

const config = { apiKey: 'public-test-key', authDomain: 'civigo-test.firebaseapp.com', projectId: 'civigo-test', appId: '1:test:web:test' };
const email = 'ciudadano@gmail.com';
const token = (overrides: Record<string, unknown> = {}) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ aud: config.projectId, iss: `https://securetoken.google.com/${config.projectId}`, email, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...overrides })).toString('base64url')}.signature`;
const challenge = () => ({ challengeId: '42', projectId: config.projectId, expiresAt: new Date(Date.now() + 60000).toISOString() });
function googleFixture(options: { email?: string; proof?: string } = {}) {
  let opened = 0, signedOut = 0;
  const sdk: GoogleEmailSdk = { open: async () => { opened++; return { email: options.email || email, emailVerified: true, getIdToken: async () => options.proof || token() }; }, signOut: async () => { signedOut++; } };
  const flow = new GoogleEmailFlow(config, async () => sdk);
  return { flow, get opened() { return opened; }, get signedOut() { return signedOut; } };
}

describe('Google email verification with mocked SDK and backend only', () => {
  test('native build without Firebase plugin fails honestly before requesting a challenge or opening a provider', async context => {
    context.mock.method(Capacitor, 'isNativePlatform', () => true);
    context.mock.method(Capacitor, 'isPluginAvailable', (name: string) => {
      assert.equal(name, 'FirebaseAuthentication');
      return false;
    });
    let requested = 0;
    const flow = new GoogleEmailFlow(config);
    await assert.rejects(flow.prepare(async () => { requested++; return challenge(); }), {
      code: 'native-configuration',
      message: /aún no está configurada/,
    });
    assert.equal(requested, 0);
    assert.equal(flow.prepared, false);
    assert.equal(flow.hasProof, false);
    flow.dispose();
  });
  test('native bridge obtains a Firebase token instead of the Google OAuth credential and signs out immediately', async () => {
    const order: string[] = [];
    const sdk = createNativeGoogleEmailSdk({
      signOut: async () => { order.push('signOut'); },
      signInWithGoogle: async options => { assert.equal(options.skipNativeAuth, false); order.push('Google'); return { user: { email, emailVerified: true }, credential: { idToken: 'wrong-google-oauth-token' } }; },
      getIdToken: async options => { assert.equal(options.forceRefresh, true); order.push('FirebaseToken'); return { token: token() }; },
    });
    const result = await sdk.open(email);
    assert.equal(await result.getIdToken(), token());
    assert.deepEqual(order, ['signOut', 'Google', 'FirebaseToken', 'signOut']);
  });
  test('native bridge cleans up after token retrieval fails', async () => {
    let signedOut = 0;
    const sdk = createNativeGoogleEmailSdk({
      signOut: async () => { signedOut++; },
      signInWithGoogle: async () => ({ user: { email, emailVerified: true } }),
      getIdToken: async () => { throw new Error('test token failure'); },
    });
    await assert.rejects(sdk.open(email), /test token failure/);
    assert.equal(signedOut, 2);
  });
  test('disposing a queued native verification never opens its Google window', async () => {
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    let opened = 0, committed = 0, signedOut = 0;
    const bridge = {
      signOut: async () => { signedOut++; },
      signInWithGoogle: async () => {
        opened++;
        if (opened === 1) { firstStarted.resolve(); await releaseFirst.promise; }
        return { user: { email, emailVerified: true } };
      },
      getIdToken: async () => ({ token: token() }),
    };
    const load = async () => createNativeGoogleEmailSdk(bridge);
    const first = new GoogleEmailFlow(config, load), queued = new GoogleEmailFlow(config, load);
    await first.prepare(async () => challenge()); await queued.prepare(async () => challenge());
    const running = first.verify(email, async () => 'verified');
    await firstStarted.promise;
    const canceled = queued.verify(email, async () => { committed++; });
    const rejected = assert.rejects(canceled, { name: 'AbortError' });
    queued.dispose();
    releaseFirst.resolve();
    assert.equal(await running, 'verified');
    await rejected;
    assert.equal(opened, 1);
    assert.equal(committed, 0);
    assert.equal(signedOut, 2);
    first.dispose();
  });
  test('native cancellation during initial cleanup prevents opening Google and still cleans up', async () => {
    const cleaning = deferred<void>(), release = deferred<void>();
    let signedOut = 0, opened = 0;
    const sdk = createNativeGoogleEmailSdk({
      signOut: async () => { signedOut++; if (signedOut === 1) { cleaning.resolve(); await release.promise; } },
      signInWithGoogle: async () => { opened++; return { user: { email, emailVerified: true } }; },
      getIdToken: async () => ({ token: token() }),
    });
    const pending = sdk.open(email);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await cleaning.promise;
    await sdk.signOut();
    release.resolve();
    await rejected;
    assert.equal(opened, 0);
    assert.equal(signedOut, 2);
  });
  test('requires all public Firebase settings and a valid project', () => {
    assert.equal(firebaseEmailConfig({}), null);
    assert.deepEqual(firebaseEmailConfig({ VITE_FIREBASE_API_KEY: config.apiKey, VITE_FIREBASE_AUTH_DOMAIN: config.authDomain, VITE_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_APP_ID: config.appId }), config);
  });
  test('Android uses its validated native project without requiring web Firebase options', () => {
    assert.deepEqual(firebaseEmailConfig({ CIVIGO_ANDROID_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_PROJECT_ID: 'different-web-project' }, 'android'), { projectId: config.projectId, native: true });
    for (const projectId of ['', 'bad/project', '123456', 'a'.repeat(31)])
      assert.equal(firebaseEmailConfig({ CIVIGO_ANDROID_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_PROJECT_ID: config.projectId }, 'android'), null);
    assert.equal(firebaseEmailConfig({ CIVIGO_ANDROID_FIREBASE_PROJECT_ID: config.projectId }, 'web'), null);
  });
  test('native-only configuration still verifies the challenge and Firebase proof project', async () => {
    const nativeConfig = firebaseEmailConfig({ CIVIGO_ANDROID_FIREBASE_PROJECT_ID: config.projectId }, 'android');
    let proof = token(), opened = 0, committed = 0;
    const flow = new GoogleEmailFlow(nativeConfig, async () => ({
      open: async () => { opened++; return { email, emailVerified: true, getIdToken: async () => proof }; },
      signOut: async () => {},
    }));
    await assert.rejects(flow.prepare(async () => ({ ...challenge(), projectId: 'different-project' })), GoogleEmailError);
    assert.equal(opened, 0);
    await flow.prepare(async () => challenge());
    proof = token({ aud: 'different-project' });
    await assert.rejects(flow.verify(email, async () => { committed++; }), GoogleEmailError);
    assert.equal(committed, 0);
    await flow.prepare(async () => challenge());
    proof = token();
    await flow.verify(email, async payload => { assert.equal(payload.idToken, proof); committed++; });
    assert.equal(committed, 1);
    flow.dispose();
  });
  test('prepares challenge before Google sign-in and sends Firebase proof automatically', async () => {
    const f = googleFixture();
    await f.flow.prepare(async () => challenge());
    assert.equal(f.opened, 0);
    const result = await f.flow.verify(email, async proof => { assert.equal(proof.challengeId, '42'); assert.equal(proof.idToken, token()); return 'verified'; });
    assert.equal(result, 'verified'); assert.equal(f.opened, 1); assert.ok(f.signedOut > 0); assert.equal(f.flow.hasProof, false);
  });
  test('rejects project mismatch and expired challenge before opening Google', async () => {
    const f = googleFixture();
    await assert.rejects(f.flow.prepare(async () => ({ ...challenge(), projectId: 'another-project' })), GoogleEmailError);
    await assert.rejects(f.flow.prepare(async () => ({ ...challenge(), expiresAt: '2020-01-01' })), GoogleEmailError);
    assert.equal(f.opened, 0);
  });
  test('requires same verified Gmail and Firebase issuer, not a Google OAuth token', async () => {
    for (const options of [{ email: 'another@gmail.com' }, { proof: token({ aud: 'oauth-client.apps.googleusercontent.com', iss: 'https://accounts.google.com' }) }, { proof: token({ email_verified: false }) }]) {
      const f = googleFixture(options);
      await f.flow.prepare(async () => challenge());
      let committed = false;
      await assert.rejects(f.flow.verify(email, async () => { committed = true; }));
      assert.equal(committed, false); assert.equal(f.flow.hasProof, false); assert.ok(f.signedOut > 0);
    }
  });
  test('retries a failed backend save using the proof in memory without reopening Google', async () => {
    const f = googleFixture();
    await f.flow.prepare(async () => challenge());
    await assert.rejects(f.flow.verify(email, async () => { throw new ApiError('unavailable', 503); }));
    assert.equal(f.flow.hasProof, true);
    await f.flow.verify(email, async () => 'ok');
    assert.equal(f.opened, 1); assert.equal(f.flow.hasProof, false);
  });
  test('a rejected proof requires a new Google authentication; disposal prevents a late commit', async () => {
    const f = googleFixture();
    await f.flow.prepare(async () => challenge());
    await assert.rejects(f.flow.verify(email, async () => { throw new ApiError('different email', 400, 'EMAIL_GOOGLE_EMAIL_MISMATCH'); }));
    await f.flow.verify(email, async () => 'ok');
    assert.equal(f.opened, 2);
    const delayed = deferred<Awaited<ReturnType<GoogleEmailSdk['open']>>>();
    const flow = new GoogleEmailFlow(config, async () => ({ open: () => delayed.promise, signOut: async () => {} }));
    await flow.prepare(async () => challenge());
    let committed = false;
    const running = flow.verify(email, async () => { committed = true; });
    const rejection = assert.rejects(running, { name: 'AbortError' });
    flow.dispose();
    delayed.resolve({ email, emailVerified: true, getIdToken: async () => token() });
    await rejection; assert.equal(committed, false);
  });
  test('SDK error translation does not expose remote messages or credentials', () => {
    const message = googleEmailErrorMessage({ code: 'auth/network-request-failed', message: 'private-token-do-not-show' });
    assert.match(message, /conexión/); assert.doesNotMatch(message, /private-token/);
  });
});

describe('API cookie boundary and expiry transport', () => {
  test('rejects outside URLs, credentials, fragments, scheme tricks and path traversal', () => {
    for (const path of ['https://attacker.invalid/api/users/me', '//attacker.invalid/api/users/me', '/users/me#secret', 'javascript:alert(1)', '/../private', '/%2e%2e/private', 'https://u:p@localhost/api/users/me', '/users/\\evil']) assert.throws(() => resolveApiUrl(path), ApiError);
    assert.match(resolveApiUrl('/users/me?view=mobile'), /\/api\/users\/me\?view=mobile$/);
  });
  test('uses cookie credentials and invalidates only a current authenticated 401', async () => {
    const originalFetch = globalThis.fetch;
    let expired = 0;
    const unsubscribe = onUnauthorized(() => { expired++; });
    try {
      globalThis.fetch = async (_url, options) => { assert.equal(options?.credentials, 'include'); return new Response(JSON.stringify({ error: 'expired' }), { status: 401 }); };
      await assert.rejects(api('/users/me')); assert.equal(expired, 1);
      await assert.rejects(api('/users/login', { method: 'POST' })); assert.equal(expired, 1);
      const delayed = deferred<Response>();
      globalThis.fetch = () => delayed.promise;
      const request = api('/users/me'); const rejection = assert.rejects(request);
      advanceApiSession(); delayed.resolve(new Response('{}', { status: 401 }));
      await rejection; assert.equal(expired, 1);
    } finally { globalThis.fetch = originalFetch; unsubscribe(); }
  });
});

describe('Authentication backend contracts and cookie persistence', () => {
  test('login confirms the cookie with /me before reporting success', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    updateAuthNetworkStatus(true);
    try {
      globalThis.fetch = async (url, options) => {
        const pathname = new URL(String(url)).pathname;
        calls.push(pathname);
        if (pathname === '/api/users/login') assert.deepEqual(JSON.parse(String(options?.body)), { correo: user.correo, password: 'local-test-password' });
        return new Response(JSON.stringify({ usuario: user }));
      };
      assert.equal((await AuthService.login(user.correo, 'local-test-password')).id, user.id);
      assert.deepEqual(calls, ['/api/users/login', '/api/users/me']);
    } finally { globalThis.fetch = originalFetch; }
  });
  test('a successful login response without a usable cookie is not claimed as signed in', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async url => new URL(String(url)).pathname.endsWith('/login')
        ? new Response(JSON.stringify({ usuario: user })) : new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
      await assert.rejects(AuthService.login(user.correo, 'local-test-password'), { code: 'SESSION_NOT_PERSISTED' });
    } finally { globalThis.fetch = originalFetch; }
  });
  test('registration sends backend-supported names and confirms the created session', async () => {
    const originalFetch = globalThis.fetch;
    const data = { nombre: 'Nombre de prueba', apellidos: 'Apellido', nickname: 'Ciudadano', correo: user.correo, telefono: '+51999999999', fechaNacimiento: '2000-01-01', password: 'local-test-password' };
    try {
      globalThis.fetch = async (url, options) => {
        if (new URL(String(url)).pathname.endsWith('/register')) assert.deepEqual(JSON.parse(String(options?.body)), data);
        return new Response(JSON.stringify({ usuario: user }));
      };
      assert.equal((await AuthService.register(data)).id, user.id);
    } finally { globalThis.fetch = originalFetch; }
  });
  test('a blocked account keeps its confirmed restricted session and reports the block', async () => {
    const originalFetch = globalThis.fetch;
    let confirmed = false;
    try {
      globalThis.fetch = async url => {
        if (new URL(String(url)).pathname.endsWith('/login')) return new Response(JSON.stringify({ error: 'Cuenta bloqueada.', code: 'ACCOUNT_BLOCKED', usuario: { ...user, bloqueado: true } }), { status: 403 });
        confirmed = true;
        return new Response(JSON.stringify({ usuario: { ...user, bloqueado: true } }));
      };
      await assert.rejects(AuthService.login(user.correo, 'local-test-password'), { code: 'ACCOUNT_BLOCKED' });
      assert.equal(confirmed, true);
    } finally { globalThis.fetch = originalFetch; }
  });
  test('password reset clears local session and cached display hints after server success', async () => {
    const originalFetch = globalThis.fetch;
    let invalidated = 0;
    const unsubscribe = onUnauthorized(() => { invalidated++; });
    try {
      await StorageService.set('civigo:offline-account', JSON.stringify({ id: user.id, nickname: user.nickname }));
      globalThis.fetch = async (_url, options) => {
        assert.deepEqual(JSON.parse(String(options?.body)), { token: 'a'.repeat(64), password: 'local-new-password' });
        return new Response(JSON.stringify({ mensaje: 'Contraseña actualizada.' }));
      };
      await AuthService.resetPassword('a'.repeat(64), 'local-new-password');
      assert.equal(invalidated, 1);
      assert.equal(await StorageService.get('civigo:offline-account'), null);
    } finally { globalThis.fetch = originalFetch; unsubscribe(); }
  });
  test('a later login waits for the password-reset cookie deletion and remains authenticated', async () => {
    const originalFetch = globalThis.fetch;
    const started = deferred<void>(), releaseReset = deferred<void>();
    const order: string[] = [];
    const nextUser = { ...user, id: 82, correo: 'otra-cuenta@gmail.com' };
    let cookie: Usuario | null = null;
    let state: SessionState = { usuario: null, loading: true, offline: false };
    const controller = new SessionController(next => { state = next; }, () => true);
    const unsubscribe = onUnauthorized(() => controller.expire());
    updateAuthNetworkStatus(true);
    try {
      globalThis.fetch = async url => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/password/reset')) {
          order.push('reset-start'); started.resolve(); await releaseReset.promise;
          cookie = null; order.push('reset-cookie-cleared');
          return new Response(JSON.stringify({ mensaje: 'Contraseña actualizada.' }));
        }
        if (pathname.endsWith('/login')) { order.push('login'); cookie = nextUser; }
        assert.ok(cookie, 'the login must finish after the old reset clears its cookie');
        return new Response(JSON.stringify({ usuario: cookie }));
      };
      const resetting = AuthService.resetPassword('a'.repeat(64), 'local-new-password');
      await started.promise;
      const loggingIn = AuthService.login(nextUser.correo, 'local-next-password');
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(order, ['reset-start']);
      releaseReset.resolve();
      await resetting;
      assert.equal((await loggingIn).id, nextUser.id);
      await controller.refresh();
      assert.equal(state.usuario?.id, nextUser.id);
      assert.deepEqual(order, ['reset-start', 'reset-cookie-cleared', 'login']);
    } finally { releaseReset.resolve(); globalThis.fetch = originalFetch; unsubscribe(); controller.invalidate(); }
  });
  test('an in-flight password change holds logout and the next login even after the profile is canceled', async () => {
    const originalFetch = globalThis.fetch;
    const started = deferred<void>(), releaseChange = deferred<void>();
    const profile = new AbortController();
    const order: string[] = [];
    const nextUser = { ...user, id: 83, correo: 'cuenta-posterior@gmail.com' };
    let cookie: Usuario | null = user;
    let requestSignal: AbortSignal | undefined;
    let state: SessionState = { usuario: null, loading: true, offline: false };
    const controller = new SessionController(next => { state = next; }, () => true);
    const unsubscribe = onUnauthorized(() => controller.expire());
    updateAuthNetworkStatus(true);
    try {
      globalThis.fetch = async (url, options) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/password/change')) {
          assert.deepEqual(JSON.parse(String(options?.body)), { actual: 'current-fixture-password', password: 'new-fixture-password' });
          requestSignal = options?.signal ?? undefined;
          order.push('change-start'); started.resolve(); await releaseChange.promise;
          cookie = null; order.push('change-cookie-cleared');
          return new Response(JSON.stringify({ mensaje: 'Se cerraron las sesiones.' }));
        }
        if (pathname.endsWith('/logout')) {
          order.push('logout'); cookie = null;
          return new Response(JSON.stringify({ error: 'Sesión ya cerrada.' }), { status: 401 });
        }
        if (pathname.endsWith('/login')) { order.push('login'); cookie = nextUser; }
        return new Response(JSON.stringify(cookie ? { usuario: cookie } : { error: 'Inicia sesión.' }), { status: cookie ? 200 : 401 });
      };
      await controller.refresh();
      assert.equal(state.usuario?.id, user.id);
      const changing = AuthService.changePassword('current-fixture-password', 'new-fixture-password', profile.signal);
      const canceled = assert.rejects(changing, /cancelada/);
      await started.promise;
      const loggingOut = controller.logout();
      profile.abort();
      const loggingIn = AuthService.login(nextUser.correo, 'next-fixture-password');
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(order, ['change-start']);
      assert.equal(requestSignal?.aborted, false, 'profile disposal must not detach the cookie mutation from its session queue');
      releaseChange.resolve();
      await canceled; await loggingOut;
      assert.equal((await loggingIn).id, nextUser.id);
      await controller.refresh();
      assert.equal(state.usuario?.id, nextUser.id);
      assert.deepEqual(order, ['change-start', 'change-cookie-cleared', 'logout', 'login']);
    } finally { releaseChange.resolve(); globalThis.fetch = originalFetch; unsubscribe(); controller.invalidate(); }
  });
  test('password changes canceled before dispatch never send credentials, including while queued', async () => {
    const originalFetch = globalThis.fetch;
    const started = deferred<void>(), releaseReset = deferred<void>();
    const beforeQueue = new AbortController(), queued = new AbortController();
    let changesSent = 0;
    updateAuthNetworkStatus(true);
    try {
      globalThis.fetch = async url => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/password/reset')) { started.resolve(); await releaseReset.promise; }
        else changesSent++;
        return new Response(JSON.stringify({ mensaje: 'Contraseña actualizada.' }));
      };
      beforeQueue.abort();
      await assert.rejects(AuthService.changePassword('never-send-current', 'never-send-next', beforeQueue.signal), { name: 'AbortError' });
      const resetting = AuthService.resetPassword('a'.repeat(64), 'local-new-password');
      await started.promise;
      const changing = AuthService.changePassword('never-send-current', 'never-send-next', queued.signal);
      const canceled = assert.rejects(changing, { name: 'AbortError' });
      queued.abort();
      releaseReset.resolve();
      await resetting; await canceled;
      assert.equal(changesSent, 0);
    } finally { releaseReset.resolve(); globalThis.fetch = originalFetch; }
  });
});

describe('Password recovery link handling without navigation or storage', () => {
  const proof = 'a'.repeat(64);
  const valid = `https://civigo.online/recuperar#token=${proof}`;
  test('accepts the emailed fragment URL or its exact opaque token', () => {
    assert.equal(passwordResetToken(valid), proof);
    assert.equal(passwordResetToken(` ${proof} `), proof);
    assert.equal(passwordResetToken(`https://custom.test/recuperar#token=${proof}`, ['https://custom.test']), proof);
  });
  test('rejects other origins, userinfo, duplicate tokens, query secrets and unrelated links', () => {
    for (const input of [valid.replace('civigo.online', 'evil.test'), valid.replace('https://', 'javascript:'), valid.replace('civigo.online', 'u:p@civigo.online'), `${valid}&token=${proof}`, valid.replace('#token=', '?token='), valid.replace('/recuperar', '/map'), `${valid}&other=value`, 'a'.repeat(63), 'A'.repeat(64)]) assert.equal(passwordResetToken(input), null);
  });
  test('consumes only this recovery page fragment and preserves history state', () => {
    const replacements: unknown[][] = [];
    const state = { screen: 'recovery' };
    const history = { state, replaceState: (...args: unknown[]) => { replacements.push(args); } };
    assert.equal(isPasswordResetLocation(valid), true);
    assert.equal(consumePasswordResetLocation({ href: valid }, history), proof);
    assert.deepEqual(replacements, [[state, '', '/recuperar']]);
    assert.equal(consumePasswordResetLocation({ href: 'https://civigo.online/map#incident=42' }, history), null);
    assert.equal(replacements.length, 1);
  });
});
