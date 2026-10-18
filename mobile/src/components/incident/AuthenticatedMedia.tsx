import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useOperationScope } from '../../hooks/useOperationScope';
import { createAuthenticatedMediaResource, stopMediaPlayback, type MediaResource } from '../../services/authenticatedMedia';

interface Props {
  url: string;
  mimeType: string;
  privado?: boolean;
  alt?: string;
  style?: React.CSSProperties;
  controls?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

export const AuthenticatedMedia: React.FC<Props> = ({ url, mimeType, privado, alt = 'Evidencia', style, controls = false, onClick }) => {
  const { usuario } = useAuth();
  const identity = `${usuario?.id ?? 'guest'}:${usuario?.rol ?? ''}:${!!usuario?.bloqueado}:${usuario?.permisos?.join(',') ?? ''}:${url}:${mimeType}:${!!privado}`;
  const container = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [requested, setRequested] = useState('');
  const [attempt, setAttempt] = useState(0);
  const automatic = mimeType.startsWith('image/');
  const canLoad = nearViewport && (automatic || requested === identity);
  const operations = useOperationScope(`${identity}:${canLoad}:${attempt}`);
  const [media, setMedia] = useState<{ identity: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const player = useRef<HTMLVideoElement | null>(null);
  const attachPlayer = useCallback((element: HTMLVideoElement | null) => {
    if (player.current !== element) stopMediaPlayback(player.current);
    player.current = element;
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setNearViewport(entry.isIntersecting);
      if (!entry.isIntersecting) setRequested('');
    }, { rootMargin: '120px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setMedia(null); setError('');
    if (!canLoad) return;
    const operation = operations.begin();
    let resource: MediaResource | undefined;
    createAuthenticatedMediaResource({ url, mimeType, privado }, operation).then((loaded) => {
      resource = loaded;
      if (!operation.isActive()) { loaded.dispose(); return; }
      setMedia({ identity, url: loaded.url });
    }).catch(() => { if (operation.isActive()) setError('Evidencia no disponible.'); });
    return () => { resource?.dispose(); operation.finish(); };
  }, [identity, canLoad, attempt, operations]);

  const loaded = canLoad && media?.identity === identity ? media.url : null;
  return <span ref={container} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 32 }}>
    {loaded ? automatic ? <img src={loaded} alt={alt} style={style} onClick={onClick} />
      : mimeType.startsWith('video/') ? <video ref={attachPlayer} src={loaded} controls={controls} preload="metadata" style={style} onClick={onClick} />
      : <a href={loaded} download="evidencia.pdf" className="btn btn-secondary btn-small" onClick={onClick}>Descargar documento privado</a>
      : error ? <button type="button" className="btn btn-quiet btn-small" onClick={() => { setRequested(identity); setAttempt(value => value + 1); }}>Reintentar evidencia</button>
      : !automatic && requested !== identity ? <button type="button" className="btn btn-secondary btn-small" onClick={() => setRequested(identity)}>{mimeType.startsWith('video/') ? 'Cargar video' : 'Cargar documento'}</button>
      : <span className="muted" role="status" style={{ fontSize: 11 }}>{nearViewport ? 'Cargando evidencia…' : 'Evidencia'}</span>}
  </span>;
};
