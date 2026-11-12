"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Music2, X, Square } from 'lucide-react';
import { loadSpotifyEmbed, parseSpotifyContent, type SpotifyContent, type SpotifyController } from '@/lib/spotify-embed';
import { registerRouteAudioGuard } from '@/lib/route-audio';
import styles from './RouteMusic.module.css';
import SpotifyAccountPanel from './SpotifyAccount';

export default function RouteMusic({ open, onClose }: { open: boolean; onClose(): void }) {
  const [input, setInput] = useState(''), [content, setContent] = useState<SpotifyContent | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const host = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);
  const player = useRef<SpotifyController | null>(null), playing = useRef(false);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  useEffect(() => {
    if (!content || !host.current) return;
    let active = true, created: SpotifyController | null = null;
    const slot = document.createElement('div'); host.current.replaceChildren(slot);
    void loadSpotifyEmbed().then(api => {
      if (!active) return;
      api.createController(slot, { uri: content.uri, width: '100%', height: 152, theme: 'dark' }, controller => {
        if (!active) { controller.destroy(); return; }
        created = controller; player.current = controller;
        controller.addListener('playback_update', event => {
          playing.current = !event.data.isPaused;
        });
        setError(''); setLoading(false);
      });
    }).catch(() => { if (active) { setError('Spotify no pudo cargarse. Puedes abrirlo con el enlace de abajo.'); setLoading(false); } });
    const timeout = setTimeout(() => { if (active && !created) { setLoading(false); setError('Spotify está tardando en responder. Puedes abrirlo aparte o reintentar.'); } }, 22000);
    const stopGuard=registerRouteAudioGuard(async()=>{
      if(!playing.current)return true;
      player.current?.pause();const started=performance.now();
      while(active&&playing.current&&performance.now()-started<1200)await new Promise(resolve=>setTimeout(resolve,40));
      return active&&!playing.current;
    });
    return () => { active = false; clearTimeout(timeout); stopGuard(); created?.pause(); created?.destroy(); if (player.current === created) player.current = null; playing.current = false; };
  }, [content]);
  const submit = (event: FormEvent) => {
    event.preventDefault(); const parsed = parseSpotifyContent(input);
    if (!parsed) { setError('Pega un enlace de canción, álbum, playlist o pódcast de open.spotify.com.'); return; }
    setError(''); setLoading(true); setContent(parsed);
  };
  return <aside className={styles.panel} aria-label="Spotify durante el recorrido" hidden={!open} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><h3><Music2 size={18} aria-hidden /> Tu música</h3><button type="button" onClick={onClose} aria-label="Minimizar música"><X size={19} /></button></header>
    <p>Elige qué escuchar con el reproductor oficial de Spotify.</p>
    <SpotifyAccountPanel visible={open}/>
    <form onSubmit={submit}><label htmlFor="route-spotify-link">Enlace de Spotify</label><input id="route-spotify-link" ref={field} value={input} onChange={event => setInput(event.target.value)} placeholder="https://open.spotify.com/playlist/…" autoComplete="off" maxLength={500} /><button className="btn btn-primary btn-small" disabled={loading} type="submit">{loading ? 'Cargando…' : 'Cargar reproductor'}</button></form>
    {error && <p role="alert">{error}</p>}
    <div ref={host} className={styles.embed} aria-busy={loading} />
    {content && <button className="btn btn-secondary btn-small" onClick={() => { player.current?.pause(); setContent(null); setLoading(false); }}><Square size={13} /> Detener y quitar</button>}
    <a href={content?.url ?? 'https://open.spotify.com'} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Abrir en Spotify</a>
    <small>La reproducción depende de tu cuenta y de Spotify. El reproductor se pausa antes de las indicaciones. Puedes reanudarlo cuando quieras.</small>
  </aside>;
}
