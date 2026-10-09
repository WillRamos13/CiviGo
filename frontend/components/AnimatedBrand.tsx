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

    const applyMotionPreference = () => {
      if (motion.matches) {
        video.pause();
        video.removeAttribute("src");
        video.load();
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
        playsInline
        preload="none"
        poster={POSTER}
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setVideoVisible(true)}
        onError={() => setVideoVisible(false)}
      />
    </span>
  );
}
