import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bookmark, Check, Clock3, Fuel, Home, Hospital, MapPin, Mic, ParkingCircle, Pill, Search, Share2, ShoppingBag, Trash2, Utensils, BriefcaseBusiness, X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { errorMessage } from '../../services/api';
import { NavigationService, formatDistance, type NavigationPlace } from '../../services/navigation';
import { PLACE_CATEGORIES, distanceToRoute, placeKey, placeMapUrl, placeShareText, placesNearRoute, straightLineDistance } from '../../services/placeDiscovery';
import { PlacePreferencesController, emptyPlacePreferences, type PlaceLabel, type PlacePreferences } from '../../services/placePreferences';
import { SpeechSearchController, speechSearchError, type SpeechSearchCapability } from '../../services/speechSearch';
import type { LocationFix, Ruta } from '../../types';
import './destination-explorer.css';
import PlaceDetails from './PlaceDetails';

export interface DestinationExplorerProps {
  open: boolean;
  /** Hidden while Android's requested system speech Activity is in front. */
  suspended?: boolean;
  onClose: () => void;
  ownerId: number | null;
  currentPosition?: LocationFix | null;
  activeRoute?: Ruta | null;
  navigationActive?: boolean;
  onChooseDestination: (place: NavigationPlace) => void;
  onChooseStop?: (place: NavigationPlace) => void;
  onShowPlace?: (place: NavigationPlace) => void;
}

const categoryIcons = { food: Utensils, fuel: Fuel, parking: ParkingCircle, pharmacy: Pill, hospital: Hospital, shops: ShoppingBag };
const labelNames: Record<PlaceLabel, string> = { saved: 'Guardado', home: 'Casa', work: 'Trabajo' };

/** Keeping this mounted preserves search context; an account change resets it. */
export const DestinationExplorer: React.FC<DestinationExplorerProps> = props => (
  <DestinationExplorerContent key={props.ownerId ?? 'guest'} {...props} />
);

