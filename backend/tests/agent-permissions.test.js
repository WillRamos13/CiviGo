const test = require("node:test");
const assert = require("node:assert/strict");
const {
  effectivePermissions,
  permissionForReview,
  permissionKeys,
} = require("../src/lib/agent-permissions");
const { hasPermission, canReview } = require("../src/lib/auth");
const { ownUser } = require("../src/lib/projections");

test("El permiso antiguo conserva decisiones existentes sin habilitar moderación ni administración", () => {
  const agent = { rol: "AGENTE", distrito: "Ica", permisos: ["revisar"] };
  assert.deepEqual(effectivePermissions(agent.permisos), [
    "consultar",
    "validar",
    "gravedad",
    "clasificar",
    "falsedad",
    "avisos",
  ]);
  for (const permission of effectivePermissions(agent.permisos))
    assert(hasPermission(agent, permission));
  for (const permission of [
    "moderar",
    "evidencia",
    "resolver",
    "reabrir",
    "admin",
  ])
    assert.equal(hasPermission(agent, permission), false);
  assert.deepEqual(
    ownUser(agent).permisos,
    effectivePermissions(agent.permisos),
  );
  assert.equal(ownUser(agent).permisos.includes("revisar"), false);
});

test("Consultar o ver evidencia no concede decisiones; una función operativa solo añade lectura", () => {
  const reader = { rol: "AGENTE", permisos: ["consultar"] };
  for (const permission of permissionKeys.filter((key) => key !== "consultar"))
    assert.equal(hasPermission(reader, permission), false);
  assert.deepEqual(effectivePermissions(["gravedad", "gravedad"]), [
    "consultar",
    "gravedad",
  ]);
  assert.deepEqual(effectivePermissions(["evidencia"]), [
    "consultar",
    "evidencia",
  ]);
  assert.deepEqual(effectivePermissions(["admin", "usuarios", null]), []);
  assert.equal(hasPermission({ rol: "AGENTE" }, "consultar"), false);
  assert.equal(permissionForReview("__proto__"), undefined);
  assert.equal(permissionForReview("constructor"), undefined);
});

test("El distrito, el rol y el bloqueo prevalecen sobre los permisos", () => {
  const agent = {
    rol: "AGENTE",
    tipoAgente: "POLICIA",
    distrito: "Ica",
    permisos: ["gravedad"],
  };
  assert(canReview(agent, { distrito: "Ica" }, "gravedad"));
  assert.equal(canReview(agent, { distrito: "Parcona" }, "gravedad"), false);
  assert.equal(
    canReview({ ...agent, distrito: null }, { distrito: "Ica" }, "gravedad"),
    false,
  );
  assert(
    canReview(
      { ...agent, tipoAgente: "COLABORADOR", distrito: null },
      { distrito: "Parcona" },
      "gravedad",
    ),
  );
  assert.equal(
    canReview(
      { ...agent, rol: "USUARIO", tipoAgente: "COLABORADOR" },
      { distrito: "Ica" },
      "gravedad",
    ),
    false,
  );
  assert.equal(
    canReview({ ...agent, bloqueado: true }, { distrito: "Ica" }, "gravedad"),
    false,
  );
  assert(hasPermission({ rol: "ADMIN", permisos: [] }, "falsedad"));
  assert.equal(
    hasPermission({ rol: "ADMIN", bloqueado: true }, "falsedad"),
    false,
  );
});
