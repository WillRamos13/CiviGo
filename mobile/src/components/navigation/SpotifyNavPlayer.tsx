import React, { useState, useEffect } from 'react';
import { SpotifyService } from '../../services/spotify';
import { triggerHaptic } from '../../services/native';
import { Play, Pause, SkipBack, SkipForward, ExternalLink, Music } from 'lucide-react';

interface SpotifyNavPlayerProps {
  isNavigating: boolean;
}

export const SpotifyNavPlayer: React.FC<SpotifyNavPlayerProps> = ({ isNavigating }) => {
  const [enabled, setEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

  // Curated driving / walking soundtrack sample list for Ica journeys
  const tracks = [
    { title: 'Ruta Segura CiviGo', artist: 'Playlist Comunitaria Ica', duration: '3:20' },
    { title: 'Sonidos del Desierto', artist: 'Huacachina Vibes', duration: '2:45' },
    { title: 'Paseo Costero Iqueño', artist: 'Música Ambiental', duration: '4:10' },
  ];

  useEffect(() => {
    let active = true;
    SpotifyService.isEnabled().then((val) => {
      if (active) setEnabled(val);
    });
    return () => {
      active = false;
    };
  }, []);

  // Zero render when integration is disabled or not actively navigating
  if (!enabled || !isNavigating) {
    return null;
  }

  const currentTrack = tracks[currentTrackIndex];

  const handleTogglePlay = () => {
    void triggerHaptic('light');
    setIsPlaying(!isPlaying);
  };

  const handlePrev = () => {
    void triggerHaptic('light');
    setCurrentTrackIndex((prev) => (prev > 0 ? prev - 1 : tracks.length - 1));
  };

  const handleNext = () => {
    void triggerHaptic('light');
    setCurrentTrackIndex((prev) => (prev < tracks.length - 1 ? prev + 1 : 0));
  };

  const handleOpenApp = () => {
    void triggerHaptic('medium');
    SpotifyService.openSpotify();
  };

  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 6,
        padding: '10px 12px',
        borderRadius: 10,
        backgroundColor: '#121212',
        color: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              backgroundColor: '#1DB954',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Music size={12} color="#000" />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1DB954', letterSpacing: '0.5px' }}>
            SPOTIFY EN RUTA
          </span>
        </div>

        <button
          type="button"
          onClick={handleOpenApp}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#B3B3B3',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 0,
          }}
          aria-label="Abrir aplicación de Spotify"
        >
          <span>Abrir Spotify</span>
          <ExternalLink size={11} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: '#FFFFFF',
            }}
          >
            {currentTrack.title}
          </strong>
          <span
            style={{
              display: 'block',
              fontSize: 10,
              color: '#B3B3B3',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {currentTrack.artist}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handlePrev}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
            aria-label="Pista anterior"
          >
            <SkipBack size={16} />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              backgroundColor: '#1DB954',
              border: 'none',
              color: '#000000',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? <Pause size={14} fill="#000" /> : <Play size={14} fill="#000" style={{ marginLeft: 2 }} />}
          </button>

          <button
            type="button"
            onClick={handleNext}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
            aria-label="Siguiente pista"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