const DestinationExplorerContent: React.FC<DestinationExplorerProps> = ({ open, suspended = false, onClose, ownerId, currentPosition, activeRoute, navigationActive = false, onChooseDestination, onChooseStop, onShowPlace }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NavigationPlace[]>([]);
  const [selected, setSelected] = useState<NavigationPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [saved, setSaved] = useState<PlacePreferences>(emptyPlacePreferences);
  const [saving, setSaving] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [nearRoute, setNearRoute] = useState(true);
  const [speechCapability, setSpeechCapability] = useState<SpeechSearchCapability>({ available: false, kind: 'none' });
  const [listening, setListening] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const currentSearch = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, { at: number; places: NavigationPlace[] }>());
  const mounted = useRef(false);
  const preferences = useRef<PlacePreferencesController | null>(null);
  const speech = useRef<SpeechSearchController | null>(null);
  const speechRevision = useRef(0);
  const desiredOpen = useRef(open);
  desiredOpen.current = open;
  if (!speech.current) speech.current = new SpeechSearchController();
  if (!preferences.current) preferences.current = new PlacePreferencesController();
  preferences.current.setOwner(ownerId);
  const visible = open && !suspended;
  const cancelSpeech = () => { speechRevision.current++; speech.current!.cancel(); setListening(false); setSpeechStatus(''); };
  const closeSearch = () => { cancelSpeech(); onClose(); };
  const dialogRef = useDialog<HTMLDivElement>(visible, closeSearch);
  const cleanedQuery = query.trim().replace(/\s+/g, ' ');
  const displayedResults = useMemo(() => activeRoute && navigationActive && nearRoute ? placesNearRoute(results, activeRoute) : results, [results, activeRoute, navigationActive, nearRoute]);
  const selectedSaved = selected ? saved.saved.some(entry => entry.label === 'saved' && placeKey(entry.place) === placeKey(selected)) : false;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; currentSearch.current?.abort(); speechRevision.current++; speech.current!.cancel(); }; }, []);
  useEffect(() => {
    if (!open) cancelSpeech();
    // Suspending a native speech request would cancel it just because its system UI opened.
    else if (suspended && !speech.current!.usesExternalActivity) cancelSpeech();
  }, [open, suspended]);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    void speech.current!.getCapabilities().then(value => { if (current) setSpeechCapability(value); });
    return () => { current = false; };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setStorageError('');
    void preferences.current!.load().then(value => { if (current && value) setSaved(value); })
      .catch(() => { if (current) setStorageError('No se pudieron leer los lugares guardados en este dispositivo.'); });
    return () => { current = false; };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => { if (!selected) inputRef.current?.focus(); });
    const viewport = window.visualViewport;
    const resize = () => {
      const element = dialogRef.current;
      if (!element) return;
      element.style.setProperty('--place-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty('--place-viewport-offset', `${viewport?.offsetTop ?? 0}px`);
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); };
  }, [visible, selected, dialogRef]);
  useEffect(() => {
    currentSearch.current?.abort();
    setBusy(false); setError(''); setSearched('');
    if (!visible || cleanedQuery.length < 3) { setResults([]); return; }
    const controller = new AbortController(); currentSearch.current = controller;
    const prior = cache.current.get(cleanedQuery.toLocaleLowerCase('es'));
    if (prior && Date.now() - prior.at < 60000) {
      setResults(prior.places); setSearched(cleanedQuery); return () => controller.abort();
    }
    setResults([]);
    const timer = setTimeout(() => {
      setBusy(true);
      void NavigationService.searchPlaces(cleanedQuery, controller.signal).then(places => {
        if (controller.signal.aborted || currentSearch.current !== controller) return;
        setResults(places); setSearched(cleanedQuery);
        if (cache.current.size >= 24) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(cleanedQuery.toLocaleLowerCase('es'), { at: Date.now(), places });
      }).catch(reason => {
        if (!controller.signal.aborted && currentSearch.current === controller) setError(errorMessage(reason));
      }).finally(() => { if (!controller.signal.aborted && currentSearch.current === controller) setBusy(false); });
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cleanedQuery, visible]);

  const startSpeech = async () => {
    if (!visible || !speechCapability.available) return;
    if (listening) { cancelSpeech(); return; }
    const revision = ++speechRevision.current;
    setListening(true); setSpeechStatus('Escuchando con el reconocedor del dispositivo…'); inputRef.current?.blur();
    try {
      const result = await speech.current!.recognize();
      if (!mounted.current || revision !== speechRevision.current || !desiredOpen.current) return;
      if (result.status === 'recognized') { setQuery(result.transcript); setSpeechStatus('Texto reconocido. Puedes revisarlo y editarlo.'); }
      else setSpeechStatus(result.status === 'empty' ? 'No se reconoció texto. Inténtalo de nuevo o escribe el destino.' : '');
    } catch (reason) {
      if (mounted.current && revision === speechRevision.current && desiredOpen.current) setSpeechStatus(speechSearchError(reason));
    } finally { if (mounted.current && revision === speechRevision.current) setListening(false); }
  };

  const applyPreference = async (operation: () => Promise<PlacePreferences | null>) => {
    if (!ownerId || saving) return;
    setSaving(true); setStorageError('');
    try { const value = await operation(); if (mounted.current && value) setSaved(value); }
    catch { if (mounted.current) setStorageError('No se pudo guardar el cambio en este dispositivo. Inténtalo de nuevo.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const selectPlace = (place: NavigationPlace) => {
    cancelSpeech();
    setSelected(place); setShareStatus('');
    if (ownerId) void applyPreference(() => preferences.current!.remember(place));
  };
  const choose = () => {
    if (!selected) return;
    if (navigationActive) { if (onChooseStop) onChooseStop(selected); else return; }
    else onChooseDestination(selected);
    closeSearch();
  };
  const share = async () => {
    if (!selected) return;
    try {
      if (navigator.share) await navigator.share({ title: selected.nombre, text: placeShareText(selected) });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(placeShareText(selected)); if (mounted.current) setShareStatus('Ubicación copiada.'); }
      else if (mounted.current) setShareStatus('Puedes copiar las coordenadas que aparecen en la ficha.');
    } catch (reason) { if (mounted.current && !(reason instanceof DOMException && reason.name === 'AbortError')) setShareStatus('No se pudo compartir la ubicación.'); }
  };

  if (!visible || typeof document === 'undefined') return null;
  const lineDistance = selected ? straightLineDistance(currentPosition, selected) : null;
  const routeDistance = selected && activeRoute ? distanceToRoute(selected, activeRoute) : null;
  const home = saved.saved.find(entry => entry.label === 'home'), work = saved.saved.find(entry => entry.label === 'work');
  return createPortal(<div className="place-explorer-backdrop" onClick={event => { if (event.target === event.currentTarget) closeSearch(); }}>
    <div ref={dialogRef} className="place-explorer" role="dialog" aria-modal="true" aria-label={selected ? 'Información del lugar' : navigationActive ? 'Buscar cerca del recorrido' : 'Buscar destino'} tabIndex={-1}>
      <header className="place-explorer-header">
        <button type="button" className="place-icon-button" aria-label={selected ? 'Volver a resultados' : 'Cerrar búsqueda'} onClick={() => selected ? setSelected(null) : closeSearch()}><ArrowLeft size={20} aria-hidden="true" /></button>
        <div><strong>{selected ? 'Información del lugar' : navigationActive ? 'Buscar en el recorrido' : '¿A dónde vamos?'}</strong><small>{selected ? 'Datos disponibles del proveedor' : 'Lugares y direcciones de Ica'}</small></div>
        {selected && <button type="button" className="place-icon-button" aria-label="Cerrar ficha del lugar" onClick={closeSearch}><X size={20} aria-hidden="true" /></button>}
      </header>
      {!selected && <div className="place-search-fixed">
        <form onSubmit={event => { event.preventDefault(); inputRef.current?.blur(); }} role="search">
          <div className="place-search-row"><label className="place-search-input"><Search size={19} aria-hidden="true" /><input ref={inputRef} autoFocus aria-label="Buscar lugares en Ica" type="search" inputMode="search" enterKeyHint="search" placeholder="Busca un lugar o una dirección" maxLength={160} value={query} onChange={event => { cancelSpeech(); setQuery(event.target.value); }} autoComplete="off" />{query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => { cancelSpeech(); setQuery(''); inputRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}</label>
          {speechCapability.available && <button type="button" className="place-icon-button place-speech-button" aria-label={listening ? 'Cancelar búsqueda por voz' : 'Buscar destino por voz'} aria-pressed={listening} aria-describedby="place-speech-note" onClick={() => void startSpeech()}><Mic size={20} aria-hidden="true" /></button>}</div>
        </form>
        {speechCapability.available && <p id="place-speech-note" className="place-speech-note">Voz del dispositivo; su proveedor puede procesar el audio y requerir conexión.</p>}
        {speechStatus && <p className="place-notice place-speech-status" role="status">{speechStatus}</p>}
        {navigationActive && activeRoute && <label className="place-corridor-toggle"><input type="checkbox" checked={nearRoute} onChange={event => setNearRoute(event.target.checked)} />Sólo resultados a 500 m del recorrido</label>}
      </div>}
      <div className="place-explorer-content">
        {storageError && <p className="place-notice" role="status">{storageError}</p>}
        {selected ? <article className="place-detail">
          <span className="place-detail-pin"><MapPin size={26} aria-hidden="true" /></span><h2>{selected.nombre}</h2>
          {selected.descripcion && <p className="place-address">{selected.descripcion}</p>}
          {selected.fuente && <p className="place-source">Fuente: {selected.fuente}</p>}
          <dl className="place-facts"><div><dt>Ubicación</dt><dd>{selected.latitud.toFixed(6)}, {selected.longitud.toFixed(6)}</dd></div>
            {lineDistance !== null && <div><dt>Distancia en línea recta</dt><dd>{formatDistance(lineDistance)}</dd></div>}
            {navigationActive && routeDistance !== null && <div><dt>Separación geométrica de la ruta</dt><dd>{formatDistance(routeDistance)}</dd></div>}
          </dl>
          <div className="place-detail-actions">
            {(!navigationActive || onChooseStop) && <button type="button" className="btn btn-primary" onClick={choose}><MapPin size={17} aria-hidden="true" />{navigationActive ? 'Calcular parada' : 'Ver rutas'}</button>}
            {onShowPlace ? <button type="button" className="btn btn-secondary" onClick={() => onShowPlace(selected)}>Ver ubicación</button> : <a className="btn btn-secondary" href={placeMapUrl(selected)} target="_blank" rel="noopener noreferrer">Ver en OpenStreetMap</a>}
            <button type="button" className="btn btn-secondary" onClick={() => void share()}><Share2 size={16} aria-hidden="true" />Compartir</button>
            <button type="button" className="btn btn-secondary" disabled={!ownerId || saving} aria-pressed={selectedSaved} onClick={() => void applyPreference(() => selectedSaved ? preferences.current!.remove(selected) : preferences.current!.save(selected))}>{selectedSaved ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}{selectedSaved ? 'Guardado' : 'Guardar'}</button>
          </div>
          {ownerId ? <div className="place-save-labels"><span>Guardar como</span><button type="button" disabled={saving} onClick={() => void applyPreference(() => preferences.current!.save(selected, 'home'))}><Home size={15} aria-hidden="true" />Casa</button><button type="button" disabled={saving} onClick={() => void applyPreference(() => preferences.current!.save(selected, 'work'))}><BriefcaseBusiness size={15} aria-hidden="true" />Trabajo</button></div> : <p className="place-note">Inicia sesión para guardar lugares e historial en este dispositivo.</p>}
          {shareStatus && <p className="place-notice" role="status">{shareStatus}</p>}
          {navigationActive && <p className="place-note">La proximidad a la ruta no indica el desvío por carretera. Tu destino y recorrido siguen activos.{!onChooseStop && ' Las paradas con desvíos calculados todavía no están disponibles.'}</p>}
          <PlaceDetails key={`${selected.latitud}:${selected.longitud}:${selected.nombre}`} place={selected}/>
        </article> : <>
          <div className="place-category-list" aria-label="Categorías de lugares">{PLACE_CATEGORIES.map(category => { const Icon = categoryIcons[category.icon]; return <button key={category.id} type="button" aria-pressed={cleanedQuery === category.query} onClick={() => { cancelSpeech(); setQuery(category.query); inputRef.current?.blur(); }}><Icon size={17} aria-hidden="true" />{category.label}</button>; })}</div>
          {cleanedQuery.length >= 3 ? <section className="place-results" aria-label="Resultados de lugares">
            <h2>Resultados{navigationActive && nearRoute ? ' cercanos a la ruta' : ''}</h2>
            {busy && <p role="status" className="place-notice">Buscando lugares…</p>}
            {error && <p role="alert" className="place-notice">{error}</p>}
            {!busy && !error && searched === cleanedQuery && displayedResults.length === 0 && <p className="place-note">{results.length && navigationActive && nearRoute ? 'Los resultados recibidos están fuera del radio de 500 m. Puedes desactivar el filtro para consultarlos.' : 'No hay resultados disponibles. Prueba con otro nombre o una dirección más concreta.'}</p>}
            <ul>{displayedResults.map(place => <li key={placeKey(place)}><button type="button" className="place-result" onClick={() => selectPlace(place)}><MapPin size={19} aria-hidden="true" /><span><strong>{place.nombre}</strong>{place.descripcion && <small>{place.descripcion}</small>}{place.fuente && <em>{place.fuente}</em>}</span></button></li>)}</ul>
            {navigationActive && activeRoute && <p className="place-note">Se filtran los resultados disponibles por su cercanía geométrica. Esta búsqueda no cubre todos los establecimientos del corredor.</p>}
          </section> : <>
            <section className="place-personal-shortcuts" aria-label="Casa y trabajo"><button type="button" onClick={() => { if (home) selectPlace(home.place); else inputRef.current?.focus(); }}><Home size={20} aria-hidden="true" /><span><strong>Casa</strong><small>{home?.place.nombre || 'Busca un lugar para guardarlo'}</small></span></button><button type="button" onClick={() => { if (work) selectPlace(work.place); else inputRef.current?.focus(); }}><BriefcaseBusiness size={20} aria-hidden="true" /><span><strong>Trabajo</strong><small>{work?.place.nombre || 'Busca un lugar para guardarlo'}</small></span></button></section>
            {saved.saved.length > 0 && <section className="place-personal-list"><h2><Bookmark size={16} aria-hidden="true" />Guardados</h2><ul>{saved.saved.map(entry => <li key={`${entry.label}:${placeKey(entry.place)}`}><button type="button" className="place-result" onClick={() => selectPlace(entry.place)}><Bookmark size={18} aria-hidden="true" /><span><strong>{entry.place.nombre}</strong><small>{labelNames[entry.label]}</small></span></button><button type="button" className="place-icon-button" disabled={saving} aria-label={`Quitar ${entry.place.nombre} de ${labelNames[entry.label]}`} onClick={() => void applyPreference(() => preferences.current!.remove(entry.place, entry.label))}><X size={16} aria-hidden="true" /></button></li>)}</ul></section>}
            {saved.recent.length > 0 && <section className="place-personal-list"><h2><Clock3 size={16} aria-hidden="true" />Recientes<button type="button" disabled={saving} aria-label="Borrar historial de lugares" onClick={() => void applyPreference(() => preferences.current!.clearRecent())}><Trash2 size={15} aria-hidden="true" /></button></h2><ul>{saved.recent.map(entry => <li key={placeKey(entry.place)}><button type="button" className="place-result" onClick={() => selectPlace(entry.place)}><Clock3 size={18} aria-hidden="true" /><span><strong>{entry.place.nombre}</strong>{entry.place.descripcion && <small>{entry.place.descripcion}</small>}</span></button></li>)}</ul></section>}
            {!ownerId && <p className="place-note">Puedes buscar sin guardar historial. Inicia sesión para conservar Casa, Trabajo y tus lugares favoritos.</p>}
            {cleanedQuery.length > 0 && cleanedQuery.length < 3 && <p className="place-note">Escribe al menos 3 caracteres.</p>}
          </>}
        </>}
      </div>
    </div>
  </div>, document.body);
};
