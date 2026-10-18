import { Capacitor } from '@capacitor/core';
export type FirebaseEmailConfig =
    | { apiKey: string; authDomain: string; projectId: string; appId: string; native?: false }
    | { projectId: string; native: true };

export function firebaseEmailConfig(env: Record<string, string | undefined> = import.meta.env, platform = Capacitor.getPlatform()): FirebaseEmailConfig | null {
    // Vite copies only the project ID from the validated Android config. The
    // native SDK uses its own resources, never the web app's Firebase options.
    if (platform === 'android') {
        const projectId = (env.CIVIGO_ANDROID_FIREBASE_PROJECT_ID || '').trim();
        return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ? { projectId, native: true } : null;
    }
    const config = {
        apiKey: (env.VITE_FIREBASE_API_KEY || '').trim(),
        authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
        projectId: (env.VITE_FIREBASE_PROJECT_ID || '').trim(),
        appId: (env.VITE_FIREBASE_APP_ID || '').trim(),
    };
    return Object.values(config).every(value => value.length > 0) && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) && /^[a-z0-9.-]+$/i.test(config.authDomain) ? config : null;
}

export class GoogleEmailError extends Error {
    constructor(public code: string, message: string) { super(message); this.name = 'GoogleEmailError'; }
}

export function googleEmailErrorMessage(error: unknown): string {
    if (error instanceof GoogleEmailError) return error.message;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    switch (code) {
        case 'auth/popup-closed-by-user':
        case 'auth/canceled':
        case 'CANCELED':
        case '12501':
        case 'auth/cancelled-popup-request':
            return 'La ventana de Google se cerró antes de verificar el correo. Puedes intentarlo de nuevo.';
        case 'auth/popup-blocked':
            return 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes de CiviGo y vuelve a pulsar Verificar con Google.';
        case 'auth/network-request-failed':
            return 'No se pudo conectar con Google. Comprueba tu conexión e inténtalo de nuevo.';
        case 'auth/too-many-requests':
            return 'Hay demasiados intentos de verificación. Espera antes de volver a intentarlo.';
        case 'auth/unauthorized-domain':
        case 'auth/operation-not-allowed':
        case 'auth/invalid-api-key':
        case 'auth/app-not-authorized':
        case 'auth/invalid-app-id':
        case 'auth/project-not-found':
        case 'auth/operation-not-supported-in-this-environment':
            return 'La verificación con Google todavía no está disponible para esta versión de CiviGo.';
        case 'auth/account-exists-with-different-credential':
            return 'Esta cuenta de Google no está disponible para verificar el Gmail. Comunícalo al administrador.';
        default:
            return 'No se pudo completar la verificación con Google. Si el problema persiste, informa al administrador para revisar la configuración de esta versión.';
    }
}

export type GoogleEmailChallenge = { challengeId: string; projectId: string; expiresAt: string };
type GoogleEmailUser = { email?: string | null; emailVerified?: boolean; getIdToken: () => Promise<string> };
export type GoogleEmailSdk = { open: (email: string) => Promise<GoogleEmailUser>; signOut: () => Promise<void> };
export type GoogleEmailSdkLoader = (config: FirebaseEmailConfig) => Promise<GoogleEmailSdk>;

function checkFirebaseProof(token: string, config: FirebaseEmailConfig, email: string): void {
    try {
        if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
        const payloadPart = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, '=')));
        if (payload.aud !== config.projectId || payload.iss !== `https://securetoken.google.com/${config.projectId}`)
            throw new GoogleEmailError('configuration', 'La configuración de Google de esta versión no coincide con CiviGo. Informa al administrador.');
        if (payload.firebase?.sign_in_provider !== 'google.com' || payload.email_verified !== true ||
            typeof payload.email !== 'string' || payload.email.toLowerCase() !== email.trim().toLowerCase())
            throw new GoogleEmailError('email-mismatch', 'Elige la misma cuenta Gmail registrada en CiviGo.');
    } catch (error) {
        if (error instanceof GoogleEmailError) throw error;
        throw new GoogleEmailError('token', 'Google no pudo completar la comprobación del correo.');
    }
    // This catches client configuration mistakes only. CiviGo verifies the
    // signature, expiry, recent authentication and one-time challenge itself.
}

let webAuth: import('firebase/auth').Auth | null = null;
let nativeTasks: Promise<unknown> = Promise.resolve();
let webOwner: symbol | null = null;

