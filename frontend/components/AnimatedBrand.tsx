"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const POSTER = "/civigo-logo-animado-poster.png";

export default function AnimatedBrand() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let frameId: number | undefined;
    const canvas = document.createElement("canvas");
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
        setVideoVisible(visiblePixels >= 12);
      } catch {
        setVideoVisible(false);
      }
    };
    const nextFrame = () => {
      inspectFrame();
      if (active && !motion.matches && !video.ended && !video.paused)
        frameId = video.requestVideoFrameCallback(nextFrame);
    };
    const onPlaying = () => {
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      if (typeof video.requestVideoFrameCallback === "function")
        frameId = video.requestVideoFrameCallback(nextFrame);
      else inspectFrame();
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", inspectFrame);

    const applyMotionPreference = () => {
      if (motion.matches) {
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
      motion.removeEventListener("change", applyMotionPreference);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", inspectFrame);
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <span className="brand-animation" aria-hidden="true">
      <Image
        src={POSTER}
        alt=""
        width={1280}
        height={720}
        unoptimized
        loading="eager"
        className={`brand-animation-media brand-animation-fallback${videoVisible ? " is-hidden" : ""}`}
      />
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
