'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MapPin, Camera, FileText } from 'lucide-react';
import AuthGate from '@/components/AuthGate';
import MapView from '@/components/MapView';
import IncidentIcon from '@/components/IncidentIcon';
import { api, crearReporte, currentPosition, distance, errorMessage, upload } from '@/lib/api';
import type { Catalogo, Posicion } from '@/lib/types';
import { incidentEvaluationLabel, reportPublicationState } from '@/lib/incidents';
function localDateTime(d: Date) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function Form() {
    const [catalog, setCatalog] = useState<Catalogo | null>(null), [slug, setSlug] = useState(''), [description, setDescription] = useState(''), [gps, setGps] = useState<Posicion | null>(null), [position, setPosition] = useState<Posicion | null>(null), [correct, setCorrect] = useState(false), [eventDate, setEventDate] = useState(''), [files, setFiles] = useState<File[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [locationBusy, setLocationBusy] = useState(false), [result, setResult] = useState<Awaited<ReturnType<typeof crearReporte>> | null>(null);
    useEffect(() => { let active = true; api<Catalogo>('/catalog').then(d => { if (active)
        setCatalog(d); }).catch(e => { if (active)
        setError(errorMessage(e)); }); return () => { active = false; }; }, []);
    const [dateLimits] = useState(() => ({ min: localDateTime(new Date(Date.now() - 7 * 86400000)), max: localDateTime(new Date()) }));
    const tipo = catalog?.categorias.flatMap(c => c.tipos).find(t => t.slug === slug);
    const locate = async () => { setLocationBusy(true); setError(''); try {
        const p = await currentPosition();
        setGps(p);
        setPosition(p);
        setCorrect(false);
    }
    catch (err) {
        setError(errorMessage(err));
    }
    finally {
        setLocationBusy(false);
    } };
    const adjust = (p: Posicion) => { if (!tipo) return false; if (!Number.isFinite(p.latitud) || !Number.isFinite(p.longitud) || Math.abs(p.latitud) > 90 || Math.abs(p.longitud) > 180) {
        setError('Ingresa coordenadas válidas para el incidente.');
        return false;
    } if (!tipo.ubicacionRemota && !gps) {
        setError('Obtén tu ubicación GPS antes de ajustar el punto del incidente.');
        return false;
    } if (!tipo.ubicacionRemota && gps && distance(gps, p) > 50) {
        setError('Solo puedes corregir la ubicación hasta 50 metros desde el GPS.');
        return false;
    } setPosition(p); setCorrect(false); setError(''); return true; };
    const chooseFiles = (list: FileList | null) => { if (!list)
        return; const selected = [...files, ...Array.from(list)]; if (selected.length > 3) {
        setError('Puedes adjuntar como máximo tres fotos o videos.');
        return;
    } if (selected.some(f => !f.type.startsWith('image/') && !f.type.startsWith('video/'))) {
        setError('Solo se admiten fotografías y videos.');
        return;
    } if (selected.some(f => f.size > 15 * 1024 * 1024)) {
        setError('Cada archivo debe pesar como máximo 15 MB.');
        return;
    } setFiles(selected); setError(''); };
    const submit = async (e: React.FormEvent) => { e.preventDefault(); setError(''); if (!tipo)
        return setError('Selecciona el tipo de incidente.'); if (!position || !correct)
        return setError('Confirma que la ubicación es correcta.'); if (!tipo.ubicacionRemota && !gps)
        return setError('Obtén tu ubicación GPS antes de reportar.'); if (tipo.fotoObligatoria && !files.some(f => f.type.startsWith('image/')))
        return setError('Este tipo de incidente requiere al menos una fotografía.'); if (gps && !tipo.ubicacionRemota && distance(gps, position) > 50)
        return setError('La corrección de ubicación supera los 50 metros.'); setBusy(true); try {
        const adjuntos = [];
        for (const file of files)
            adjuntos.push(await upload(file, tipo.individual));
        const data = await crearReporte({ tipo: slug, descripcion: description.trim(), ...position, gpsLatitud: gps?.latitud, gpsLongitud: gps?.longitud, fechaEvento: eventDate ? new Date(eventDate).toISOString() : new Date().toISOString(), adjuntosIds: adjuntos.map(a => a.id) });
        setResult(data);
    }
    catch (err) {
        setError(errorMessage(err));
    }
    finally {
        setBusy(false);
    } };
    if (result) {
        const publicationState = reportPublicationState(result.reporte, result.incidente);
        const receipt = publicationState === 'review'
            ? result.incidente.publicado && result.incidente.porEvaluar
                ? 'Tu reporte requiere revisión humana. La alerta se muestra como «por evaluar» mientras un agente la revisa.'
                : result.incidente.publicado
                    ? 'Tu reporte requiere revisión humana. Se añadió a un incidente visible, pero tu aporte aún no está validado.'
                    : 'Tu reporte requiere revisión humana antes de publicarse.'
            : publicationState === 'pending'
                ? 'Tu reporte está pendiente de evaluación antes de publicarse.'
                : publicationState === 'published-pending'
                    ? 'La alerta está visible en el mapa como «por evaluar». Su publicación no confirma que el hecho sea auténtico.'
                    : 'El incidente está visible en el mapa. La evaluación preliminar y la validación humana se muestran por separado.';
        return <div className="card empty"><FileText size={42} color="var(--brand)" style={{ margin: '0 auto 16px' }}/><h2>Recibimos tu reporte #{result.reporte.id}</h2><p>{receipt}</p>{publicationState !== 'review' && <span className="badge">{incidentEvaluationLabel(result.incidente)}</span>}{result.incidente.evaluacion === 'IA' && publicationState !== 'review' && <p className="muted">La IA contrasta el contenido con el reporte; no certifica la autenticidad del hecho ni de los archivos.</p>}{tipo?.individual && <p>Desde Mis reportes puedes aportar pruebas privadas. El plazo de siete días se cuenta desde la publicación del incidente.</p>}<div className="actions" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" href="/mis-reportes">Ver mis reportes</Link><Link className="btn btn-secondary" href="/mapa">Volver al mapa</Link></div></div>;
    }
    return <form onSubmit={submit}>{error && <div className="notice notice-error" role="alert">{error}</div>}<div className="grid-2" style={{ alignItems: 'start' }}><div><div className="card"><div className="card-header"><h2>1. ¿Qué sucedió?</h2><span className="badge">Reporte ciudadano</span></div><div className="field"><label htmlFor="tipo">Categoría y tipo de incidente</label><select id="tipo" value={slug} onChange={e => { setSlug(e.target.value); setPosition(gps); setCorrect(false); setFiles([]); setEventDate(''); }} required><option value="">Selecciona un tipo</option>{catalog?.categorias.map(c => <optgroup label={c.nombre} key={c.id}>{c.tipos.map(t => <option key={t.id} value={t.slug}>{t.nombre}</option>)}</optgroup>)}</select></div>{tipo && <><div className="incident-title-with-icon"><IncidentIcon tipo={tipo.nombre} slug={tipo.slug} size={40}/><h3>{tipo.nombre}</h3></div><div className="notice">{tipo.individual ? 'Reporte individual: no se agrupa ni recibe confirmaciones de otros ciudadanos. Sus pruebas son privadas.' : 'Los reportes del mismo tipo cercanos, dentro de tres horas, pueden agruparse en un incidente común.'}{tipo.emergencia && <><br />Este tipo puede publicarse como «por evaluar» mientras espera revisión. Estar visible no significa estar validado.</>}</div></>}<div className="field"><label htmlFor="descripcion">Descripción (opcional)</label><textarea id="descripcion" value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} placeholder="Describe lo que ocurrió y su situación actual. No incluyas datos personales de otras personas."/><small>Describe hechos que conoces. La gravedad la evalúan la IA o los agentes.</small></div>{tipo?.ubicacionRemota && <div className="field"><label htmlFor="fecha-evento">¿Cuándo ocurrió?</label><input id="fecha-evento" type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)} min={dateLimits.min} max={dateLimits.max}/><small>Puedes reportar hechos de hasta una semana atrás. Si lo dejas vacío se usa el momento actual.</small></div>}</div><div className="card"><h2>2. Adjuntos</h2><p className="muted" style={{ fontSize: 12 }}>{tipo?.fotoObligatoria ? 'Este tipo requiere al menos una fotografía.' : 'Las fotografías son opcionales para este tipo.'} Máximo tres fotos o videos de hasta 30 segundos, de hasta 15 MB cada uno.</p><p className="muted" style={{ fontSize: 12 }}>La IA contrasta las fotos con el tipo y la descripción del reporte. Los videos y las imágenes dudosas o ajenas al hecho requieren revisión humana. Esta evaluación no certifica la autenticidad de los archivos ni que el hecho haya ocurrido.</p>{tipo?.individual && <div className="notice">Estos adjuntos se guardarán como pruebas privadas, visibles únicamente para el personal autorizado.</div>}<div className="file-drop"><Camera size={24} color="var(--brand)" style={{ margin: '0 auto 10px' }}/><label className="btn btn-secondary btn-small">Capturar foto o video<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" capture="environment" multiple onChange={e => { chooseFiles(e.target.files); e.target.value = ''; }} disabled={files.length >= 3 || busy}/></label><p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>Carga los archivos directamente. No se aceptan enlaces a redes sociales.</p></div><div className="file-list">{files.map((f, i) => <span className="file-chip" key={`${f.name}-${i}`}>{f.name}<button type="button" className="icon-btn" style={{ padding: 0 }} aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}>×</button></span>)}</div></div></div><div><div className="card"><h2>3. Ubicación del incidente</h2><p className="muted" style={{ fontSize: 12 }}>Confirma en el mapa el lugar del hecho. El distrito se determina a partir de esa ubicación.</p><button type="button" className="btn btn-secondary" onClick={locate} disabled={locationBusy || !tipo}><MapPin size={15}/>{locationBusy ? 'Obteniendo GPS…' : 'Usar mi ubicación actual'}</button>{tipo?.ubicacionRemota && <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Este tipo permite marcar otra ubicación en el mapa y ajustar sus coordenadas.</p>}{tipo && <div className="location-editor"><MapView posicion={position} onPosition={adjust} editor/></div>}{position && <div className="grid-2"><div className="field"><label htmlFor="lat">Latitud</label><input id="lat" type="number" step="0.000001" value={position.latitud} onChange={e => adjust({ latitud: e.target.valueAsNumber, longitud: position.longitud })} required min={-90} max={90}/></div><div className="field"><label htmlFor="lng">Longitud</label><input id="lng" type="number" step="0.000001" value={position.longitud} onChange={e => adjust({ latitud: position.latitud, longitud: e.target.valueAsNumber })} required min={-180} max={180}/></div></div>}{!tipo?.ubicacionRemota && position && <p className="muted" style={{ fontSize: 11 }}>Puedes corregir el punto arrastrando el marcador o pulsando el mapa, hasta 50 metros desde el GPS.</p>}{position && <label className="inline-checkbox"><input type="checkbox" checked={correct} onChange={e => setCorrect(e.target.checked)}/><span><strong>¿La ubicación es correcta?</strong><br />Confirmo que el punto corresponde al hecho.</span></label>}</div><div className="card"><h3>Antes de enviar</h3><p className="muted" style={{ fontSize: 12 }}>El reporte queda asociado a tu cuenta. Compartir información falsa puede reducir tu credibilidad después de una revisión humana.</p><button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !catalog}>{busy ? 'Guardando reporte y archivos…' : 'Enviar reporte'}</button><small className="muted" style={{ display: 'block', marginTop: 12 }}>La publicación depende del tipo y de la evaluación disponible. CiviGo no sustituye los servicios de emergencia.</small></div></div></div></form>;
}
export default function Page() { return <div className="page"><div className="page-heading"><span className="eyebrow">TU APORTE CUENTA</span><h1>Reportar un incidente</h1><p>Comparte lo que sucede en tu entorno para informar a tu comunidad.</p></div><AuthGate participation><Form /></AuthGate></div>; }
