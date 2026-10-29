import { useRef, useState } from "react";
import EditorPanel from "@/components/EditorPanel";
import { api, upload } from "@/lib/api";
import { validateAnnouncementImage } from "@/lib/announcements";
import AnnouncementImagePreview from "@/components/AnnouncementImagePreview";
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
  imagenId?: string | null;
  imagenAlt?: string;
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
  const [editorOpening, setEditorOpening] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const staged = useRef<string | null>(null);
  async function removeStaged() {
    if (staged.current) {
      try {
        await api("/uploads/" + staged.current, { method: "DELETE" });
        staged.current = null;
      } catch {
        /* Normal upload cleanup retries later. */
      }
    }
  }
  async function chooseBanner(file?: File) {
    if (!file || !draft || pending) return;
    setPending(true);
    setFailure("");
    try {
      validateAnnouncementImage(file);
      const image = await upload(file, false, "ANUNCIO");
      const previous = staged.current;
      staged.current = image.id;
      setDraft({
        ...draft,
        imagenId: image.id,
        imagenAlt: draft.imagenAlt || `Publicidad de ${draft.nombre}`,
      });
      if (previous)
        try {
          await api("/uploads/" + previous, { method: "DELETE" });
        } catch {
          /* The server can remove an abandoned previous upload later. */
        }
    } catch (reason) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (pending) return;
    setPending(true);
    await removeStaged();
    setDraft(null);
    setPending(false);
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
          imagenId: draft.imagenId ?? null,
          imagenAlt: draft.imagenAlt || draft.nombre,
        }),
      });
      staged.current = null;
      setDraft(null);
      setSuccess("El negocio y su publicidad se guardaron.");
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
          disabled={pending}
          onClick={() => {
            setDraft({ ...emptyBusiness });
            setEditorOpening((value) => value + 1);
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
                      <span className="badge">
                        {business.imagenId ? "Con banner" : "Sin banner"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary self-start"
                    disabled={pending}
                    onClick={() => {
                      setDraft({
                        ...business,
                        sitioWeb: business.sitioWeb ?? "",
                        telefono: business.telefono ?? "",
                      });
                      setEditorOpening((value) => value + 1);
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
        <EditorPanel
          label={draft.id ? "Editar negocio" : "Registrar negocio"}
          selectionKey={`${draft.id ?? "new-business"}:${editorOpening}`}
        >
          <form className="card mt-5 brand-border" onSubmit={submit}>
            <fieldset disabled={pending} className="contents">
              <h2 className="text-xl font-bold mb-5">
                {draft.id ? "Editar negocio" : "Nuevo negocio"}
              </h2>
              <section className="business-banner-editor">
                <h3>Banner del negocio</h3>
                <p className="muted text-sm">
                  Se muestra en la tarjeta deslizable cuando una persona pasa
                  cerca durante su recorrido. Usa una imagen horizontal o
                  cuadrada; se adapta sin deformarse.
                </p>
                <label className="field">
                  Cargar publicidad
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(event) => {
                      void chooseBanner(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {draft.imagenId && (
                  <>
                    <AnnouncementImagePreview
                      id={draft.imagenId}
                      alt={draft.imagenAlt || draft.nombre}
                    />
                    <label className="field">
                      Descripción de la imagen
                      <input
                        value={draft.imagenAlt || ""}
                        maxLength={250}
                        onChange={(event) =>
                          setDraft({ ...draft, imagenAlt: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      onClick={() => {
                        setDraft({ ...draft, imagenId: null, imagenAlt: "" });
                        void removeStaged();
                      }}
                    >
                      Quitar banner
                    </button>
                  </>
                )}
              </section>
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
                <legend className="font-bold mb-3">
                  Ubicación del negocio
                </legend>
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
                        setDraft({
                          ...draft,
                          latitud: Number(event.target.value),
                        })
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
                        setDraft({
                          ...draft,
                          longitud: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <p className="muted text-sm mt-2">
                  Introduce y verifica las coordenadas del negocio: la cercanía
                  durante el recorrido se calcula desde este punto.
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
                La tarjeta aparece por cercanía. La publicidad no altera la ruta
                ni el cálculo de riesgo.
              </p>
              <div className="flex gap-3 mt-5">
                <button className="btn btn-primary" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar negocio"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => void cancel()}
                >
                  Cancelar
                </button>
              </div>
            </fieldset>
          </form>
        </EditorPanel>
      )}
    </>
  );
}
