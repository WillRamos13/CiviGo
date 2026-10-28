"use client";
import { useEffect, useState } from "react";
import { post } from "../../services/api";
type Point = { nombre: string; latitud: number; longitud: number };
type Details = {
  fotos?: { url: string; autor: string; fuente: string; descripcion: string }[];
  horario?: string | null;
  abiertoAhora?: boolean | null;
  telefono?: string | null;
  web?: string | null;
  calificacion?: number | null;
  escala?: number;
  totalValoraciones?: number | null;
  fuente?: string;
  fuenteUrl?: string;
  opiniones?: { texto: string; autor: string; url: string | null }[];
  aviso?: string;
};
export default function PlaceDetails({ place }: { place: Point }) {
  const [data, setData] = useState<Details | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [photo, setPhoto] = useState(0),
    [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void post<Details>(
      "/navigation/places/details",
      {
        nombre: place.nombre,
        latitud: place.latitud,
        longitud: place.longitud,
      },
      { signal: controller.signal },
    )
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError("No se pudieron cargar los datos adicionales del lugar.");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [place.nombre, place.latitud, place.longitud]);
  const photos =
      data?.fotos?.filter((item) => !failed.includes(item.url)) ?? [],
    current = photos[Math.min(photo, photos.length - 1)];
  return (
    <section
      className="place-rich-details"
      aria-label="Fotos, horarios y opiniones"
    >
      {loading && <p role="status">Consultando información del lugar…</p>}
      {error && <p role="status">{error}</p>}
      {current && (
        <figure>
          <img
            src={current.url}
            alt={current.descripcion}
            width={800}
            height={500}
            onError={() => setFailed((value) => [...value, current.url])}
          />
          <figcaption>
            Foto:{" "}
            <a href={current.fuente} target="_blank" rel="noopener noreferrer">
              {current.autor}
            </a>
          </figcaption>
          {photos.length > 1 && (
            <div className="actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() =>
                  setPhoto(
                    (value) => (value + photos.length - 1) % photos.length,
                  )
                }
              >
                Anterior
              </button>
              <span>
                {Math.min(photo + 1, photos.length)} / {photos.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPhoto((value) => (value + 1) % photos.length)}
              >
                Siguiente
              </button>
            </div>
          )}
        </figure>
      )}
      {data && (
        <>
          <div className="place-detail-rating">
            {data.calificacion != null ? (
              <strong>
                ★ {data.calificacion.toFixed(1)} / {data.escala ?? 10}
                {data.totalValoraciones != null &&
                  ` · ${data.totalValoraciones} valoraciones`}
              </strong>
            ) : (
              <span>Sin calificación disponible</span>
            )}
          </div>
          <dl>
            <dt>Horario de atención</dt>
            <dd>
              {data.horario || "Horario no publicado por la fuente."}
              {typeof data.abiertoAhora === "boolean" && (
                <small>
                  {data.abiertoAhora
                    ? "Abierto según la fuente"
                    : "Cerrado según la fuente"}
                </small>
              )}
            </dd>
            {data.telefono && (
              <>
                <dt>Teléfono</dt>
                <dd>{data.telefono}</dd>
              </>
            )}
            {data.web && (
              <>
                <dt>Sitio oficial</dt>
                <dd>
                  <a href={data.web} target="_blank" rel="noopener noreferrer">
                    Visitar sitio
                  </a>
                </dd>
              </>
            )}
          </dl>
          <h3>Opiniones del lugar</h3>
          {data.opiniones?.length ? (
            data.opiniones.map((review, index) => (
              <blockquote key={index}>
                <p>{review.texto}</p>
                <footer>
                  {review.autor}
                  {review.url && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={review.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver opinión
                      </a>
                    </>
                  )}
                </footer>
              </blockquote>
            ))
          ) : (
            <p>Todavía no hay opiniones disponibles en la fuente consultada.</p>
          )}
          {data.fuenteUrl && (
            <small>
              Información de{" "}
              <a
                href={data.fuenteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {data.fuente}
              </a>
              . Los horarios pueden cambiar.
            </small>
          )}
          {data.aviso && <p className="muted">{data.aviso}</p>}
        </>
      )}
    </section>
  );
}
