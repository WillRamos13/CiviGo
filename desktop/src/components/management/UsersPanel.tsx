
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import EditorPanel from "@/components/EditorPanel";
import { Feedback, message, number, RemoteStatus, useRemote } from "./common";

interface ManagedUser {
  id: number;
  nickname: string;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono: string;
  correoVerificado: boolean;
  premium: boolean;
  rol: string;
  tipoAgente: string | null;
  distrito: string | null;
  permisos: string[];
  bloqueado: boolean;
  faltas: number;
  credibilidad: number | null;
  monedas: number;
}
interface DistrictCatalog {
  distritos: string[];
}
const permissions = [
  { key: "revisar", label: "Revisar y evaluar incidentes" },
  { key: "resolver", label: "Resolver incidentes" },
  { key: "reabrir", label: "Reabrir incidentes" },
  { key: "evidencia", label: "Consultar pruebas privadas" },
];

function AdjustmentForm({
  user,
  updated,
}: {
  user: ManagedUser;
  updated: () => void;
}) {
  const { usuario, refresh } = useAuth();
  const [points, setPoints] = useState(0);
  const [coins, setCoins] = useState(0);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api(`/admin/users/${user.id}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          puntos: points,
          monedas: coins,
          motivo: reason.trim(),
        }),
      });
      if (usuario?.id === user.id) await refresh();
      updated();
    } catch (failure: unknown) {
      setError(message(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="mt-7 border-t pt-5" onSubmit={submit}>
      <h3 className="font-bold text-lg">
        Ajuste evaluado de participación y monedas
      </h3>
      <p className="muted mt-2">
        Registra una corrección después de revisar el caso. Los valores
        positivos añaden y los negativos retiran. No cambia la credibilidad.
      </p>
      <Feedback error={error} />
      <div className="grid-2">
        <label className="field">
          Variación de puntos del mes actual
          <input
            required
            type="number"
            min={-100000}
            max={100000}
            step={0.01}
            value={points}
            onChange={(event) => setPoints(Number(event.target.value))}
          />
        </label>
        <label className="field">
          Variación de monedas
          <input
            required
            type="number"
            min={-100000}
            max={100000}
            step={0.01}
            value={coins}
            onChange={(event) => setCoins(Number(event.target.value))}
          />
          <small>Saldo actual: {number(user.monedas)} monedas.</small>
        </label>
      </div>
      <label className="field">
        Motivo de la corrección
        <textarea
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explica la evaluación y por qué corresponde este ajuste."
        />
      </label>
      <p className="notice">
        El saldo de monedas no puede quedar negativo. El ajuste y su motivo
        quedan registrados en la actividad administrativa.
      </p>
      <button
        className="btn btn-secondary"
        disabled={pending || (points === 0 && coins === 0)}
      >
        {pending ? "Registrando ajuste…" : "Registrar ajuste evaluado"}
      </button>
    </form>
  );
}

function UserForm({
  user,
  districts,
  save,
  cancel,
}: {
  user: ManagedUser | null;
  districts: string[];
  save: (feedback?: string) => void;
  cancel: () => void;
}) {
  const { usuario, refresh } = useAuth();
  const [role, setRole] = useState(user?.rol ?? "USUARIO");
  const [agentType, setAgentType] = useState(user?.tipoAgente ?? "SERENAZGO");
  const [district, setDistrict] = useState(user?.distrito ?? "");
  const [grants, setGrants] = useState(user?.permisos ?? []);
  const [premium, setPremium] = useState(user?.premium ?? false);
  const [blocked, setBlocked] = useState(user?.bloqueado ?? false);
  const [verified, setVerified] = useState(user?.correoVerificado ?? false);
  const [verificationReason, setVerificationReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const isAgent = role === "AGENTE";
  const special = agentType === "COLABORADOR";
  const verificationChanged = verified !== (user?.correoVerificado ?? false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const fields = new FormData(event.currentTarget);
      const correo = String(fields.get('correo') ?? '').trim().toLowerCase();
      if (!user && role === 'USUARIO' && !correo.endsWith('@gmail.com')) throw new Error('Las cuentas ciudadanas requieren una dirección de Gmail.');
      if (verificationChanged && verificationReason.trim().length < 10) throw new Error('Explica la comprobación del correo con al menos 10 caracteres.');
      await api(user ? `/admin/users/${user.id}` : '/admin/users', {
        method: user ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(!user ? {
            nombres: String(fields.get('nombres') ?? '').trim(),
            apellidos: String(fields.get('apellidos') ?? '').trim(),
            nickname: String(fields.get('nickname') ?? '').trim(),
            correo,
            telefono: String(fields.get('telefono') ?? '').trim(),
            fechaNacimiento: String(fields.get('fechaNacimiento') ?? ''),
            password: String(fields.get('password') ?? ''),
          } : {}),
          rol: role,
          tipoAgente: isAgent ? agentType : null,
          distrito: isAgent && !special ? district : null,
          permisos: isAgent ? grants : [],
          ...(user ? { premium, bloqueado: blocked } : {}),
          correoVerificado: verified,
          ...(verificationChanged ? { motivoVerificacion: verificationReason.trim() } : {}),
        }),
      });
      if (user && usuario?.id === user.id) await refresh();
      save(user ? undefined : "La cuenta se creó con el rol y los permisos indicados.");
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card mt-5 brand-border">
      <h2 className="text-xl font-bold">{user ? `Administrar @${user.nickname}` : 'Crear usuario'}</h2>
      {user && <p className="muted mt-1">
        {user.nombres} {user.apellidos} · {user.correo}
      </p>}
      <form onSubmit={submit} className="mt-5">
        <Feedback error={error} />
        {!user && <>
          <div className="grid-2">
            <label className="field">Nombres<input name="nombres" required maxLength={100} autoComplete="given-name" /></label>
            <label className="field">Apellidos<input name="apellidos" required maxLength={100} autoComplete="family-name" /></label>
            <label className="field">Nickname<input name="nickname" required minLength={3} maxLength={30} autoComplete="off" /></label>
            <label className="field">Correo<input name="correo" type="email" required maxLength={254} autoComplete="off" /><small>{role === 'USUARIO' ? 'La cuenta ciudadana debe usar Gmail.' : 'Puede ser un correo institucional válido.'}</small></label>
            <label className="field">Teléfono<input name="telefono" type="tel" required maxLength={30} placeholder="+51912345678" autoComplete="off" /></label>
            <label className="field">Fecha de nacimiento<input name="fechaNacimiento" type="date" required min="1900-01-01" /><small>Edad mínima: 12 años.</small></label>
            <label className="field">Contraseña inicial<input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" /><small>Como mínimo 10 caracteres.</small></label>
          </div>
        </>}
        <div className="grid-2">
          <label className="field">
            Rol
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="USUARIO">Ciudadano</option>
              <option value="AGENTE">Agente</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </label>
          {isAgent && (
            <label className="field">
              Insignia de agente
              <select
                value={agentType}
                onChange={(event) => setAgentType(event.target.value)}
              >
                <option value="SERENAZGO">Serenazgo</option>
                <option value="POLICIA">Policía</option>
                <option value="COLABORADOR">
                  Colaborador de CiviGo · toda la provincia
                </option>
              </select>
            </label>
          )}
          {isAgent && !special && (
            <label className="field">
              Distrito asignado
              <select
                required
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
              >
                <option value="">Seleccionar distrito</option>
                {districts.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {isAgent && (
          <fieldset className="mt-5">
            <legend className="font-bold">Permisos de revisión</legend>
            <div className="grid gap-3 sm:grid-cols-2 mt-3">
              {permissions.map((permission) => (
                <label key={permission.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={grants.includes(permission.key)}
                    onChange={(event) =>
                      setGrants((values) =>
                        event.target.checked
                          ? [...values, permission.key]
                          : values.filter((value) => value !== permission.key),
                      )
                    }
                  />
                  {permission.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-3 mt-6">
          <label className="flex items-center gap-2">
            <input name="correoVerificado" type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />
            Correo verificado
          </label>
          {verificationChanged && <label className="field">
            Motivo de la verificación del correo
            <textarea name="motivoVerificacion" required minLength={10} maxLength={1000} value={verificationReason} onChange={event => setVerificationReason(event.target.value)} placeholder="Describe la comprobación realizada o por qué se revoca la verificación." />
            <small>El cambio manual y su motivo quedan registrados en la actividad administrativa.</small>
          </label>}
          {user && <><label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={premium}
              onChange={(event) => setPremium(event.target.checked)}
            />
            Premium de demostración activo
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={blocked}
              onChange={(event) => setBlocked(event.target.checked)}
            />
            Cuenta bloqueada
          </label></>}
        </div>
        <p className="notice mt-4">
          La activación de Premium es una demostración sin cobros. Los
          administradores tienen acceso administrativo completo; los agentes
          trabajan según sus permisos y ámbito asignado.
        </p>
        <div className="flex flex-wrap gap-3 mt-5">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "Guardando…" : user ? "Guardar cambios" : "Crear cuenta"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={cancel}
          >
            Cancelar
          </button>
        </div>
      </form>
      {user && <AdjustmentForm
        user={user}
        updated={() =>
          save("El ajuste de participación y monedas quedó registrado.")
        }
      />}
    </section>
  );
}

export default function UsersPanel() {
  const users = useRemote<ManagedUser[]>("/admin/users");
  const catalog = useRemote<DistrictCatalog>("/catalog");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [editorOpening, setEditorOpening] = useState(0);
  const [success, setSuccess] = useState("");
  const filtered = (users.data ?? []).filter((user) =>
    `${user.nickname} ${user.nombres} ${user.apellidos} ${user.correo}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <button className="btn btn-primary mb-5" onClick={() => { setCreating(true); setSelected(null); setEditorOpening(value => value + 1); setSuccess(''); }}>Crear usuario</button>
      <label className="field max-w-xl mb-5">
        Buscar usuario
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nickname, nombre o correo"
        />
      </label>
      <Feedback success={success} />
      <RemoteStatus
        loading={users.loading}
        error={users.error}
        retry={users.reload}
      />
      {!users.loading && !users.error && users.data && (
        <section className="card">
          <h2 className="text-xl font-bold mb-4">Usuarios y permisos</h2>
          {filtered.length === 0 ? (
            <p className="muted">
              No hay usuarios que coincidan con la búsqueda.
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((user) => (
                <article key={user.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">@{user.nickname}</h3>
                      <p className="muted text-sm">
                        {user.nombres} {user.apellidos} · {user.correo}
                      </p>
                      <p className="muted text-sm mt-1">
                        Teléfono {user.telefono} · Correo{" "}
                        {user.correoVerificado
                          ? "verificado"
                          : "pendiente de verificación"}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <span className="badge">
                          {user.rol === "ADMIN"
                            ? "Administrador"
                            : user.rol === "AGENTE"
                              ? `Agente · ${user.distrito ?? "provincia"}`
                              : "Ciudadano"}
                        </span>
                        {user.rol === "AGENTE" && (
                          <span className="badge">
                            {user.tipoAgente === "POLICIA"
                              ? "Policía"
                              : user.tipoAgente === "SERENAZGO"
                                ? "Serenazgo"
                                : user.tipoAgente === "COLABORADOR"
                                  ? "Colaborador de CiviGo"
                                  : "Agente"}
                          </span>
                        )}
                        <span className="badge">
                          Credibilidad{" "}
                          {user.credibilidad === null
                            ? "sin definir"
                            : user.credibilidad}
                        </span>
                        <span className="badge">
                          {number(user.monedas)} monedas
                        </span>
                        {user.premium && (
                          <span className="badge">Premium demo</span>
                        )}
                        {user.bloqueado && (
                          <span className="badge bg-red-100 text-red-900">
                            Bloqueado
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary self-start"
                      onClick={() => {
                        setSelected(user);
                        setCreating(false);
                        setEditorOpening(value => value + 1);
                        setSuccess("");
                      }}
                    >
                      Administrar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {(selected || creating) && (
        <EditorPanel label={selected ? `Administrar usuario ${selected.nickname}` : "Crear usuario"} selectionKey={`${selected?.id ?? "new-user"}:${editorOpening}`}>
          {catalog.error && (
            <p className="notice notice-error mt-5">
              No se pudo cargar el catálogo de distritos.{" "}
              <button className="underline" onClick={catalog.reload}>
                Volver a intentar
              </button>
            </p>
          )}
          <UserForm
            key={selected?.id ?? 'new-user'}
            user={selected}
            districts={catalog.data?.distritos ?? []}
            cancel={() => { setSelected(null); setCreating(false); }}
            save={(feedback) => {
              setSelected(null);
              setCreating(false);
              setSuccess(
                feedback ?? "La cuenta y sus permisos se actualizaron.",
              );
              users.reload();
            }}
          />
        </EditorPanel>
      )}
    </>
  );
}

