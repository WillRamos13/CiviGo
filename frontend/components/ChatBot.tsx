'use client';
import Link from 'next/link';
import { MessageCircle, X, Send, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { post, errorMessage } from '@/lib/api';
import { assistantHistory, assistantReply, type AssistantTurn } from '@/lib/assistant';
import AssistantReply from './AssistantReply';

const preguntas = ['¿Cómo hago un reporte?', '¿Cómo calculo una ruta?', '¿Qué significan los puntos de riesgo?', '¿Qué incidentes hay ahora?'];

export default function ChatBot() {
    const { usuario } = useAuth();
    return <AccountChatBot key={usuario?.id ?? 'publico'} />;
}

function AccountChatBot() {
    const alive = useRef(true), request = useRef<AbortController | null>(null), list = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false), [input, setInput] = useState('');
    const [messages, setMessages] = useState<AssistantTurn[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; request.current?.abort(); };
    }, []);
    useEffect(() => { if (open) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages, open]);

    const ask = async (question: string) => {
        const mensaje = question.trim();
        if (!mensaje || mensaje.length > 1000 || request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true); setError('');
        try {
            const data = assistantReply(await post<unknown>('/chatbot', { mensaje, historial: assistantHistory(messages) }, { signal: controller.signal }));
            if (!alive.current || controller.signal.aborted) return;
            setMessages(previous => [...previous, { pregunta: mensaje, ...data }].slice(-5));
            setInput('');
        } catch (e) {
            if (alive.current && !controller.signal.aborted) setError(errorMessage(e));
        } finally {
            if (request.current === controller) {
                request.current = null;
                if (alive.current) setBusy(false);
            }
        }
    };
    const reset = () => {
        request.current?.abort(); request.current = null;
        setBusy(false); setMessages([]); setInput(''); setError('');
    };

    return <>
        <button className="chatbot-launcher" onClick={() => setOpen(!open)} aria-label={open ? 'Cerrar ayuda' : 'Abrir ayuda de CiviGo'} aria-expanded={open} aria-controls="civigo-assistant">
            {open ? <X size={20} /> : <MessageCircle size={22} />}
        </button>
        {open && <aside id="civigo-assistant" className="chatbot-box" aria-label="Ayuda de CiviGo">
            <div className="card-header"><h3>Tu guía de CiviGo</h3><div className="actions">
                <button type="button" className="icon-btn" aria-label="Nueva conversación" onClick={reset} disabled={!messages.length && !busy && !input && !error}><RotateCcw size={16} /></button>
                <button type="button" className="icon-btn" aria-label="Cerrar ayuda" onClick={() => setOpen(false)}><X size={17} /></button>
            </div></div>
            <p className="muted" style={{ fontSize: 11 }}>Ayuda sobre reportes, rutas y reglas de CiviGo. Las consultas con IA y su historial reciente se procesan en OpenAI.</p>
            <div ref={list} className="chat-list" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversación con la ayuda" style={{ maxHeight: 280 }}>
                {messages.length === 0 ? preguntas.map(p => <button type="button" className="btn btn-secondary btn-small" key={p} disabled={busy} onClick={() => void ask(p)}>{p}</button>) : messages.map((m, i) => <div key={i}>
                    <p style={{ fontSize: 11, fontWeight: 700, margin: '12px 0 6px' }}>{m.pregunta}</p>
                    {!m.ia && <span className="badge">Guía de CiviGo</span>}
                    <AssistantReply text={m.respuesta}/>
                    {m.aviso && <p className="muted" style={{ fontSize: 11 }}>{m.aviso}</p>}
                </div>)}
            </div>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <form onSubmit={e => { e.preventDefault(); void ask(input); }}>
                <div className="field"><label htmlFor="assistant-question">Escribe tu consulta</label><input id="assistant-question" value={input} onChange={e => setInput(e.target.value)} maxLength={1000} required disabled={busy} placeholder="Cómo reportar, rutas, incidentes…" /></div>
                <div className="actions"><button type="submit" className="btn btn-primary btn-small" disabled={busy || !input.trim()}><Send size={12} />{busy ? 'Consultando…' : 'Enviar'}</button><Link href="/mapa" className="btn btn-secondary btn-small">Ir al mapa</Link></div>
            </form>
        </aside>}
    </>;
}
