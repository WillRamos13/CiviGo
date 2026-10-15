import React, { useState, useEffect } from 'react';
import { SpotifyService } from '../../services/spotify';
import { ExternalLink, Music } from 'lucide-react';

export const SpotifyNavPlayer: React.FC<{ isNavigating: boolean }> = ({ isNavigating }) => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const unsubscribe = SpotifyService.subscribe(value => { revision++; if (active) setEnabled(value); });
    const initial = revision;
    void SpotifyService.isEnabled().then((value) => { if (active && initial === revision) setEnabled(value); });
    return () => { active = false; unsubscribe(); };
  }, []);

  if (!enabled || !isNavigating) return null;
  return <SpotifyConnectionNotice />;
};

export const SpotifyConnectionNotice: React.FC = () => <aside className="spotify-shortcut" aria-label="Spotify durante el recorrido">
    <div><Music size={16} /><strong>Spotify sin conectar</strong></div>
    <p>No hay una conexión autorizada. Las canciones y la reproducción se gestionan en Spotify.</p>
    <button type="button" className="btn btn-secondary btn-small" onClick={() => SpotifyService.openSpotify()}>
      <ExternalLink size={14} /> Abrir Spotify
    </button>
  </aside>;
