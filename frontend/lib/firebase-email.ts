export type FirebaseEmailConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };

export function firebaseEmailConfig(): FirebaseEmailConfig | null {
    // Next sustituye estas referencias públicas exactas durante la compilación.
    const config = {
        apiKey: (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim(),
        authDomain: (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim(),
        projectId: (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim(),
        appId: (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim(),
    };
    return Object.values(config).every(value => value.length > 0) ? config : null;
}

export class GoogleEmailError extends Error {
    constructor(public code: string, message: string) { super(message); this.name = 'GoogleEmailError'; }
}

export function googleEmailErrorMessage(error: unknown): string {
    if (error instanceof GoogleEmailError) return error.message;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    switch (code) {
        case 'auth/popup-closed-by-user':
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
            return 'La verificación con Google todavía no está disponible para esta página.';
        case 'auth/account-exists-with-different-credential':
            return 'Esta cuenta de Google no está disponible para verificar el Gmail. Comunícalo al administrador.';
        default:
            return 'No se pudo completar la verificación con Google. Inténtalo de nuevo.';
    }
}

export type GoogleEmailChallenge = { challengeId: string; projectId: string; expiresAt: string };
type GoogleEmailUser = { getIdToken: () => Promise<string> };
export type GoogleEmailSdk = { open: (email: string) => Promise<GoogleEmailUser>; signOut: () => Promise<void> };
type GoogleEmailSdkLoader = (config: FirebaseEmailConfig) => Promise<GoogleEmailSdk>;

async function loadGoogleEmailSdk(config: FirebaseEmailConfig): Promise<GoogleEmailSdk> {
    const [appModule, authModule] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app = appModule.getApps().find(item => item.name === 'civigo-email') || appModule.initializeApp(config, 'civigo-email');
    const auth = authModule.initializeAuth(app, {
        persistence: authModule.inMemoryPersistence,
        popupRedirectResolver: authModule.browserPopupRedirectResolver,
    });
    auth.languageCode = 'es';
    // El primer clic prepara también el resolver antes de que Safari necesite
    // abrir la ventana desde la activación del segundo clic.
    await auth.authStateReady();
    let ownedUser: GoogleEmailUser | null = null;
    return {
        open: async email => {
            const provider = new authModule.GoogleAuthProvider();
            provider.setCustomParameters({ login_hint: email, prompt: 'select_account' });
            const credential = await authModule.signInWithPopup(auth, provider, authModule.browserPopupRedirectResolver);
            ownedUser = credential.user;
            return credential.user;
        },
        signOut: async () => {
            // Un flujo desmontado no cierra la sesión temporal de otro flujo nuevo.
            if (ownedUser && auth.currentUser === ownedUser) await authModule.signOut(auth);
            ownedUser = null;
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
    constructor(private config: FirebaseEmailConfig | null, private projectId: string | null | undefined, private load: GoogleEmailSdkLoader = loadGoogleEmailSdk) {}

    get prepared() { return !this.disposed && !!this.sdk && !!this.challenge && Date.parse(this.challenge.expiresAt) > Date.now(); }
    get hasProof() { return !this.disposed && !!this.token; }

    private assertActive() { if (this.disposed) throw new DOMException('Solicitud cancelada.', 'AbortError'); }
    private async signOut() { try { await this.sdk?.signOut(); } catch { /* No modifica la sesión CiviGo ni escribe almacenamiento. */ } }
    private clear() { this.challenge = null; this.user = null; this.token = null; }

    async prepare(requestChallenge: () => Promise<GoogleEmailChallenge>): Promise<void> {
        this.assertActive();
        if (this.busy) throw new GoogleEmailError('busy', 'La verificación con Google ya está en curso.');
        if (!this.config || !this.projectId || this.config.projectId !== this.projectId)
            throw new GoogleEmailError('configuration', 'La verificación con Google todavía no está disponible para esta página.');
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
                if (!challenge || typeof challenge.challengeId !== 'string' || !/^[1-9]\d{0,9}$/.test(challenge.challengeId) ||
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
        this.busy = true;
        try {
            if (!this.user) {
                // La carga del SDK y la solicitud HTTP ocurrieron en el primer
                // clic. Este segundo clic abre Google antes de cualquier await.
                this.user = await this.sdk.open(email);
                this.assertActive();
            }
            if (!this.token) {
                this.token = await this.user.getIdToken();
                this.assertActive();
                if (typeof this.token !== 'string' || !this.token || this.token.length > 8192) throw new GoogleEmailError('token', 'Google no pudo completar la comprobación del correo.');
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
                if (['EMAIL_GOOGLE_EMAIL_MISMATCH', 'EMAIL_GOOGLE_RECENT_AUTH_REQUIRED', 'EMAIL_GOOGLE_INVALID', 'EMAIL_GOOGLE_REPLAY'].includes(String(code))) {
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
