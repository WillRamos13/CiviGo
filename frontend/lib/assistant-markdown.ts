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

// This intentionally small renderer returns text tokens, never HTML, links,
// images, iframe attributes or executable Markdown extensions.
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
            const previous = blocks.at(-1);
            if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(assistantInline(bullet[2]));
            else blocks.push({ kind: 'list', ordered, items: [assistantInline(bullet[2])] });
        } else if (/^#{1,3}\s+/.test(trimmed)) {
            flush(); blocks.push({ kind: 'paragraph', content: [{ kind: 'strong', text: trimmed.replace(/^#{1,3}\s+/, '') }] });
        } else paragraph.push(trimmed);
    }
    flush();
    return blocks;
}
