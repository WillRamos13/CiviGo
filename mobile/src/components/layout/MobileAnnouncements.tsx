import { useEffect, useState } from "react";
import "./MobileAnnouncements.css";
import { ChevronLeft, ChevronRight, Megaphone } from "lucide-react";
import { api, resolveApiUrl } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { useAppActivity } from "../../hooks/useAppActivity";
import {
  announcementImagePath,
  announcementLink,
  announcementPath,
  visibleAnnouncements,
  type Announcement,
  type AnnouncementPlacement,
} from "../../services/announcements";

export function MobileAnnouncements({
  placement = "CABECERA",
  onNavigate,
}: {
  placement?: AnnouncementPlacement;
  onNavigate: (path: string) => void;
}) {
  const { usuario } = useAuth(),
    foreground = useAppActivity();
  const [items, setItems] = useState<Announcement[]>([]),
    [index, setIndex] = useState(0),
    [failed, setFailed] = useState(""),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!foreground) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await api<Announcement[]>(announcementPath(placement), {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setItems(Array.isArray(data) ? data : []);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    placement,
    foreground,
    usuario?.id,
    usuario?.premium,
    usuario?.ocultarAnuncios,
  ]);
  const visible = visibleAnnouncements(
    items,
    placement,
    !!(usuario?.premium && usuario.ocultarAnuncios),
  );
  useEffect(() => {
    if (!foreground || paused || visible.length < 2) return;
    const timer = setInterval(() => setIndex((value) => value + 1), 10000);
    return () => clearInterval(timer);
  }, [foreground, paused, visible.length]);
  const current = visible[index % Math.max(1, visible.length)];
  if (!current) return null;
  const key = `${current.id}:${current.imagen?.id}`,
    image =
      current.imagen && failed !== key
        ? announcementImagePath(current.id, current.imagen.id)
        : null;
  const url = announcementLink(current.enlace, "https://civigo.online");
  const content = (
    <>
      {image ? (
        <img
          src={resolveApiUrl(image)}
          alt={current.imagen?.alt || current.titulo}
          onError={() => setFailed(key)}
        />
      ) : (
        <>
          <Megaphone size={17} />
          <span>
            <strong>{current.titulo}</strong>
            {current.mensaje && <small>{current.mensaje}</small>}
          </span>
        </>
      )}
    </>
  );
  return (
    <section
      className={`mobile-announcements mobile-announcements-${placement.toLowerCase()}`}
      aria-label="Anuncios y novedades"
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPaused(false);
      }}
    >
      {visible.length > 1 && (
        <button
          type="button"
          aria-label="Anuncio anterior"
          onClick={() =>
            setIndex((value) => (value - 1 + visible.length) % visible.length)
          }
        >
          <ChevronLeft size={16} />
        </button>
      )}
      {url ? (
        new URL(url).origin === "https://civigo.online" ? (
          <button
            className="mobile-announcement-content"
            onClick={() => onNavigate(new URL(url).pathname)}
          >
            {content}
          </button>
        ) : (
          <a
            className="mobile-announcement-content"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {content}
          </a>
        )
      ) : (
        <div className="mobile-announcement-content">{content}</div>
      )}
      {visible.length > 1 && (
        <button
          type="button"
          aria-label="Anuncio siguiente"
          onClick={() => setIndex((value) => value + 1)}
        >
          <ChevronRight size={16} />
        </button>
      )}
    </section>
  );
}
