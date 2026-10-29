'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bookmark, BriefcaseBusiness, Clock3, Home, MapPin, Search, Share2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { normalizePlaceQuery, startPlaceSearch, type PlaceResult, type PlaceSearchState } from '@/lib/place-search';
import { PLACE_CATEGORIES, placeKey, placeShareText, placesNearRoute, straightLineDistance } from '@/lib/place-discovery';
import { PlacePreferencesController, emptyPlacePreferences, type PlacePreferences, type PlaceLabel } from '@/lib/place-preferences';
import { useDialog } from '@/lib/use-dialog';
import type { Posicion, Ruta } from '@/lib/types';
import styles from './DestinationExplorer.module.css';
import PlaceDetails from './PlaceDetails';
type Props = { open: boolean; onClose: () => void; ownerId: number | null; currentPosition?: Posicion | null; route?: Ruta | null; initialQuery?: string; initialPlace?: PlaceResult | null; onChoose: (place: PlaceResult) => void; onShowPlace?: (place: PlaceResult) => void; };
export default function DestinationExplorer(props: Props) { return <Explorer key={props.ownerId ?? 'guest'} {...props}/>; }
function Explorer({open,onClose,ownerId,currentPosition,route,initialQuery='',initialPlace=null,onChoose,onShowPlace}: Props) {
    const [query,setQuery] = useState(initialQuery), [selected,setSelected] = useState<PlaceResult | null>(null);
    const [search,setSearch] = useState<PlaceSearchState>({query:'',status:'idle',results:[],error:''});
    const [saved,setSaved] = useState<PlacePreferences>(emptyPlacePreferences), [storageError,setStorageError] = useState(''), [shareStatus,setShareStatus] = useState(''), [nearRoute,setNearRoute] = useState(false), [saving,setSaving] = useState(false);
    const [preferences] = useState(() => new PlacePreferencesController());
    const panel=useDialog<HTMLElement>(open,onClose), mounted=useRef(true);
    const cleaned=normalizePlaceQuery(query);
    const results=useMemo(()=>route && nearRoute ? placesNearRoute(search.results,route) : search.results,[search.results,route,nearRoute]);
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
    useEffect(()=>{preferences.setOwner(ownerId);return()=>preferences.setOwner(null);},[ownerId,preferences]);
    useEffect(()=>{
        if(!open)return;let current=true;
        void Promise.resolve().then(()=>{if(current){setQuery(initialQuery);setSelected(initialPlace);setShareStatus('');setStorageError('');}});
        void preferences.load().then(value=>{if(current&&value)setSaved(value);}).catch(()=>{if(current)setStorageError('No se pudieron leer tus lugares guardados.');});
        return()=>{current=false;};
    },[open,initialQuery,initialPlace,preferences]);
    useEffect(()=>{
        if(!open || cleaned.length<3)return;
        return startPlaceSearch(cleaned,(q,signal)=>api(`/navigation/places?q=${encodeURIComponent(q)}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])}),setSearch);
    },[open,cleaned]);
    useEffect(()=>{
        if(!open)return;
        const viewport=window.visualViewport;
        const resize=()=>{panel.current?.style.setProperty('--place-height',`${viewport?.height??innerHeight}px`);panel.current?.style.setProperty('--place-top',`${viewport?.offsetTop??0}px`);};
        resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
        return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);};
    },[open,panel]);
    const changeSaved=async(operation:()=>Promise<PlacePreferences|null>)=>{
        if(!ownerId || saving)return;setSaving(true);setStorageError('');
        try{const value=await operation();if(mounted.current&&value)setSaved(value);}catch{if(mounted.current)setStorageError('No se pudo guardar el cambio en este navegador.');}finally{if(mounted.current)setSaving(false);}
    };
    const select=(place:PlaceResult)=>{setSelected(place);setShareStatus('');if(ownerId)void changeSaved(()=>preferences.remember(place));};
    const save=(label:PlaceLabel)=>{if(selected)void changeSaved(()=>preferences.save(selected,label));};
    const share=async()=>{
        if(!selected)return;
        try{if(navigator.share)await navigator.share({title:selected.nombre,text:placeShareText(selected)});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(placeShareText(selected));setShareStatus('Ubicación copiada.');}else setShareStatus('Puedes copiar las coordenadas de la ficha.');}catch(e){if(!(e instanceof DOMException && e.name==='AbortError'))setShareStatus('No se pudo compartir la ubicación.');}
    };
    if(!open)return null;
    const lineDistance=selected?straightLineDistance(currentPosition,selected):null;
    const personal=(['home','work'] as const).map(label=>({label,name:label==='home'?'Casa':'Trabajo',Icon:label==='home'?Home:BriefcaseBusiness,entry:saved.saved.find(item=>item.label===label)}));
    return createPortal(<div className={styles.overlay} onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}>
        <section ref={panel} role="dialog" aria-modal="true" aria-label={selected?'Información del lugar':'Buscar destino'} tabIndex={-1} className={styles.panel}>
            <header className={styles.header}><button type="button" className="icon-btn" aria-label={selected?'Volver a resultados':'Cerrar búsqueda'} onClick={()=>selected?setSelected(null):onClose()}><ArrowLeft size={21}/></button><div><strong>{selected?'Información del lugar':'¿A dónde vamos?'}</strong><small>Lugares y direcciones de Ica</small></div><button type="button" className="icon-btn" aria-label="Cerrar explorador de lugares" onClick={onClose}><X size={21}/></button></header>
            {!selected && <div className={styles.search}><Search size={20}/><input type="search" aria-label="Buscar lugares en Ica" placeholder="Busca un lugar o una dirección" value={query} maxLength={160} autoComplete="off" onChange={event=>setQuery(event.target.value)}/></div>}
            <div className={styles.body}>
                {storageError&&<p role="status" className="notice">{storageError}</p>}
                {selected?<article className={styles.detail}><PlaceDetails key={`${selected.latitud}:${selected.longitud}:${selected.nombre}`} place={selected}><h2>{selected.nombre}</h2>{selected.descripcion&&<p>{selected.descripcion}</p>}</PlaceDetails>
                    <dl><dt>Ubicación</dt><dd>{selected.latitud.toFixed(6)}, {selected.longitud.toFixed(6)}</dd>{lineDistance!==null&&<><dt>Distancia en línea recta</dt><dd>{(lineDistance/1000).toFixed(2)} km</dd></>}</dl>
                    <div className={styles.actions}><button type="button" className="btn btn-primary" onClick={()=>{onChoose(selected);onClose();}}>Elegir destino</button>{onShowPlace&&<button type="button" className="btn btn-secondary" onClick={()=>{onShowPlace(selected);onClose();}}>Ver en el mapa</button>}<button type="button" className="btn btn-secondary" onClick={()=>void share()}><Share2 size={16}/>Compartir</button></div>
                    {ownerId&&<><div className={styles.actions}><button type="button" className="btn btn-secondary" disabled={saving} onClick={()=>save('saved')}><Bookmark size={16}/>{saved.saved.some(item=>item.label==='saved'&&placeKey(item.place)===placeKey(selected))?'Guardado':'Guardar'}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={()=>save('home')}><Home size={16}/>Casa</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={()=>save('work')}><BriefcaseBusiness size={16}/>Trabajo</button></div><button type="button" className="btn btn-quiet" disabled={saving} onClick={()=>void changeSaved(()=>preferences.remove(selected))}>Quitar de guardados</button></>}
                    {shareStatus&&<p role="status">{shareStatus}</p>}
                </article>:<>
                    <div className={styles.chips} aria-label="Categorías de lugares">{PLACE_CATEGORIES.map(category=><button type="button" key={category.id} onClick={()=>setQuery(category.query)}>{category.label}</button>)}</div>
                    {route&&<label className={styles.corridor}><input type="checkbox" checked={nearRoute} onChange={event=>setNearRoute(event.target.checked)}/>Sólo resultados a 500 m del recorrido<small>Distancia geométrica; no mide el desvío por carretera.</small></label>}
                    {cleaned.length>=3?<section aria-label="Resultados de lugares"><h2>Resultados</h2>{search.query!==cleaned||search.status==='loading'?<p role="status">Buscando lugares…</p>:search.error?<p role="alert">{search.error}</p>:results.length===0?<p>No hay resultados disponibles. Prueba otro nombre o dirección.</p>:results.map(place=><button type="button" className={styles.result} key={placeKey(place)} onClick={()=>select(place)}><MapPin size={19}/><span><strong>{place.nombre}</strong>{place.descripcion&&<small>{place.descripcion}</small>}{place.fuente&&<small>{place.fuente}</small>}</span></button>)}</section>:<>
                        <div className={styles.personal}>{personal.map(({label,name,Icon,entry})=><button type="button" key={label} onClick={()=>entry?select(entry.place):panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()}><Icon size={22}/><strong>{name}</strong><small>{entry?.place.nombre||'Busca un lugar para guardarlo'}</small></button>)}</div>
                        {saved.saved.length>0&&<section><h2><Bookmark size={17}/>Guardados</h2>{saved.saved.map(entry=><div className={styles.saved} key={entry.label+placeKey(entry.place)}><button type="button" className={styles.result} onClick={()=>select(entry.place)}><span><strong>{entry.place.nombre}</strong><small>{entry.label==='home'?'Casa':entry.label==='work'?'Trabajo':'Guardado'}</small></span></button><button type="button" className="icon-btn" aria-label={`Quitar ${entry.place.nombre}`} onClick={()=>void changeSaved(()=>preferences.remove(entry.place,entry.label))}><X size={16}/></button></div>)}</section>}
                        {saved.recent.length>0&&<section><h2><Clock3 size={17}/>Recientes</h2><button type="button" className="btn btn-quiet" onClick={()=>void changeSaved(()=>preferences.clearRecent())}>Borrar historial de lugares</button>{saved.recent.map(entry=><button type="button" className={styles.result} key={placeKey(entry.place)} onClick={()=>select(entry.place)}><Clock3 size={18}/><span><strong>{entry.place.nombre}</strong><small>{entry.place.descripcion}</small></span></button>)}</section>}
                        {cleaned.length>0&&<p>Escribe al menos tres caracteres.</p>}
                    </>}
                </>}
            </div>
        </section>
    </div>,document.fullscreenElement??document.querySelector('[data-map-fullscreen="true"]')??document.body);
}
