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
  const operations = useOperationScope(identity);
  const [media, setMedia] = useState<{ identity: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const player = useRef<HTMLVideoElement | null>(null);
  const attachPlayer = useCallback((element: HTMLVideoElement | null) => {
    if (player.current !== element) stopMediaPlayback(player.current);
    player.current = element;
  }, []);
  useEffect(() => {
    const operation = operations.begin();
    let resource: MediaResource | undefined;
    setMedia(null); setError('');
    createAuthenticatedMediaResource({ url, mimeType, privado }, operation).then((loaded) => {
      resource = loaded;
      if (!operation.isActive()) { loaded.dispose(); return; }
      setMedia({ identity, url: loaded.url });
    }).catch(() => { if (operation.isActive()) setError('Evidencia no disponible.'); });
    return () => { resource?.dispose(); operation.finish(); };
  }, [identity, operations]);

  if (!media || media.identity !== identity) return <span className="muted" role="status" style={{ fontSize: 11 }}>{error || 'Cargando evidencia…'}</span>;
  if (mimeType.startsWith('image/')) return <img src={media.url} alt={alt} style={style} onClick={onClick} />;
  if (mimeType.startsWith('video/')) return <video ref={attachPlayer} src={media.url} controls={controls} preload="metadata" style={style} onClick={onClick} />;
  return <a href={media.url} download="evidencia.pdf" className="btn btn-secondary btn-small" onClick={onClick}>Descargar documento privado</a>;
};
