export interface UserAccessState {
  rol: string;
  tipoAgente: string | null;
  distrito: string | null;
  permisos: string[];
  premium: boolean;
  bloqueado: boolean;
  correoVerificado: boolean;
}

type ManagedAccount = Pick<UserAccessState, 'rol'> & Partial<UserAccessState>;

export function userAccessState(user: ManagedAccount): UserAccessState {
  return {
    rol: user.rol,
    tipoAgente: user.tipoAgente ?? null,
    distrito: user.distrito ?? null,
    permisos: [...new Set(user.permisos ?? [])].sort(),
    premium: user.premium === true,
    bloqueado: user.bloqueado === true,
    correoVerificado: user.correoVerificado === true,
  };
}

// The original state accompanies only the fields the administrator changed.
// A stale editor must not silently undo another administrator's restriction.
export function userEditPatch(original: ManagedAccount, next: UserAccessState) {
  const before = userAccessState(original), after = userAccessState(next);
  const changes = Object.fromEntries(
    Object.entries(after).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(before[key as keyof UserAccessState])),
  );
  return Object.keys(changes).length ? { ...changes, estadoAnterior: before } : null;
}
