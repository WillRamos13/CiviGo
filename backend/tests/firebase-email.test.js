const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  firebaseEmailConfig,
  verifyFirebaseEmail,
  createFirebaseEmailVerifier,
} = require("../src/lib/firebase-email");

const projectId = "civigo-test";
const correo = "usuario@example.com";
const nowSeconds = 1791115200;
const created = new Date((nowSeconds - 60) * 1000 + 800);
let api, privateKey, publicKey, otherPrivateKey, keyResolver;

test.before(async () => {
  api = await import("jose");
  ({ privateKey, publicKey } = await api.generateKeyPair("RS256"));
  ({ privateKey: otherPrivateKey } = await api.generateKeyPair("RS256"));
  const publicJwk = await api.exportJWK(publicKey);
  keyResolver = api.createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: "local-key", use: "sig" }],
  });
});

function claims(overrides = {}) {
  return {
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: "local-firebase-user",
    iat: nowSeconds - 5,
    exp: nowSeconds + 3600,
    auth_time: nowSeconds - 30,
    firebase: { sign_in_provider: "google.com" },
    email: correo,
    email_verified: true,
    ...overrides,
  };
}
const sign = (payload = claims(), key = privateKey, header = {}) =>
  new api.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "local-key", ...header })
    .sign(key);
const verifier = (overrides = {}) =>
  createFirebaseEmailVerifier({
    projectId,
    keyResolver,
    now: () => nowSeconds * 1000,
    ...overrides,
  });
function expectError(status, code, forbidden = []) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    const serialized = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    for (const value of forbidden) assert.ok(!serialized.includes(value));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test("Firebase config requires only a valid project ID and does not enable emulator verification", async () => {
  const saved = process.env.FIREBASE_PROJECT_ID;
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  try {
    delete process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    assert.deepEqual(firebaseEmailConfig(), {
      projectId: null,
      configured: false,
    });
    await assert.rejects(
      verifyFirebaseEmail("invalid", correo, created),
      expectError(503, "EMAIL_GOOGLE_CONFIG"),
    );
    for (const value of [
      "https://example.invalid",
      "project with spaces",
      "123456",
      "a".repeat(31),
    ]) {
      process.env.FIREBASE_PROJECT_ID = value;
      assert.deepEqual(firebaseEmailConfig(), {
        projectId: null,
        configured: false,
      });
    }
    process.env.FIREBASE_PROJECT_ID = ` ${projectId} `;
    assert.deepEqual(firebaseEmailConfig(), { projectId, configured: true });
    await assert.rejects(
      verifyFirebaseEmail("invalid", correo, created),
      expectError(400, "EMAIL_GOOGLE_INVALID"),
    );
  } finally {
    if (saved === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = saved;
    if (emulator === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = emulator;
  }
});

test("RS256 proof is bound to project, UID and auth event, including refreshed tokens", async () => {
  const verify = verifier();
  const token = await sign();
  const proof = await verify(token, correo, created);
  assert.deepEqual(proof, {
    proofHash: crypto
      .createHash("sha256")
      .update(
        JSON.stringify([projectId, "local-firebase-user", nowSeconds - 30]),
      )
      .digest("hex"),
  });
  assert.match(proof.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    await verify(
      await sign(claims({ email: " USUARIO@EXAMPLE.COM " })),
      " usuario@EXAMPLE.com ",
      created,
    ),
    proof,
  );
  const workspaceEmail = "persona@empresa.com";
  assert.ok(
    await verify(
      await sign(claims({ email: workspaceEmail })),
      workspaceEmail,
      created,
    ),
  );
  const refreshed = await sign(
    claims({ iat: nowSeconds, exp: nowSeconds + 7200 }),
  );
  assert.deepEqual(await verify(refreshed, correo, created), proof);
  for (const override of [
    { sub: "another-user" },
    { auth_time: nowSeconds - 20 },
  ]) {
    assert.notEqual(
      (await verify(await sign(claims(override)), correo, created)).proofHash,
      proof.proofHash,
    );
  }
  const anotherProject = "another-project";
  const projectToken = await sign(
    claims({
      aud: anotherProject,
      iss: `https://securetoken.google.com/${anotherProject}`,
    }),
  );
  assert.notEqual(
    (
      await verifier({ projectId: anotherProject })(
        projectToken,
        correo,
        created,
      )
    ).proofHash,
    proof.proofHash,
  );
  const atCreatedSecond = await sign(claims({ auth_time: nowSeconds - 60 }));
  assert.ok(await verify(atCreatedSecond, correo, created));
  const oldestAllowed = await sign(claims({ auth_time: nowSeconds - 600 }));
  assert.ok(
    await verify(oldestAllowed, correo, new Date((nowSeconds - 600) * 1000)),
  );
});

test("signed Firebase tokens must match all identity, expiry and email claims", async (t) => {
  const invalidCases = [
    ["different audience", { aud: "another-project" }],
    ["audience array", { aud: [projectId] }],
    ["different issuer", { iss: "https://attacker.invalid" }],
    ["empty UID", { sub: "" }],
    ["blank UID", { sub: "   " }],
    ["overlong UID", { sub: "u".repeat(129) }],
    ["expired", { exp: nowSeconds }],
    ["fractional expiration", { exp: nowSeconds + 500.1 }],
    ["future issuance", { iat: nowSeconds + 1 }],
    ["fractional issuance", { iat: nowSeconds - 0.5 }],
    ["noninteger auth time", { auth_time: `${nowSeconds - 30}` }],
    ["fractional auth time", { auth_time: nowSeconds - 30.1 }],
  ];
  for (const field of ["sub", "aud", "iss", "iat", "exp", "auth_time"]) {
    const without = claims();
    delete without[field];
    invalidCases.push([`missing ${field}`, without, true]);
  }
  for (const [name, value, complete] of invalidCases) {
    await t.test(name, async () => {
      await assert.rejects(
        verifier()(
          await sign(complete ? value : claims(value)),
          correo,
          created,
        ),
        expectError(400, "EMAIL_GOOGLE_INVALID"),
      );
    });
  }
  for (const [name, override, code] of [
    ["old auth event", { auth_time: nowSeconds - 601 }, "RECENT_AUTH_REQUIRED"],
    [
      "future auth event",
      { auth_time: nowSeconds + 1 },
      "RECENT_AUTH_REQUIRED",
    ],
    [
      "auth after issuance",
      { auth_time: nowSeconds - 1 },
      "RECENT_AUTH_REQUIRED",
    ],
    [
      "auth before request",
      { auth_time: nowSeconds - 61 },
      "RECENT_AUTH_REQUIRED",
    ],
    [
      "password provider",
      { firebase: { sign_in_provider: "password" } },
      "EMAIL_MISMATCH",
    ],
    ["missing provider", { firebase: {} }, "EMAIL_MISMATCH"],
    [
      "non-Google provider",
      { firebase: { sign_in_provider: "phone" } },
      "EMAIL_MISMATCH",
    ],
    ["unverified email", { email_verified: false }, "EMAIL_MISMATCH"],
    [
      "missing verification claim",
      { email_verified: undefined },
      "EMAIL_MISMATCH",
    ],
    ["truthy verification claim", { email_verified: "true" }, "EMAIL_MISMATCH"],
    ["different email", { email: "otro@example.com" }, "EMAIL_MISMATCH"],
    [
      "email alias does not match",
      { email: "usuario+alias@example.com" },
      "EMAIL_MISMATCH",
    ],
    ["malformed email", { email: "912345678" }, "EMAIL_MISMATCH"],
    ["missing email", { email: undefined }, "EMAIL_MISMATCH"],
    [
      "email too long",
      { email: `${"u".repeat(250)}@example.com` },
      "EMAIL_MISMATCH",
    ],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        verifier()(await sign(claims(override)), correo, created),
        expectError(400, `EMAIL_GOOGLE_${code}`),
      );
    });
  }
});

