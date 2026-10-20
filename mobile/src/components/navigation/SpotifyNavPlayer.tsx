import React, { useState, useEffect, useRef } from 'react';
import { SpotifyService } from '../../services/spotify';
import { SpotifyRemoteController, disconnectedSpotifyState, type SpotifyPlaybackState, type SpotifyRemoteCapabilities, type SpotifyCommand } from '../../services/spotifyRemote';
import { useAuth } from '../../hooks/useAuth';
import { ExternalLink, Music, Pause, Play, SkipBack, SkipForward, Unplug } from 'lucide-react';
import './spotify-nav-player.css';

export const SpotifyNavPlayer: React.FC<{ isNavigating: boolean; compact?: boolean }> = ({ isNavigating, compact = false }) => {
  const [enabled, setEnabled] = useState(false);
  const { usuario } = useAuth();
  useEffect(() => {
    let active = true;
    let revision = 0;
    const unsubscribe = SpotifyService.subscribe(value => { revision++; if (active) setEnabled(value); });
    const initial = revision;
    void SpotifyService.isEnabled().then((value) => { if (active && initial === revision) setEnabled(value); });
    return () => { active = false; unsubscribe(); };
  }, []);

  if (!enabled || !isNavigating) return null;
  return <SpotifyAuthorizedPlayer key={usuario?.id ?? 'guest'} compact={compact} />;
};

const SpotifyAuthorizedPlayer: React.FC<{ compact: boolean }> = ({ compact }) => {
  const controller = useRef<SpotifyRemoteController | null>(null);
  if (!controller.current) controller.current = new SpotifyRemoteController();
  const [capabilities, setCapabilities] = useState<SpotifyRemoteCapabilities | null>(null);
  const [playback, setPlayback] = useState(disconnectedSpotifyState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const owned = controller.current!;
    const unsubscribe = owned.subscribe(state => { if (mounted.current) setPlayback(state); });
    void owned.capabilities().then(value => { if (mounted.current) setCapabilities(value); })
      .catch(() => { if (mounted.current) setError('No se pudo comprobar la conexión con Spotify.'); });
    return () => { mounted.current = false; unsubscribe(); void owned.disconnect(); };
  }, []);
  const connect = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await controller.current!.connect(true); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'No se pudo conectar Spotify.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const command = async (action: SpotifyCommand) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await controller.current!.command(action); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Spotify no pudo ejecutar el control.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!playback.connected) return <SpotifyConnectionNotice compact={compact} capabilities={capabilities} busy={busy} error={error} onConnect={() => void connect()} />;
  return <SpotifyPlaybackCard playback={playback} compact={compact} busy={busy} error={error} onCommand={action => void command(action)} onDisconnect={() => { setError(''); void controller.current!.disconnect(); }} />;
};

export const SpotifyConnectionNotice: React.FC<{ compact?: boolean; capabilities?: SpotifyRemoteCapabilities | null; busy?: boolean; error?: string; onConnect?: () => void }> = ({ compact = false, capabilities, busy = false, error = '', onConnect }) => <aside className={`spotify-shortcut spotify-remote-notice ${compact ? 'spotify-remote-compact' : ''}`} aria-label="Spotify durante el recorrido">
  <div><Music size={16} aria-hidden="true" /><strong>Spotify sin conectar</strong></div>
  {!compact && <p>No hay una conexión autorizada. Las canciones y la reproducción se gestionan en Spotify.</p>}
  {capabilities?.platform === 'android' && !capabilities.configured && <small>La conexión dentro de CiviGo aún no está disponible.</small>}
  {capabilities?.configured && !capabilities.installed && <small>Instala e inicia sesión en la aplicación oficial de Spotify.</small>}
  <div className="spotify-remote-connect-actions">{capabilities?.configured && capabilities.installed && onConnect && <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={onConnect}>{busy ? 'Conectando…' : 'Conectar Spotify'}</button>}
    <button type="button" className="btn btn-secondary btn-small" onClick={() => SpotifyService.openSpotify()}><ExternalLink size={14} aria-hidden="true" />Abrir Spotify</button></div>
  {error && <p role="status" className="spotify-remote-error">{error}</p>}
</aside>;

export const SpotifyPlaybackCard: React.FC<{ playback: SpotifyPlaybackState; compact?: boolean; busy?: boolean; error?: string; onCommand: (command: SpotifyCommand) => void; onDisconnect: () => void }> = ({ playback, compact = false, busy = false, error = '', onCommand, onDisconnect }) => <aside className={`spotify-remote-player ${compact ? 'spotify-remote-compact' : ''}`} aria-label="Reproducción de Spotify">
  <div className="spotify-remote-main">
    {playback.track?.artwork ? <img className="spotify-remote-art" src={playback.track.artwork} alt="Portada de la canción en Spotify" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <span className="spotify-remote-art spotify-remote-art-empty"><Music size={21} aria-hidden="true" /></span>}
    <div className="spotify-remote-track"><a href={playback.track?.uri || 'https://open.spotify.com'} aria-label="Abrir pista en Spotify">Spotify</a><strong>{playback.track?.name || 'Esperando reproducción de Spotify'}</strong>{playback.track?.artist && <small>{playback.track.artist}</small>}</div>
    <div className="spotify-remote-controls"><button type="button" aria-label="Pista anterior en Spotify" disabled={busy || !playback.track || !playback.canSkipPrevious} onClick={() => onCommand('previous')}><SkipBack size={18} aria-hidden="true" /></button><button type="button" aria-label={playback.paused ? 'Reproducir en Spotify' : 'Pausar Spotify'} disabled={busy || !playback.track} onClick={() => onCommand(playback.paused ? 'resume' : 'pause')}>{playback.paused ? <Play size={19} aria-hidden="true" /> : <Pause size={19} aria-hidden="true" />}</button><button type="button" aria-label="Siguiente pista en Spotify" disabled={busy || !playback.track || !playback.canSkipNext} onClick={() => onCommand('next')}><SkipForward size={18} aria-hidden="true" /></button></div>
  </div>
  {!compact && <button type="button" className="spotify-remote-disconnect" onClick={onDisconnect}><Unplug size={14} aria-hidden="true" />Desconectar Spotify</button>}
  {error && <p className="spotify-remote-error" role="status">{error}</p>}
</aside>;
