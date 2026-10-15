import React, { useState, useEffect } from 'react';
import { Footprints, Bike, Car, MapPin, Navigation, Bookmark, RotateCw, AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { NavigationService, formatDistance, formatDuration, type SavedRoute } from '../../services/navigation';
import { useAuth } from '../../hooks/useAuth';
import { triggerHaptic } from '../../services/native';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Posicion, Ruta, RouteStep } from '../../types';
import { SpotifyNavPlayer } from './SpotifyNavPlayer';

interface RoutePlannerProps {
  currentPosition?: Posicion | null;
  onSelectRoute: (ruta: Ruta | null) => void;
  activeRoute: Ruta | null;
  onStartNavigation?: (ruta: Ruta) => void;
  onStopNavigation?: () => void;
  isNavigating?: boolean;
}

export const RoutePlanner: React.FC<RoutePlannerProps> = ({
  currentPosition,
  onSelectRoute,
  activeRoute,
  onStartNavigation,
  onStopNavigation,
  isNavigating = false,
}) => {
  const { usuario } = useAuth();
  const [destinationInput, setDestinationInput] = useState('');
  const [destCoords, setDestCoords] = useState<Posicion | null>(null);
  const [mode, setMode] = useState<'walking' | 'cycling' | 'driving'>('walking');
  const [routes, setRoutes] = useState<Ruta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [favorites, setFavorites] = useState<SavedRoute[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Default destination presets in Ica
  const ICA_PLACES = [
    { nombre: 'Plaza de Armas de Ica', latitud: -14.0678, longitud: -75.7286 },
    { nombre: 'Huacachina Oasis', latitud: -14.0875, longitud: -75.7633 },
    { nombre: 'Terminal Terrestre Ica', latitud: -14.0631, longitud: -75.7335 },
    { nombre: 'Hospital Regional de Ica', latitud: -14.0722, longitud: -75.7410 },
  ];

  // Load favorites
  useEffect(() => {
    if (!usuario) return;
    NavigationService.getFavorites().then(setFavorites).catch(() => {});
  }, [usuario]);

  const handlePlan = async (targetDest?: Posicion) => {
    const destination = targetDest || destCoords;
    if (!currentPosition) {
      setError('Se necesita tu ubicación GPS actual como punto de partida.');
      return;
    }
    if (!destination) {
      setError('Elige un punto de destino en Ica.');
      return;
    }

    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setRoutes([]);

    try {
      const results = await NavigationService.planRoute(currentPosition, destination, mode);
      setRoutes(results);
      if (results.length > 0) {
        onSelectRoute(results[0]);
      } else {
        setError('No se encontraron rutas disponibles para este trayecto.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error al planificar la ruta.');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectPreset = (place: { nombre: string; latitud: number; longitud: number }) => {
    setDestinationInput(place.nombre);
    const coords: Posicion = { latitud: place.latitud, longitud: place.longitud };
    setDestCoords(coords);
    void handlePlan(coords);
  };

  const handleSaveFavorite = async (route: Ruta) => {
    if (!usuario || !currentPosition || !destCoords) return;
    void triggerHaptic('light');
    try {
      const fav = await NavigationService.addFavorite(
        destinationInput || 'Ruta favorita',
        [mode],
        route,
        currentPosition,
        destCoords,
        mode
      );
      setFavorites((prev) => [fav, ...prev]);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch {
      //
    }
  };

  return (
    <div className="route-planner-mobile">
      {/* If currently navigating: show guidance banner */}
      {isNavigating && activeRoute ? (
        <div
          className="card"
          style={{
            backgroundColor: 'var(--brand-soft)',
            border: '2px solid var(--brand)',
            padding: '14px',
            margin: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: 'var(--brand)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Navigation size={18} />
              </div>
              <div>
                <strong style={{ fontSize: 14, display: 'block' }}>Navegando hacia destino</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  Ruta {activeRoute.tipo === 'segura' ? 'más segura' : activeRoute.tipo === 'rapida' ? 'más rápida' : 'equilibrada'}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={onStopNavigation}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              Finalizar
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 16,
              backgroundColor: 'var(--surface)',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid var(--line)',
              marginBottom: 10,
            }}
          >
            <div>
              <span className="muted" style={{ fontSize: 11, display: 'block' }}>Distancia</span>
              <strong style={{ fontSize: 16, color: 'var(--brand)' }}>
                {formatDistance(activeRoute.distancia)}
              </strong>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 11, display: 'block' }}>Tiempo estimado</span>
              <strong style={{ fontSize: 16, color: 'var(--ink)' }}>
                {formatDuration(activeRoute.duracion)}
              </strong>
            </div>
          </div>

          {/* Turn-by-Turn Steps List if available */}
          {activeRoute.pasos && activeRoute.pasos.length > 0 && (
            <div
              style={{
                backgroundColor: 'var(--surface)',
                borderRadius: 10,
                border: '1px solid var(--line)',
                padding: '8px 12px',
                maxHeight: 140,
                overflowY: 'auto',
                marginBottom: 8,
              }}
            >
              <span className="muted" style={{ fontSize: 10, display: 'block', marginBottom: 4, fontWeight: 700 }}>
                INDICACIONES DEL TRAYECTO:
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeRoute.pasos.map((paso, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                    <span
                      style={{
                        minWidth: 18,
                        height: 18,
                        borderRadius: '50%',
                        backgroundColor: idx === 0 ? 'var(--brand)' : 'var(--surface-muted)',
                        color: idx === 0 ? '#fff' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span>{paso.instruccion}</span>
                      {paso.distancia > 0 && (
                        <small className="muted" style={{ display: 'inline', marginLeft: 6 }}>
                          ({formatDistance(paso.distancia)})
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeRoute.advertencias && activeRoute.advertencias.length > 0 && (
            <div
              className="notice notice-warning"
              style={{ margin: 0, padding: '8px 12px', fontSize: 11 }}
            >
              <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              <span>
                {typeof activeRoute.advertencias[0] === 'string'
                  ? activeRoute.advertencias[0]
                  : activeRoute.advertencias[0].mensaje}
              </span>
            </div>
          )}

          {/* Optional Spotify mini-player (active only if enabled by user in settings) */}
          <SpotifyNavPlayer isNavigating={isNavigating} />
        </div>
      ) : (
        /* Planner Form */
        <div>
          {/* Mode Switcher */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--surface-subtle)',
              padding: 4,
              borderRadius: 12,
              marginBottom: 12,
              border: '1px solid var(--line)',
            }}
          >
            {[
              { id: 'walking', label: 'A pie', icon: Footprints },
              { id: 'cycling', label: 'Bicicleta', icon: Bike },
              { id: 'driving', label: 'Auto', icon: Car },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="btn btn-quiet btn-small"
                style={{
                  flex: 1,
                  backgroundColor: mode === id ? 'var(--surface)' : 'transparent',
                  color: mode === id ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: mode === id ? 700 : 500,
                  boxShadow: mode === id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
                onClick={() => {
                  setMode(id as any);
                  if (destCoords) handlePlan(destCoords);
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Quick Dest Presets */}
          <div style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
              Destinos frecuentes en Ica:
            </span>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {ICA_PLACES.map((p) => (
                <button
                  key={p.nombre}
                  type="button"
                  className="btn btn-secondary btn-small"
                  style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                  onClick={() => handleSelectPreset(p)}
                  disabled={busy}
                >
                  <MapPin size={12} color="var(--brand)" />
                  <span>{p.nombre}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="notice notice-error" style={{ fontSize: 12 }}>{error}</div>}

          {/* Route results */}
          {busy && (
            <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
              Calculando alternativas seguras…
            </p>
          )}

          {routes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {routes.map((r, index) => {
                const isSelected = activeRoute?.id === r.id;
                const riskColor = RISK_COLORS[Math.min(r.nivelRiesgo || 0, RISK_COLORS.length - 1)];

                return (
                  <div
                    key={r.id || index}
                    className="card"
                    style={{
                      padding: 12,
                      margin: 0,
                      borderColor: isSelected ? 'var(--brand)' : 'var(--line)',
                      backgroundColor: isSelected ? 'var(--brand-soft)' : 'var(--surface)',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      void triggerHaptic('light');
                      onSelectRoute(r);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 13 }}>
                        Opción {index + 1}: {r.tipo === 'segura' ? 'Más segura' : r.tipo === 'rapida' ? 'Más rápida' : 'Equilibrada'}
                      </strong>
                      <span
                        className="badge"
                        style={{ backgroundColor: riskColor, color: '#fff', fontSize: 10 }}
                      >
                        Riesgo {RISK_NAMES[Math.min(r.nivelRiesgo || 0, RISK_NAMES.length - 1)]}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                      <span><strong>{formatDistance(r.distancia)}</strong></span>
                      <span><strong>{formatDuration(r.duracion)}</strong></span>
                    </div>

                    {isSelected && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          style={{ flex: 1 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartNavigation?.(r);
                          }}
                        >
                          <Navigation size={14} />
                          <span>Iniciar recorrido</span>
                        </button>

                        {usuario && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveFavorite(r);
                            }}
                            title="Guardar en favoritos"
                          >
                            {savedSuccess ? <Check size={14} color="var(--success-ink)" /> : <Bookmark size={14} />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