test("invalid signatures and unknown signing keys cannot verify an email", async () => {
  const token = await sign();
  const signature = token.split(".");
  signature[2] = (signature[2][0] === "A" ? "B" : "A") + signature[2].slice(1);
  for (const candidate of [
    await sign(claims(), otherPrivateKey),
    await sign(claims(), privateKey, { kid: "unknown-key" }),
    signature.join("."),
  ]) {
    await assert.rejects(
      verifier()(candidate, correo, created),
      expectError(400, "EMAIL_GOOGLE_INVALID", [candidate]),
    );
  }
});

test("expiry and auth freshness are rechecked after public-key retrieval", async () => {
  for (const [override, code] of [
    [{ exp: nowSeconds + 5 }, "INVALID"],
    [{ auth_time: nowSeconds - 599 }, "RECENT_AUTH_REQUIRED"],
  ]) {
    let clockSeconds = nowSeconds;
    const verify = verifier({
      now: () => clockSeconds * 1000,
      keyResolver: async () => {
        clockSeconds += 10;
        return publicKey;
      },
    });
    await assert.rejects(
      verify(
        await sign(claims(override)),
        correo,
        new Date((nowSeconds - 600) * 1000),
      ),
      expectError(400, `EMAIL_GOOGLE_${code}`),
    );
  }
});

test("bad input and unsigned or non-RS256 headers fail before key resolution", async () => {
  let resolutions = 0;
  const verify = verifier({
    keyResolver: () => {
      resolutions++;
      return publicKey;
    },
  });
  const token = await sign();
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", kid: "local-key" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims())).toString("base64url")}.x`;
  const hmac = await new api.SignJWT(claims())
    .setProtectedHeader({ alg: "HS256", kid: "local-key" })
    .sign(crypto.randomBytes(32));
  for (const [candidate, email, date] of [
    [null, correo, created],
    ["a.b.c.d", correo, created],
    ["a".repeat(8193), correo, created],
    [` ${token}`, correo, created],
    [token, "912345678", created],
    [token, `${"u".repeat(250)}@example.com`, created],
    [token, correo, null],
    [token, correo, "not-a-date"],
    [unsigned, correo, created],
    [hmac, correo, created],
    [await sign(claims(), privateKey, { kid: "" }), correo, created],
  ]) {
    await assert.rejects(
      verify(candidate, email, date),
      expectError(400, "EMAIL_GOOGLE_INVALID"),
    );
  }
  assert.equal(resolutions, 0);
});

test("public-key failures return a sanitized retryable error without logs or token details", async () => {
  const secret = "private-remote-response-SECRET";
  const token = await sign();
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];
  console.warn = (...values) => logs.push(values);
  console.error = (...values) => logs.push(values);
  try {
    for (const error of [
      new TypeError(`${secret} ${token}`),
      new api.errors.JWKSTimeout(`${secret} ${token}`),
      new api.errors.JWKSInvalid(`${secret} ${token}`),
    ]) {
      await assert.rejects(
        verifier({
          keyResolver: async () => {
            throw error;
          },
        })(token, correo, created),
        expectError(503, "EMAIL_GOOGLE_UNAVAILABLE", [secret, token, correo]),
      );
    }
    assert.deepEqual(logs, []);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});
