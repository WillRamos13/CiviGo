"use client";
import { useEffect, useRef, useState } from "react";
import { Search, Mic, Volume2 } from "lucide-react";
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
export function DroidIcon() {
  return (
    <svg viewBox="0 0 100 110" aria-hidden="true" className="civigo-droid">
      <defs>
        <linearGradient id="droid-metal" x2="1" y2="1">
          <stop stopColor="#baf3ff" />
          <stop offset=".5" stopColor="#138cf4" />
          <stop offset="1" stopColor="#123584" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="103" rx="23" ry="4" fill="#138cf4" opacity=".15" />
      <g className="droid-float">
        <path d="M50 13V6" stroke="#29d4f4" strokeWidth="4" />
        <circle cx="50" cy="5" r="4" fill="#5ae8f5" />
        <rect
          x="16"
          y="18"
          width="68"
          height="49"
          rx="22"
          fill="url(#droid-metal)"
        />
        <rect x="24" y="27" width="52" height="30" rx="14" fill="#052740" />
        <path
          d="M34 41h6m20 0h6"
          stroke="#7eefff"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M43 50q7 5 14 0"
          stroke="#67d9f5"
          fill="none"
          strokeWidth="2"
        />
        <rect
          x="30"
          y="70"
          width="40"
          height="27"
          rx="13"
          fill="url(#droid-metal)"
        />
        <path d="m50 77-6 7 6 6 6-6Z" fill="#d1fbff" />
        <path
          d="M23 74 17 86m60-12 6 12"
          stroke="#249cf4"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
export default function CiviDroid({
  destination,
  onSearch,
}: {
  destination?: string;
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [listening, setListening] = useState(false),
    [notice, setNotice] = useState("");
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => () => recognition.current?.abort(), []);
  const ask = () => {
    const text = query
      .trim()
      .replace(/^(?:quiero ir a|ll[eé]vame a|vamos a|ir a)\s+/i, "");
    if (text.length >= 3) onSearch(text);
    else setNotice("Escribe el nombre del lugar.");
  };
  const listen = () => {
    const ctor =
      (
        window as unknown as {
          SpeechRecognition?: new () => Recognition;
          webkitSpeechRecognition?: new () => Recognition;
        }
      ).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
        .webkitSpeechRecognition;
    if (!ctor) {
      setNotice("Puedes escribir tu destino en el buscador.");
      return;
    }
    recognition.current?.abort();
    const instance = new ctor();
    recognition.current = instance;
    instance.lang = "es-PE";
    instance.interimResults = false;
    instance.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim();
      if (text) {
        setQuery(text);
        onSearch(text.replace(/^(?:quiero ir a|ll[eé]vame a)\s+/i, ""));
      }
    };
    instance.onerror = () => {
      setListening(false);
      setNotice("No se pudo usar el micrófono. Puedes escribir tu destino.");
    };
    instance.onend = () => setListening(false);
    try {
      instance.start();
      setListening(true);
      setNotice("Te escucho…");
    } catch {
      setNotice("El micrófono no está disponible.");
    }
  };
  const greeting = destination
    ? `Vamos a ${destination}. ¿Cómo te moverás?`
    : "Hola, soy Civi. ¿A dónde vamos?";
  return (
    <section
      className="route-assistant"
      aria-label="Asistente de destinos de CiviGo"
    >
      <div className="route-assistant-greeting">
        <DroidIcon />
        <div>
          <small>TU COPILOTO CIVIGO</small>
          <h2>{destination ? "¿Cómo nos movemos?" : "¿A dónde vamos?"}</h2>
          <p>{destination || "Dime un lugar y encontremos el camino."}</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Escuchar al asistente"
          onClick={() => {
            if ("speechSynthesis" in window) {
              speechSynthesis.cancel();
              const speech = new SpeechSynthesisUtterance(greeting);
              speech.lang = "es-PE";
              speechSynthesis.speak(speech);
            }
          }}
        >
          <Volume2 size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="route-assistant-search"
      >
        <Search size={16} />
        <input
          aria-label="Dile a Civi a dónde quieres ir"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Quiero ir a…"
          maxLength={160}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Dictar destino"
          aria-pressed={listening}
          onClick={listen}
        >
          <Mic size={16} />
        </button>
        <button type="submit" aria-label="Buscar con Civi">
          Ir
        </button>
      </form>
      {notice && <small role="status">{notice}</small>}
    </section>
  );
}
