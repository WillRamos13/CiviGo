import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MobileErrorBoundary } from './components/layout/MobileErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileErrorBoundary><App /></MobileErrorBoundary>
  </React.StrictMode>
);
