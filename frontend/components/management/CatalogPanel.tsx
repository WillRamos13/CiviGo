"use client";

import { useState } from "react";
import IncidentIcon from "@/components/IncidentIcon";
import { api } from "@/lib/api";
import { Feedback, message, RemoteStatus, useRemote } from "./common";

interface CatalogType {
  id: number;
  nombre: string;
  slug: string;
  categoriaId: number;
  emergencia: boolean;
  historico: boolean;
  fotoObligatoria: boolean;
  individual: boolean;
  ubicacionRemota: boolean;
  persistente: boolean;
  activo: boolean;
}
interface Category {
  id: number;
  nombre: string;
  slug: string;
  orden: number;
  tipos: CatalogType[];
}
interface CatalogData {
  categorias: Category[];
}
interface TypeDraft {
  id?: number;
  nombre: string;
  categoriaId: number;
  emergencia: boolean;
  historico: boolean;
  fotoObligatoria: boolean;
  individual: boolean;
  ubicacionRemota: boolean;
  persistente: boolean;
  activo: boolean;
}
const flags: {
  key: keyof Pick<
    TypeDraft,
    | "emergencia"
    | "historico"
    | "fotoObligatoria"
    | "individual"
    | "ubicacionRemota"
    | "persistente"
    | "activo"
  >;
  label: string;
  detail: string;
}[] = [
  {
    key: "emergencia",
    label: "Puede publicarse como emergencia",
    detail: "Se publica por evaluar si falla la evaluación disponible.",
  },
  {
    key: "historico",
    label: "Conserva antecedente histórico",
    detail: "El peso disminuye con la antigüedad del hecho.",
  },
  {
    key: "fotoObligatoria",
    label: "Exige fotografía",
    detail: "El ciudadano debe adjuntar una imagen al reportar.",
  },
  {
    key: "individual",
    label: "Delito individual",
    detail: "No se agrupa ni recibe confirmaciones comunitarias.",
  },
  {
    key: "ubicacionRemota",
    label: "Permite otra ubicación",
    detail: "El ciudadano puede marcar el lugar de un hecho pasado.",
  },
  {
    key: "persistente",
    label: "Requiere seguimiento presencial",
    detail: "Para problemas como baches, iluminación y basura.",
  },
  {
    key: "activo",
    label: "Disponible para reportar",
    detail: "Al desactivarlo, sus registros existentes se conservan.",
  },
];

