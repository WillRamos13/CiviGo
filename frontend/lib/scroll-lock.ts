const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();
/** Fullscreen and dialogs may overlap and release in either order. */
export function lockScroll(element: HTMLElement = document.body): () => void {
    let lock = locks.get(element);
    if (!lock) { lock = {count: 0, overflow: element.style.overflow}; locks.set(element,lock); }
    lock.count++; element.style.overflow = 'hidden';
    let released = false;
    return () => { if (released) return; released = true; if (--lock.count === 0) { element.style.overflow = lock.overflow; locks.delete(element); } };
}
