import { useEffect, useRef, useState } from "react";
import { Search, Mic, Volume2 } from "lucide-react";
import {
  SpeechSearchController,
  speechSearchError,
} from "../../services/speechSearch";
import {
  speakNavigation,
  stopNavigationVoice,
} from "../../services/navigationVoice";
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

export function CiviDroidLauncher({onActivate}: {onActivate: () => void}) {
  return <button type="button" className="route-assistant-launch" aria-label="¿A dónde quieres ir hoy?" onClick={onActivate}>
    <span className="route-assistant-bubble">¿A dónde quieres ir hoy?</span><DroidIcon />
  </button>;
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
  const controller = useRef<SpeechSearchController | null>(null),
    mounted = useRef(true);
  if (!controller.current) controller.current = new SpeechSearchController();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.cancel();
      void stopNavigationVoice().catch(() => {});
    };
  }, []);
  const search = (text: string) => {
    const value = text
      .trim()
      .replace(/^(?:quiero ir a|ll[eé]vame a|vamos a|ir a)\s+/i, "");
    if (value.length >= 3) onSearch(value);
    else setNotice("Escribe el nombre del lugar.");
  };
  const listen = async () => {
    if (listening) {
      controller.current!.cancel();
      return;
    }
    setListening(true);
    setNotice("Te escucho…");
    try {
      const result = await controller.current!.recognize();
      if (!mounted.current) return;
      if (result.status === "recognized") {
        setQuery(result.transcript);
        search(result.transcript);
      }
      setNotice("");
    } catch (error) {
      if (mounted.current) setNotice(speechSearchError(error));
    } finally {
      if (mounted.current) setListening(false);
    }
  };
  return (
    <section
      className="route-assistant"
      aria-label="Asistente de destinos de CiviGo"
    >
      <div className="route-assistant-greeting">
        <DroidIcon />
        <div>
          <small>TU COPILOTO CIVIGO</small>
          <h2>{destination ? "¿Cómo nos movemos?" : "¿A dónde quieres ir hoy?"}</h2>
          <p>{destination || "Dime un lugar y encontremos el camino."}</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Escuchar al asistente"
          onClick={() =>
            void speakNavigation(
              destination
                ? "Vamos a " + destination + ". ¿Cómo te moverás?"
                : "Hola, soy Civi. ¿A dónde vamos?",
            ).catch(() => setNotice("Puedes escribir tu destino."))
          }
        >
          <Volume2 size={16} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search(query);
        }}
        className="route-assistant-search"
      >
        <Search size={16} />
        <input
          aria-label="Dile a Civi a dónde quieres ir"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quiero ir a…"
          maxLength={160}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Dictar destino"
          aria-pressed={listening}
          onClick={() => void listen()}
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
