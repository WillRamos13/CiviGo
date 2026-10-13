type StaffAccount = { rol: string; bloqueado?: boolean; permisos?: string[] } | null | undefined;
const legacyReview = ['consultar', 'validar', 'gravedad', 'clasificar', 'falsedad', 'avisos'];
export function hasAgentPermission(user: StaffAccount, permission: string): boolean {
  if (!user || user.bloqueado) return false;
  if (user.rol.toUpperCase() === 'ADMIN') return true;
  if (user.rol.toUpperCase() !== 'AGENTE') return false;
  const known = [...legacyReview, 'resolver', 'reabrir', 'evidencia', 'moderar'];
  if (!known.includes(permission)) return false;
  const grants = Array.isArray(user.permisos) ? user.permisos : [];
  return grants.includes(permission) || (grants.includes('revisar') && legacyReview.includes(permission)) ||
    (permission === 'consultar' && grants.some(grant => known.includes(grant)));
}
