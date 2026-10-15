import { useEffect, useRef } from 'react';
import { backHandlers } from '../services/backNavigation';

const controls = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard focus inside the top dialog and restore its opener on close. */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const registration = backHandlers.register(() => close.current());
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>(controls))
      .filter(control => control.getClientRects().length > 0 && !control.closest('[hidden], [inert]'));
    const focusFirst = () => (focusable()[0] ?? element).focus();
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (!registration.isTop() || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); element.focus(); return; }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !element.contains(current))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (current === last || !element.contains(current))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      registration.remove();
      document.removeEventListener('keydown', keydown);
      if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus();
    };
  }, [open]);
  return ref;
}
