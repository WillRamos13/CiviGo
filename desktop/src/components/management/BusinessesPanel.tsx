
import { useState } from "react";
import { api, currentPosition } from "@/lib/api";
import { Feedback, message, number, RemoteStatus, useRemote } from "./common";

interface Business {
  id?: number;
  nombre: string;
  descripcion: string;
  direccion: string;
  horario: string;
  sitioWeb: string;
  telefono: string;
  latitud: number;
  longitud: number;
  activo: boolean;
  _count?: { impresiones: number };
  visualizaciones?: number;
}
const emptyBusiness: Business = {
  nombre: "",
  descripcion: "",
  direccion: "",
  horario: "",
  sitioWeb: "",
  telefono: "",
  latitud: -14.0678,
  longitud: -75.7286,
  activo: true,
};

export default function BusinessesPanel() {
  const { data, loading, error, reload } =
    useRemote<Business[]>("/admin/businesses");
  const [draft, setDraft] = useState<Business | null>(null);
  const [pending, setPending] = useState(false);
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function locate() {
    setLocating(true);
    setFailure("");
    try {
      const position = await currentPosition();
      setDraft((value) => (value ? { ...value, ...position } : null));
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setLocating(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    setPending(true);
    setFailure("");
    try {
      await api(`/admin/businesses${draft.id ? `/${draft.id}` : ""}`, {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          nombre: draft.nombre.trim(),
          descripcion: draft.descripcion.trim(),
          direccion: draft.direccion.trim(),
          horario: draft.horario.trim(),
          sitioWeb: draft.sitioWeb?.trim() || null,
          telefono: draft.telefono?.trim() || null,
          latitud: draft.latitud,
          longitud: draft.longitud,
          activo: draft.activo,
        }),
      });
      setDraft(null);
      setSuccess("El negocio de demostración se guardó.");
      reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap justify-between gap-3 mb-5">
        <p className="muted max-w-xl">
          Las recomendaciones aparecen cuando alguien pasa a 50 metros del
          negocio durante su recorrido. No modifican las rutas ni su puntuación.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setDraft({ ...emptyBusiness });
            setFailure("");
            setSuccess("");
          }}
        >
          Registrar negocio
        </button>
      </div>
      <Feedback error={failure} success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {!loading && !error && data && (
        <section className="card">
          <h2 className="font-bold text-xl mb-4">Negocios y anuncios</h2>
          {data.length === 0 ? (
            <p className="muted">Todavía no hay negocios registrados.</p>
          ) : (
            <div className="divide-y">
              {data.map((business) => (
                <article
                  key={business.id}
                  className="py-4 flex flex-wrap justify-between gap-4"
                >
                  <div>
                    <h3 className="font-bold">{business.nombre}</h3>
                    <p className="muted mt-1">{business.direccion}</p>
                    <p className="mt-2">{business.descripcion}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="badge">
                        {business.activo ? "Activo" : "Desactivado"}
                      </span>
                      <span className="badge">
                        {number(
                          business.visualizaciones ??
                            business._count?.impresiones ??
                            0,
                        )}{" "}
                        visualizaciones
                      </span>
                      <span className="badge">Demostración</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary self-start"
                    onClick={() => {
                      setDraft({
                        ...business,
                        sitioWeb: business.sitioWeb ?? "",
                        telefono: business.telefono ?? "",
                      });
                      setFailure("");
                    }}
                  >
                    Editar
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {draft && (
        <form className="card mt-5 brand-border" onSubmit={submit}>
          <h2 className="text-xl font-bold mb-5">
            {draft.id ? "Editar negocio" : "Nuevo negocio"}
          </h2>
          <div className="grid-2">
            <label className="field">
              Nombre
              <input
                required
                minLength={3}
                maxLength={120}
                value={draft.nombre}
                onChange={(event) =>
                  setDraft({ ...draft, nombre: event.target.value })
                }
              />
            </label>
            <label className="field">
              Dirección
              <input
                required
                minLength={3}
                maxLength={300}
                value={draft.direccion}
                onChange={(event) =>
                  setDraft({ ...draft, direccion: event.target.value })
                }
              />
            </label>
            <label className="field">
              Horario
              <input
                maxLength={150}
                value={draft.horario}
                onChange={(event) =>
                  setDraft({ ...draft, horario: event.target.value })
                }
                placeholder="Lunes a sábado, 9:00 a 18:00"
              />
            </label>
            <label className="field">
              Teléfono
              <input
                type="tel"
                maxLength={30}
                value={draft.telefono}
                onChange={(event) =>
                  setDraft({ ...draft, telefono: event.target.value })
                }
              />
            </label>
            <label className="field">
              Sitio web
              <input
                type="url"
                maxLength={500}
                value={draft.sitioWeb}
                onChange={(event) =>
                  setDraft({ ...draft, sitioWeb: event.target.value })
                }
                placeholder="https://"
              />
            </label>
          </div>
          <label className="field mt-4">
            Descripción o promoción
            <textarea
              required
              rows={3}
              minLength={5}
              maxLength={500}
              value={draft.descripcion}
              onChange={(event) =>
                setDraft({ ...draft, descripcion: event.target.value })
              }
            />
          </label>
          <fieldset className="mt-5">
            <legend className="font-bold mb-3">Ubicación del negocio</legend>
            <div className="grid-2">
              <label className="field">
                Latitud
                <input
                  required
                  type="number"
                  min={-90}
                  max={90}
                  step="any"
                  value={draft.latitud}
                  onChange={(event) =>
                    setDraft({ ...draft, latitud: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                Longitud
                <input
                  required
                  type="number"
                  min={-180}
                  max={180}
                  step="any"
                  value={draft.longitud}
                  onChange={(event) =>
                    setDraft({ ...draft, longitud: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-secondary mt-3"
              disabled={locating}
              onClick={locate}
            >
              {locating ? "Obteniendo ubicación…" : "Usar mi ubicación actual"}
            </button>
            <p className="muted text-sm mt-2">
              Verifica las coordenadas: la cercanía durante el recorrido se
              calcula desde este punto.
            </p>
          </fieldset>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={draft.activo}
              onChange={(event) =>
                setDraft({ ...draft, activo: event.target.checked })
              }
            />
            Anuncio habilitado
          </label>
          <p className="notice mt-4">
            Este registro pertenece al piloto de demostración. No registra
            cobros ni convenios reales.
          </p>
          <div className="flex gap-3 mt-5">
            <button className="btn btn-primary" disabled={pending || locating}>
              {pending ? "Guardando…" : "Guardar negocio"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={pending}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}