type NativeGoogleBridge = {
    signOut: () => Promise<void>;
    signInWithGoogle: (options: { skipNativeAuth: false }) => Promise<{ user: { email: string | null; emailVerified: boolean } | null }>;
    getIdToken: (options: { forceRefresh: true }) => Promise<{ token: string }>;
};

/** Native SDK boundary is injectable for tests; production binds the Capacitor plugin. */
export function createNativeGoogleEmailSdk(bridge: NativeGoogleBridge): GoogleEmailSdk {
    let revision = 0;
    return {
        open: async () => {
            const acquisition = revision;
            const assertCurrent = () => {
                if (acquisition !== revision) throw new DOMException('Solicitud cancelada.', 'AbortError');
            };
            // The native SDK has one current user. Keep sign-in and token
            // retrieval together so a disposed flow cannot read a newer
            // flow's user, then immediately close its temporary session.
            const task = nativeTasks.then(async () => {
                assertCurrent();
                await bridge.signOut();
                try {
                    assertCurrent();
                    const result = await bridge.signInWithGoogle({ skipNativeAuth: false });
                    assertCurrent();
                    if (!result.user) throw new GoogleEmailError('token', 'Google no pudo completar la comprobación del correo.');
                    const proof = await bridge.getIdToken({ forceRefresh: true });
                    assertCurrent();
                    return { email: result.user.email, emailVerified: result.user.emailVerified, getIdToken: async () => proof.token };
                } finally { await bridge.signOut(); }
            });
            nativeTasks = task.catch(() => {});
            return task;
        },
        // Cancel this flow's queued acquisition without signing out another
        // flow's active native session; the running task owns its cleanup.
        signOut: async () => { revision++; },
    };
}

async function loadGoogleEmailSdk(config: FirebaseEmailConfig): Promise<GoogleEmailSdk> {
    const owner = Symbol('email-verification');
    if (Capacitor.isNativePlatform()) {
        if (!Capacitor.isPluginAvailable('FirebaseAuthentication'))
            throw new GoogleEmailError('native-configuration', 'La verificación con Google aún no está configurada en esta versión de la app. Comunícalo al administrador.');
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        // Native Firebase uses google-services.json. The backend still checks
        // project/issuer and the Gmail; a Google OAuth credential is not proof.
        return createNativeGoogleEmailSdk(FirebaseAuthentication);
    }
    if (config.native)
        throw new GoogleEmailError('configuration', 'La configuración de Android no puede usarse para verificar el correo en el navegador.');
    const [appModule, authModule] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    if (!webAuth) {
        const app = appModule.getApps().find(item => item.name === 'civigo-mobile-email') || appModule.initializeApp(config, 'civigo-mobile-email');
        webAuth = authModule.initializeAuth(app, {
            persistence: authModule.inMemoryPersistence,
            popupRedirectResolver: authModule.browserPopupRedirectResolver,
        });
        webAuth.languageCode = 'es';
    }
    const auth = webAuth;
    await auth.authStateReady();
    return {
        open: async email => {
            webOwner = owner;
            const provider = new authModule.GoogleAuthProvider();
            provider.setCustomParameters({ login_hint: email, prompt: 'select_account' });
            const credential = await authModule.signInWithPopup(auth, provider, authModule.browserPopupRedirectResolver);
            return { email: credential.user.email, emailVerified: credential.user.emailVerified, getIdToken: () => credential.user.getIdToken(true) };
        },
        signOut: async () => {
            if (webOwner === owner) { await authModule.signOut(auth); webOwner = null; }
        },
    };
}

/** Comprueba el correo: no inicia ni sustituye la sesión de CiviGo. */
export class GoogleEmailFlow {
    private sdk: GoogleEmailSdk | null = null;
    private challenge: GoogleEmailChallenge | null = null;
    private user: GoogleEmailUser | null = null;
    private token: string | null = null;
    private busy = false;
    private disposed = false;
    constructor(private config: FirebaseEmailConfig | null, private load: GoogleEmailSdkLoader = loadGoogleEmailSdk) {}

    get prepared() { return !this.disposed && !!this.sdk && !!this.challenge && Date.parse(this.challenge.expiresAt) > Date.now(); }
    get hasProof() { return !this.disposed && !!this.token; }

    private assertActive() { if (this.disposed) throw new DOMException('Solicitud cancelada.', 'AbortError'); }
    private async signOut() { try { await this.sdk?.signOut(); } catch { /* No modifica la sesión CiviGo ni escribe almacenamiento. */ } }
    private clear() { this.challenge = null; this.user = null; this.token = null; }

