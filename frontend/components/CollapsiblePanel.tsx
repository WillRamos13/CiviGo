'use client';
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type Props = {
    title: ReactNode;
    children: ReactNode;
    className?: string;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export default function CollapsiblePanel({ title, children, className = '', defaultOpen = false, open, onOpenChange }: Props) {
    const [localOpen, setLocalOpen] = useState(defaultOpen);
    const bodyId = useId();
    const expanded = open ?? localOpen;
    const toggle = () => {
        if (onOpenChange) onOpenChange(!expanded);
        else setLocalOpen(!expanded);
    };
    return <section className={`collapsible-panel ${className}`}>
        <button type="button" className="panel-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={toggle}>
            <span>{title}</span><ChevronDown size={16} aria-hidden="true" />
        </button>
        <div className="collapsible-panel-body" id={bodyId} hidden={!expanded}>{children}</div>
    </section>;
}
