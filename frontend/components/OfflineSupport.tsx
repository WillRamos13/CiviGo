"use client";
import { useEffect } from "react";

export default function OfflineSupport() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
      return;
    }
    // A worker installed by a previous production preview can otherwise keep
    // serving old CSS/JS when this same origin runs the development server.
    navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        const worker =
          registration?.active ||
          registration?.waiting ||
          registration?.installing;
        if (registration) {
          if (
            !worker ||
            new URL(worker.scriptURL).origin !== location.origin ||
            new URL(worker.scriptURL).pathname !== "/sw.js"
          )
            return;
          await registration.unregister();
        }
        // Existing tabs can still be controlled after unregistering. Clear our
        // old caches even when the registration has already been removed.
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith("civigo-public-shell-"))
            .map((name) => caches.delete(name)),
        );
      })
      .catch(() => {});
  }, []);
  return null;
}
