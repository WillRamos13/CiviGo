"use client";

import { useEffect, useRef, useState } from "react";
import { paintTransparentBrand } from '@/lib/brand-video';

const POSTER = "/civigo-logo-animado-poster.png";

export default function AnimatedBrand() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null), frameRef = useRef<HTMLCanvasElement>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let frameId: number | undefined;
    let animationId: number | undefined;
    const poster = new window.Image();
    const darkTheme = () => document.documentElement.dataset.theme === 'dark';
    const paintPoster = () => { if (active && poster.complete && poster.naturalWidth && fallbackRef.current) paintTransparentBrand(fallbackRef.current, poster, darkTheme()); };
    const sizeCanvases = () => {
      const element = fallbackRef.current;
      if (!element) return;
      const width = Math.max(1, Math.ceil(element.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
      for (const target of [element, frameRef.current]) if (target) { target.width = width; target.height = Math.ceil(width * 268 / 620); }
      paintPoster();
    };
    poster.onload = paintPoster;
    poster.src = POSTER;
    const resize = new ResizeObserver(sizeCanvases);
    if (fallbackRef.current) resize.observe(fallbackRef.current);
    sizeCanvases();
    const theme = new MutationObserver(() => { paintPoster(); inspectFrame(); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const canvas = document.createElement("canvas");
    canvas.dataset.brandFrame = 'probe';
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const inspectFrame = () => {
      if (!active) return;
      // Some browsers update the query without notifying its current listener.
      // Existing media events also apply the preference; no extra timer is needed.
      if (motion.matches) {
        applyMotionPreference();
        return;
      }
      if (video.ended || !context || video.readyState < 2) return;
      // "playing" can fire for an empty or black decoded frame. Keep the
      // poster until the approved clip actually paints the blue pin or letters.
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let visiblePixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 80) visiblePixels++;
        }
        const visible = visiblePixels >= 12;
        if (visible && frameRef.current) paintTransparentBrand(frameRef.current, video, darkTheme());
        setVideoVisible(visible);
      } catch {
        setVideoVisible(false);
      }
    };
    const nextFrame = () => {
      inspectFrame();
      if (active && !motion.matches && !video.ended && !video.paused)
        frameId = video.requestVideoFrameCallback(nextFrame);
    };
    const nextAnimationFrame = () => {
      inspectFrame();
      if (active && !motion.matches && !video.ended && !video.paused)
        animationId = window.requestAnimationFrame(nextAnimationFrame);
    };
    const onPlaying = () => {
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      if (animationId !== undefined) window.cancelAnimationFrame(animationId);
      if (typeof video.requestVideoFrameCallback === "function")
        frameId = video.requestVideoFrameCallback(nextFrame);
      else animationId = window.requestAnimationFrame(nextAnimationFrame);
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", inspectFrame);

    const applyMotionPreference = () => {
      if (motion.matches) {
        if (animationId !== undefined) {
          window.cancelAnimationFrame(animationId);
          animationId = undefined;
        }
        if (frameId !== undefined) {
          video.cancelVideoFrameCallback(frameId);
          frameId = undefined;
        }
        video.pause();
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        setVideoVisible(false);
        return;
      }

      // Assign the source only after checking the preference, so reduced
      // motion users do not download or play the decorative animation.
      video.muted = true;
      video.defaultMuted = true;
      video.src = "/civigo-logo-animado.mp4";
      void video.play().catch(() => {
        if (active) setVideoVisible(false);
      });
    };

    applyMotionPreference();
    motion.addEventListener("change", applyMotionPreference);
    return () => {
      active = false;
      resize.disconnect(); theme.disconnect(); poster.onload = null;
      motion.removeEventListener("change", applyMotionPreference);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", inspectFrame);
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      if (animationId !== undefined) window.cancelAnimationFrame(animationId);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <span className="brand-animation" aria-hidden="true">
      <canvas ref={fallbackRef} data-brand-frame="poster" width={260} height={112} className={`brand-animation-canvas brand-animation-fallback${videoVisible ? " is-hidden" : ""}`}/>
      <canvas ref={frameRef} data-brand-frame="video" width={260} height={112} className={`brand-animation-canvas brand-animation-renderer${videoVisible ? " is-visible" : ""}`}/>
      <video
        ref={videoRef}
        className={`brand-animation-media brand-animation-video${videoVisible ? " is-visible" : ""}`}
        width={1280}
        height={720}
        muted
        loop
        playsInline
        preload="none"
        poster={POSTER}
        aria-hidden="true"
        tabIndex={-1}
        onEnded={() => setVideoVisible(false)}
        onError={() => setVideoVisible(false)}
      />
    </span>
  );
}
