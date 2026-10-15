import React, { Fragment } from 'react';
import { assistantMarkdown, type AssistantInline } from '../../services/assistant';
function Inline({ tokens }: { tokens: AssistantInline[] }) {
  return tokens.map((token, index) => token.kind === 'strong' ? <strong key={index}>{token.text}</strong>
    : token.kind === 'code' ? <code key={index}>{token.text}</code> : <Fragment key={index}>{token.text}</Fragment>);
}
export function AssistantReply({ text }: { text: string }) {
  return <div style={{ overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.5 }}>{assistantMarkdown(text).map((block, index) => {
    if (block.kind === 'paragraph') return <p key={index}><Inline tokens={block.content} /></p>;
    const List = block.ordered ? 'ol' : 'ul';
    return <List key={index} style={{ paddingInlineStart: 20 }}>{block.items.map((tokens, item) => <li key={item}><Inline tokens={tokens} /></li>)}</List>;
  })}</div>;
}
