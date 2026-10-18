const { HttpError } = require('./http');
const { effectivePermissions, permissionKeys } = require('./agent-permissions');

function managedUserState(user) {
  return {
    rol: user.rol,
    tipoAgente: user.tipoAgente ?? null,
    distrito: user.distrito ?? null,
    permisos: effectivePermissions(user.permisos).sort(),
    premium: user.premium === true,
    bloqueado: user.bloqueado === true,
    correoVerificado: user.correoVerificado === true,
  };
}

function assertManagedUserUnchanged(current, expected) {
  // Legacy API clients may omit the precondition; current desktop editors send
  // their complete original administrative state on every partial update.
  if (expected === undefined) return;
  const keys = Object.keys(managedUserState(current));
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
      Object.keys(expected).length !== keys.length || keys.some(key => !Object.hasOwn(expected, key)) ||
      !['USUARIO', 'AGENTE', 'ADMIN'].includes(expected.rol) ||
      ![null, 'SERENAZGO', 'POLICIA', 'COLABORADOR'].includes(expected.tipoAgente) ||
      !(expected.distrito === null || typeof expected.distrito === 'string') ||
      !Array.isArray(expected.permisos) || expected.permisos.length > permissionKeys.length ||
      expected.permisos.some(key => !permissionKeys.includes(key)) ||
      ['premium', 'bloqueado', 'correoVerificado'].some(key => typeof expected[key] !== 'boolean'))
    throw new HttpError(400, 'El estado original del usuario no es válido.', 'ADMIN_USER_STATE_INVALID');
  if (JSON.stringify(managedUserState(current)) !== JSON.stringify(managedUserState(expected)))
    throw new HttpError(409, 'La cuenta cambió desde que abriste el editor. Carga los datos actuales antes de guardar; tu borrador se conserva.', 'ADMIN_USER_CHANGED');
}

module.exports = { managedUserState, assertManagedUserUnchanged };
