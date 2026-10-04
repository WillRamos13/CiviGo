export type AssistantMessage = { role: 'user' | 'assistant'; content: string };
export type AssistantReply = { respuesta: string; modo: 'ia' | 'guia'; ia: boolean; aviso?: string };
export type AssistantTurn = AssistantReply & { pregunta: string };

// Replay complete recent turns only. Nothing is stored in browser storage.
export function assistantHistory(turns: readonly AssistantTurn[]): AssistantMessage[] {
    const history: AssistantMessage[] = [];
    let characters = 0;
    for (const turn of turns.slice(-5).reverse()) {
        const question = turn.pregunta.trim(), answer = turn.respuesta.trim();
        if (!question || !answer || question.length > 1000 || answer.length > 3000) continue;
        if (characters + question.length + answer.length > 12000) break;
        history.unshift({ role: 'user', content: question }, { role: 'assistant', content: answer });
        characters += question.length + answer.length;
    }
    return history;
}

export function assistantReply(value: unknown): AssistantReply {
    if (!value || typeof value !== 'object') throw new Error('La ayuda no devolvió una respuesta válida. Inténtalo de nuevo.');
    const result = value as Record<string, unknown>;
    if (typeof result.respuesta !== 'string' || !result.respuesta.trim() || result.respuesta.length > 3000
        || !['ia', 'guia'].includes(String(result.modo)) || typeof result.ia !== 'boolean'
        || result.ia !== (result.modo === 'ia'))
        throw new Error('La ayuda no devolvió una respuesta válida. Inténtalo de nuevo.');
    return { respuesta: result.respuesta.trim(), modo: result.modo as 'ia' | 'guia', ia: result.ia,
        ...(typeof result.aviso === 'string' && result.aviso.trim() ? { aviso: result.aviso.trim().slice(0, 500) } : {}) };
}
