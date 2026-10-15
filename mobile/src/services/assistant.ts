import { post } from './api';
export type AssistantTurn = { pregunta: string; respuesta: string; ia?: boolean; aviso?: string };
export async function askAssistant(question: string, history: AssistantTurn[], signal?: AbortSignal): Promise<AssistantTurn> {
  const query = question.trim();
  if (!query || query.length > 1000) throw new Error('Escribe una pregunta de hasta 1000 caracteres.');
  const result = await post<{ respuesta: string; ia?: boolean; aviso?: string }>('/chatbot', {
    mensaje: query,
    historial: history.slice(-5).map(({ pregunta, respuesta }) => ({ pregunta: pregunta.slice(0, 1000), respuesta: respuesta.slice(0, 3000) })),
  }, { signal });
  if (typeof result?.respuesta !== 'string' || !result.respuesta.trim()) throw new Error('No se recibió una respuesta del asistente. Inténtalo de nuevo.');
  return { pregunta: query, respuesta: result.respuesta.slice(0, 3000), ia: result.ia === true,
    aviso: typeof result.aviso === 'string' ? result.aviso.slice(0, 1000) : undefined };
}

export type AssistantInline = { kind: 'text' | 'strong' | 'code'; text: string };
export type AssistantBlock = { kind: 'paragraph'; content: AssistantInline[] } | { kind: 'list'; ordered: boolean; items: AssistantInline[][] };
export function assistantInline(value: string): AssistantInline[] {
  const result: AssistantInline[] = [];
  const tokens = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`/g;
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    if (match.index! > cursor) result.push({ kind: 'text', text: value.slice(cursor, match.index) });
    result.push({ kind: match[3] ? 'code' : 'strong', text: match[1] ?? match[2] ?? match[3] });
    cursor = match.index! + match[0].length;
  }
  if (cursor < value.length) result.push({ kind: 'text', text: value.slice(cursor) });
  return result;
}
/** Only text tokens: no executable HTML, links, remote images or Markdown plugins. */
export function assistantMarkdown(value: string): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', content: assistantInline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const line of value.slice(0, 3000).replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const bullet = /^(?:([-*])\s+|\d+[.)]\s+)(.+)$/.exec(trimmed);
    if (bullet) {
      flush();
      const ordered = !bullet[1];
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(assistantInline(bullet[2]));
      else blocks.push({ kind: 'list', ordered, items: [assistantInline(bullet[2])] });
    } else if (/^#{1,3}\s+/.test(trimmed)) {
      flush(); blocks.push({ kind: 'paragraph', content: [{ kind: 'strong', text: trimmed.replace(/^#{1,3}\s+/, '') }] });
    } else paragraph.push(trimmed);
  }
  flush();
  return blocks;
}
