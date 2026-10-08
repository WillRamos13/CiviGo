import { Fragment } from 'react';
import { assistantMarkdown, type AssistantInline } from '@/lib/assistant-markdown';
import styles from './AssistantReply.module.css';

function Inline({ content }: { content: AssistantInline[] }) {
    return content.map((token, index) => token.kind === 'strong'
        ? <strong key={index}>{token.text}</strong>
        : token.kind === 'code' ? <code key={index}>{token.text}</code> : <Fragment key={index}>{token.text}</Fragment>);
}

export default function AssistantReply({ text }: { text: string }) {
    return <div className={`notice ${styles.reply}`}>{assistantMarkdown(text).map((block, index) => {
        if (block.kind === 'paragraph') return <p key={index}><Inline content={block.content}/></p>;
        const List = block.ordered ? 'ol' : 'ul';
        return <List key={index}>{block.items.map((content, item) => <li key={item}><Inline content={content}/></li>)}</List>;
    })}</div>;
}