export default function CatalogPanel() {
  const { data, loading, error, reload } =
    useRemote<CatalogData>("/admin/catalog");
  const [category, setCategory] = useState<{
    id?: number;
    nombre: string;
    orden: number;
  } | null>(null);
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category || pending) return;
    setPending(true);
    setFailure("");
    try {
      await api(`/admin/categories${category.id ? `/${category.id}` : ""}`, {
        method: category.id ? "PATCH" : "POST",
        body: JSON.stringify({
          nombre: category.nombre.trim(),
          orden: category.orden,
        }),
      });
      setCategory(null);
      setSuccess("La categoría se guardó.");
      reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  async function saveType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    setPending(true);
    setFailure("");
    try {
      const { id, ...payload } = draft;
      await api(`/admin/types${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({ ...payload, nombre: payload.nombre.trim() }),
      });
      setDraft(null);
      setSuccess("El tipo de incidente y sus reglas se guardaron.");
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
          Las categorías organizan el formulario. Cada tipo tiene sus propias
          reglas de publicación, evidencia y seguimiento.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setCategory({ nombre: "", orden: data?.categorias.length ?? 0 });
            setFailure("");
            setSuccess("");
          }}
        >
          Crear categoría
        </button>
      </div>
      <Feedback error={failure} success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {category && (
        <form className="card mb-5 brand-border" onSubmit={saveCategory}>
          <h2 className="font-bold text-xl mb-4">
            {category.id ? "Editar categoría" : "Nueva categoría"}
          </h2>
          <div className="grid-2">
            <label className="field">
              Nombre
              <input
                required
                minLength={3}
                maxLength={80}
                value={category.nombre}
                onChange={(event) =>
                  setCategory({ ...category, nombre: event.target.value })
                }
              />
            </label>
            <label className="field">
              Orden de presentación
              <input
                required
                type="number"
                min={0}
                max={100}
                value={category.orden}
                onChange={(event) =>
                  setCategory({
                    ...category,
                    orden: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="flex gap-3 mt-4">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "Guardando…" : "Guardar categoría"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => setCategory(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {!loading && !error && data && (
        <div className="space-y-5">
          {data.categorias.map((item) => (
            <section className="card" key={item.id}>
              <div className="flex flex-wrap justify-between gap-3 mb-4">
                <h2 className="font-bold text-xl">{item.nombre}</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-secondary text-sm"
                    onClick={() => {
                      setCategory({
                        id: item.id,
                        nombre: item.nombre,
                        orden: item.orden,
                      });
                      setFailure("");
                    }}
                  >
                    Editar categoría
                  </button>
                  <button
                    className="btn btn-secondary text-sm"
                    onClick={() => {
                      setDraft({
                        nombre: "",
                        categoriaId: item.id,
                        emergencia: false,
                        historico: false,
                        fotoObligatoria: true,
                        individual: false,
                        ubicacionRemota: false,
                        persistente: false,
                        activo: true,
                      });
                      setFailure("");
                    }}
                  >
                    Agregar tipo
                  </button>
                </div>
              </div>
              {item.tipos.length === 0 ? (
                <p className="muted">Todavía no hay tipos en esta categoría.</p>
              ) : (
                <div className="divide-y">
                  {item.tipos.map((type) => (
                    <article
                      key={type.id}
                      className="py-3 flex flex-wrap justify-between gap-3"
                    >
                      <div>
                        <h3 className="incident-title-with-icon font-semibold">
                          <IncidentIcon tipo={type.nombre} slug={type.slug} />
                          <span>{type.nombre}</span>
                        </h3>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {type.individual && (
                            <span className="badge">Individual</span>
                          )}
                          {type.emergencia && (
                            <span className="badge">Emergencia</span>
                          )}
                          {type.historico && (
                            <span className="badge">Histórico</span>
                          )}
                          {type.fotoObligatoria && (
                            <span className="badge">Foto requerida</span>
                          )}
                          {type.persistente && (
                            <span className="badge">Seguimiento</span>
                          )}
                          {!type.activo && (
                            <span className="badge">Desactivado</span>
                          )}
                        </div>
                      </div>
                      <button
                        className="btn btn-secondary self-start"
                        onClick={() => {
                          setDraft({
                            id: type.id,
                            nombre: type.nombre,
                            categoriaId: item.id,
                            emergencia: type.emergencia,
                            historico: type.historico,
                            fotoObligatoria: type.fotoObligatoria,
                            individual: type.individual,
                            ubicacionRemota: type.ubicacionRemota,
                            persistente: type.persistente,
                            activo: type.activo,
                          });
                          setFailure("");
                        }}
                      >
                        Editar reglas
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {draft && (
        <form className="card mt-5 brand-border" onSubmit={saveType}>
          <h2 className="text-xl font-bold mb-4">
            {draft.id ? "Editar tipo de incidente" : "Nuevo tipo de incidente"}
          </h2>
          <div className="grid-2">
            <label className="field">
              Nombre
              <input
                required
                minLength={3}
                maxLength={80}
                value={draft.nombre}
                onChange={(event) =>
                  setDraft({ ...draft, nombre: event.target.value })
                }
              />
            </label>
            <label className="field">
              Categoría
              <select
                required
                value={draft.categoriaId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    categoriaId: Number(event.target.value),
                  })
                }
              >
                {data?.categorias.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 mt-5">
            {flags.map((flag) => (
              <label
                key={flag.key}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft[flag.key]}
                  onChange={(event) =>
                    setDraft({ ...draft, [flag.key]: event.target.checked })
                  }
                />
                <span>
                  <strong className="block">{flag.label}</strong>
                  <span className="muted text-sm">{flag.detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="notice mt-4">
            Modificar las reglas puede cambiar cómo se evalúan los reportes. Los
            cambios quedan registrados y no eliminan incidentes anteriores.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "Guardando…" : "Guardar tipo"}
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
