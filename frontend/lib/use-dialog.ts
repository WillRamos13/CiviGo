'use client';
import { useEffect, useRef } from 'react';
import { lockScroll } from './scroll-lock';
const dialogs: symbol[] = [];
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
    const ref = useRef<T>(null), close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        const element = ref.current;
        if (!open || !element) return;
        const token = Symbol(); dialogs.push(token);
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const unlock = lockScroll();
        const controls = () => [...element.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length > 0);
        const frame = requestAnimationFrame(() => (element.querySelector<HTMLInputElement>('input[type="search"]') ?? controls()[0] ?? element).focus());
        const keydown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || dialogs.at(-1) !== token) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
            if (event.key !== 'Tab') return;
            const items = controls(), first = items[0], last = items.at(-1);
            if (!first || !last) {event.preventDefault(); element.focus(); return;}
            if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { cancelAnimationFrame(frame); dialogs.splice(dialogs.indexOf(token),1); document.removeEventListener('keydown',keydown); unlock(); if (opener?.isConnected) opener.focus(); };
    }, [open]);
    return ref;
}
