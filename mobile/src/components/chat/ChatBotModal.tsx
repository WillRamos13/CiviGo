import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, RotateCcw, Bot } from 'lucide-react';
import { post, errorMessage } from '../../services/api';
import { triggerHaptic } from '../../services/native';

const PREGUNTAS = [
  '¿Cómo hago un reporte?',
  '¿Cómo calculo una ruta segura?',
  '¿Qué significan los puntos de riesgo?',
  '¿Qué incidentes hay activos ahora?',
];

interface ChatTurn {
  pregunta: string;
  respuesta: string;
  ia?: boolean;
  aviso?: string;
}

interface ChatBotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChatBotModal: React.FC<ChatBotModalProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const ask = async (question: string) => {
    const query = question.trim();
    if (!query || busy) return;
    void triggerHaptic('light');
    setBusy(true);
    setError('');

    const historyPayload = messages.map((m) => ({
      pregunta: m.pregunta,
      respuesta: m.respuesta,
    }));

    try {
      const res = await post<{
        respuesta: string;
        ia?: boolean;
        aviso?: string;
      }>('/chatbot', {
        mensaje: query,
        historial: historyPayload,
      });

      setMessages((prev) => [
        ...prev,
        {
          pregunta: query,
          respuesta: res.respuesta || 'No se recibió una respuesta clara.',
          ia: res.ia,
          aviso: res.aviso,
        },
      ]);
      setInput('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    void triggerHaptic('light');
    setMessages([]);
    setInput('');
    setError('');
  };

  return (
    <div className="chatbot-modal" onClick={onClose}>
      <div className="chatbot-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bottom-sheet-handle" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: 'var(--brand-soft)',
                color: 'var(--brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bot size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>Asistente CiviGo</h3>
              <span className="muted" style={{ fontSize: 11 }}>Tu guía sobre rutas, seguridad y reportes</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="icon-btn"
              onClick={reset}
              disabled={messages.length === 0 || busy}
              aria-label="Reiniciar conversación"
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Cerrar asistente"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Chat history */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            maxHeight: '45vh',
            minHeight: '180px',
            overflowY: 'auto',
            padding: '8px 0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: 'auto 0', textAlign: 'center' }}>
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                ¿Tienes dudas sobre cómo funciona CiviGo? Elige una pregunta frecuente:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PREGUNTAS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-secondary btn-small"
                    style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 12 }}
                    onClick={() => ask(p)}
                    disabled={busy}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <React.Fragment key={idx}>
                <div className="chat-bubble chat-user">
                  {m.pregunta}
                </div>
                <div className="chat-bubble chat-bot">
                  <div style={{ marginBottom: 4 }}>
                    <span className="badge" style={{ fontSize: 9, padding: '2px 5px' }}>
                      {m.ia ? 'Respuesta asistida por IA' : 'Guía CiviGo'}
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>
                    {m.respuesta}
                  </div>
                  {m.aviso && (
                    <small className="muted" style={{ display: 'block', marginTop: 6, fontSize: 10 }}>
                      {m.aviso}
                    </small>
                  )}
                </div>
              </React.Fragment>
            ))
          )}

          {busy && (
            <div className="chat-bubble chat-bot" style={{ fontStyle: 'italic', color: 'var(--muted)' }}>
              Consultando asistente…
            </div>
          )}
        </div>

        {error && <div className="notice notice-error" style={{ margin: 0 }}>{error}</div>}

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          style={{ display: 'flex', gap: 8, marginTop: 4 }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="Pregunta sobre reportes, rutas, Ica…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            maxLength={500}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
            style={{ minWidth: 44, padding: '0 14px' }}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};