    async prepare(requestChallenge: () => Promise<GoogleEmailChallenge>): Promise<void> {
        this.assertActive();
        if (this.busy) throw new GoogleEmailError('busy', 'La verificación con Google ya está en curso.');
        if (!this.config)
            throw new GoogleEmailError('configuration', 'La verificación con Google todavía no está disponible para esta versión de CiviGo.');
        this.busy = true;
        try {
            if (this.challenge && Date.parse(this.challenge.expiresAt) <= Date.now()) {
                this.clear();
                await this.signOut();
                this.assertActive();
            }
            if (!this.sdk) this.sdk = await this.load(this.config);
            this.assertActive();
            if (!this.challenge) {
                const challenge = await requestChallenge();
                this.assertActive();
                if (!challenge || typeof challenge.challengeId !== 'string' || !/^[1-9]\d{0,9}$/.test(challenge.challengeId) || Number(challenge.challengeId) > 2147483647 ||
                    challenge.projectId !== this.config.projectId || typeof challenge.expiresAt !== 'string' ||
                    !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now())
                    throw new GoogleEmailError('challenge', 'No se pudo preparar la verificación con Google. Vuelve a intentarlo.');
                this.challenge = challenge;
            }
        } catch (error) {
            if (this.disposed) { this.clear(); await this.signOut(); }
            throw error;
        } finally { this.busy = false; }
    }

    async verify<T>(email: string, commit: (proof: { challengeId: string; idToken: string }) => Promise<T>): Promise<T> {
        this.assertActive();
        if (this.busy) throw new GoogleEmailError('busy', 'La verificación con Google ya está en curso.');
        if (!this.prepared || !this.sdk || !this.challenge) {
            this.clear(); void this.signOut();
            throw new GoogleEmailError('expired', 'Primero prepara una solicitud de verificación con Google.');
        }
        if (!email.trim().toLowerCase().endsWith('@gmail.com')) throw new GoogleEmailError('email-mismatch', 'Tu cuenta de CiviGo necesita una dirección Gmail para verificarla.');
        this.busy = true;
        try {
            if (!this.user) {
                // La carga del SDK y la solicitud HTTP ocurrieron en el primer
                // clic. Este segundo clic abre Google antes de cualquier await.
                this.user = await this.sdk.open(email);
                this.assertActive();
            }
            if (this.user.email?.trim().toLowerCase() !== email.trim().toLowerCase() || this.user.emailVerified !== true) {
                this.user = null; this.token = null; await this.signOut();
                throw new GoogleEmailError('email-mismatch', 'Elige la misma cuenta Gmail registrada en CiviGo.');
            }
            if (!this.token) {
                this.token = await this.user.getIdToken();
                this.assertActive();
                if (typeof this.token !== 'string' || !this.token || this.token.length > 8192) throw new GoogleEmailError('token', 'Google no pudo completar la comprobación del correo.');
                checkFirebaseProof(this.token, this.config!, email);
                await this.signOut();
            }
            if (Date.parse(this.challenge.expiresAt) <= Date.now()) {
                this.clear(); await this.signOut();
                throw new GoogleEmailError('expired', 'La solicitud de verificación venció. Vuelve a intentarlo.');
            }
            // Un fallo al guardar en CiviGo reutiliza la prueba en memoria: no
            // abre otra ventana ni cambia la cuenta elegida en Google.
            const result = await commit({ challengeId: this.challenge.challengeId, idToken: this.token });
            this.assertActive();
            this.clear();
            await this.signOut();
            return result;
        } catch (error) {
            if (this.disposed) { this.clear(); await this.signOut(); }
            else {
                const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
                if (['email-mismatch', 'configuration', 'token', 'EMAIL_GOOGLE_EMAIL_MISMATCH', 'EMAIL_GOOGLE_RECENT_AUTH_REQUIRED', 'EMAIL_GOOGLE_INVALID', 'EMAIL_GOOGLE_REPLAY'].includes(String(code))) {
                    // Una prueba rechazada requiere volver a elegir la cuenta;
                    // conserva la solicitud vigente para no generar otra cuota.
                    this.user = null; this.token = null; await this.signOut();
                } else if (code === 'VERIFICATION_EXPIRED') { this.clear(); await this.signOut(); }
            }
            throw error;
        } finally { this.busy = false; }
    }

    dispose() { this.disposed = true; this.clear(); void this.signOut(); }
}
