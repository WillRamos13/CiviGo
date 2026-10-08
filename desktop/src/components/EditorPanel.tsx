import { useLayoutEffect, useRef, type ReactNode } from 'react';

export default function EditorPanel({ children, label, selectionKey }: {
  children: ReactNode;
  label: string;
  selectionKey: string | number;
}) {
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = container.current;
    if (!panel) return;
    const header = document.querySelector('.desktop-header');
    const headerHeight = header?.getBoundingClientRect().height ?? 0;
    panel.style.scrollMarginTop = `${headerHeight + 16}px`;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [selectionKey]);
  return <section ref={container} className="editor-panel" role="region" aria-label={label} tabIndex={-1}>{children}</section>;
}
