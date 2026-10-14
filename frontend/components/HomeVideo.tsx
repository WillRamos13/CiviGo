"use client";

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import styles from './HomeVideo.module.css';

const SOURCE = '/civigo-spot.mp4';
const POSTER = '/civigo-spot-poster.jpg';
type Playback = 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

export default function HomeVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const motionAllowed = useRef(false);
  const userPaused = useRef(false);
  const [playback, setPlayback] = useState<Playback>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = true;
    const playing = () => { if (active) setPlayback('playing'); };
    const paused = () => { if (active) setPlayback(video.error ? 'error' : 'paused'); };
    const failed = () => { if (active) setPlayback('error'); };
    const applyPreference = () => {
      if ((motion.matches && !motionAllowed.current) || userPaused.current) {
        video.pause();
        // The static frame remains visible without fetching 30 MB for people
        // who have requested reduced motion.
        if (motion.matches && !motionAllowed.current && video.hasAttribute('src')) {
          video.removeAttribute('src');
          video.load();
        }
        setPlayback('paused');
        return;
      }
      video.muted = true;
      video.defaultMuted = true;
      if (!video.hasAttribute('src')) video.src = SOURCE;
      void video.play().catch(() => { if (active && !userPaused.current) setPlayback(video.error ? 'error' : 'blocked'); });
    };
    video.addEventListener('playing', playing);
    video.addEventListener('pause', paused);
    video.addEventListener('error', failed);
    applyPreference();
    motion.addEventListener('change', applyPreference);
    return () => {
      active = false;
      motion.removeEventListener('change', applyPreference);
      video.removeEventListener('playing', playing);
      video.removeEventListener('pause', paused);
      video.removeEventListener('error', failed);
      video.pause();
    };
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused && playback === 'playing') {
      userPaused.current = true;
      video.pause();
      setPlayback('paused');
      return;
    }
    motionAllowed.current = true;
    userPaused.current = false;
    video.muted = true;
    video.defaultMuted = true;
    if (!video.hasAttribute('src')) video.src = SOURCE;
    setPlayback('loading');
    void video.play().catch(() => setPlayback(video.error ? 'error' : 'blocked'));
  };

  const playing = playback === 'playing';
  return (
    <div className={styles.frame} data-home-video>
      <video
        ref={videoRef}
        className={styles.video}
        poster={POSTER}
        autoPlay
        loop
        muted
        playsInline
        preload="none"
        aria-label="Presentación de CiviGo"
        disablePictureInPicture
      />
      {playback === 'error' ? (
        <p className={styles.notice} role="status">El video no se pudo cargar.</p>
      ) : (
        <button
          type="button"
          className={styles.control}
          onClick={togglePlayback}
          aria-label={playing ? 'Pausar presentación de CiviGo' : 'Reproducir presentación de CiviGo'}
          title={playing ? 'Pausar' : 'Reproducir'}
          disabled={playback === 'loading'}
        >
          {playing ? <Pause size={19} aria-hidden /> : <Play size={19} aria-hidden />}
          {!playing && <span>Reproducir</span>}
        </button>
      )}
    </div>
  );
}
