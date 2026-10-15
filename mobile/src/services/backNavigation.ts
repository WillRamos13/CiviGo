type BackEntry = { token: symbol; dismiss: () => void };

/** The most recently opened dialog consumes Back/Escape before its screen. */
export class BackHandlers {
  private entries: BackEntry[] = [];
  register(dismiss: () => void) {
    const token = Symbol('dialog');
    this.entries.push({ token, dismiss });
    return {
      isTop: () => this.entries[this.entries.length - 1]?.token === token,
      remove: () => { this.entries = this.entries.filter(entry => entry.token !== token); },
    };
  }
  dismissTop(): boolean {
    const entry = this.entries[this.entries.length - 1];
    if (!entry) return false;
    entry.dismiss();
    return true;
  }
}

export const backHandlers = new BackHandlers();

export function handleAppBack(
  state: { inSubview: boolean; inOtherTab: boolean },
  actions: { previousView: () => void; mapTab: () => void; minimize: () => void },
  dialogs: BackHandlers = backHandlers,
): void {
  if (dialogs.dismissTop()) return;
  if (state.inSubview) actions.previousView();
  else if (state.inOtherTab) actions.mapTab();
  else actions.minimize();
}
