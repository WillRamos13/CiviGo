import React from 'react';

/** A render failure must expose recovery instead of leaving a blank WebView. */
export class MobileErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('[CiviGo] Error de interfaz recuperable:', error.name); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="mobile-recovery-screen" role="alert">
      <img src="/civigo-logo.jpeg" alt="CiviGo" width="64" height="76" />
      <h1>Recuperar CiviGo</h1>
      <p>La pantalla no pudo continuar. Puedes volver a abrirla para recuperar el último recorrido guardado.</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reabrir la aplicación</button>
    </main>;
  }
}
