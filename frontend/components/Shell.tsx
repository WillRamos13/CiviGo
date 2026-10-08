"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Map,
  MapPin,
  FileText,
  Bell,
  User,
  Medal,
  Gift,
  Sparkles,
  Menu,
  X,
  LogOut,
  Shield,
} from "lucide-react";
import { useAuth } from "./AuthProvider";
import { errorMessage } from "@/lib/api";
import ChatBot from "./ChatBot";
import OfflineSupport from "./OfflineSupport";
import ThemeToggle from "./ThemeToggle";
import MapAnnouncements from "./MapAnnouncements";
const links = [
  { href: "/mapa", label: "Explorar mapa", icon: Map },
  { href: "/reportar", label: "Reportar incidente", icon: MapPin },
  { href: "/mis-reportes", label: "Mis reportes", icon: FileText },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/ranking", label: "Comunidad", icon: Medal },
  { href: "/recompensas", label: "Recompensas", icon: Gift },
  { href: "/premium", label: "CiviGo Premium", icon: Sparkles },
  { href: "/perfil", label: "Mi perfil", icon: User },
];
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { usuario, logout, offline } = useAuth();
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const role = usuario?.rol.toLowerCase();
  const agent = role === "agente";
  const mapExperience = path === "/mapa";
  const signOut = async () => { try { setError(""); await logout(); } catch (error) { setError(errorMessage(error)); } };
  return (
    <div className={`app-shell ${mapExperience ? "map-experience" : ""}`}>
      <a className="skip-link" href="#contenido-principal">
        Saltar al contenido
      </a>
      <OfflineSupport />
      <header className="app-header">
        <Link className="brand" href="/" aria-label="CiviGo · Inicio">
          <Image
            className="brand-logo"
            src="/civigo-logo.jpeg"
            alt=""
            width={50}
            height={60}
            unoptimized
            loading="eager"
          />
          <span>
            Civi<span className="brand-go">Go</span>
          </span>
        </Link>
        {mapExperience ? <MapAnnouncements /> : <span className="coverage-pill">
          <span /> Ica, Perú
        </span>}
        <div className="header-actions">
          <ThemeToggle />
          {usuario ? (mapExperience ? null : (
            <>
              <Link href="/perfil" className="profile-link" aria-label={`Mi perfil: ${usuario.nickname}`}>
                <span className="avatar">
                  {usuario.nickname.charAt(0).toUpperCase()}
                </span>
                <span>{usuario.nickname}</span>
              </Link>
              <button
                className="icon-btn"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                onClick={async () => {
                  try {
                    setError("");
                    await logout();
                  } catch (error) {
                    setError(errorMessage(error));
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            </>
          )) : (
            <>
              <Link href="/ingresar" className="btn btn-quiet">
                Ingresar
              </Link>
              <Link href="/registro" className="btn btn-primary">
                Crear cuenta
              </Link>
            </>
          )}
          <button
            ref={menuButton}
            className="icon-btn mobile-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            aria-controls="navegacion-principal"
            onClick={() => setOpen(value => !value)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside id="navegacion-principal" className={`sidebar ${open ? "is-open" : ""}`}>
          <div className="sidebar-label">TU CIUDAD, EN COMUNIDAD</div>
          <nav aria-label="Navegación principal">
            {links.filter(link => !mapExperience || link.href !== "/perfil").map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-item ${path === href ? "active" : ""}`}
                aria-current={path === href ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {href === "/reportar" && <span className="nav-plus">+</span>}
              </Link>
            ))}
            {agent && (
              <Link
                href="/agente"
                className={`nav-item ${path === "/agente" ? "active" : ""}`}
                aria-current={path === "/agente" ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Shield size={19} />
                Panel de agente
              </Link>
            )}
          </nav>
          {mapExperience && usuario && <div className="map-sidebar-account"><Link href="/perfil" className="profile-link"><span className="avatar">{usuario.nickname.charAt(0).toUpperCase()}</span><span>{usuario.nickname}</span></Link><button className="icon-btn" aria-label="Cerrar sesión" onClick={signOut}><LogOut size={20}/></button></div>}
          {!mapExperience && <><div className="community-note">
            <span className="eyebrow">HECHO PARA ICA</span>
            <h3>Una mejor ciudad empieza contigo.</h3>
            <p>
              Comparte lo que sucede y ayuda a tu comunidad a tomar decisiones
              informadas.
            </p>
            <Link href="/reportar">Hacer un reporte →</Link>
          </div>
          <div className="sidebar-footer">
            CiviGo · Información ciudadana
            <br />
            <span>Publicidad y canjes en demostración</span>
          </div>
          </>}
        </aside>
        <main id="contenido-principal" className="app-content" tabIndex={-1}>
          {offline && (
            <div className="notice notice-warning" style={{ margin: 20 }}>
              Servicio no disponible: consulta tus recorridos guardados. La
              sesión y los incidentes no se pueden verificar hasta recuperar la
              conexión con CiviGo.
            </div>
          )}
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          {children}
        </main>
      </div>
      <ChatBot />
    </div>
  );
}
