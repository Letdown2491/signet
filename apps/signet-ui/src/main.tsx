import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  // React 19 error handlers for better debugging
  onCaughtError: (error, errorInfo) => {
    console.error('[React] Caught error:', error);
    console.error('[React] Component stack:', errorInfo.componentStack);
  },
  onUncaughtError: (error, errorInfo) => {
    console.error('[React] Uncaught error:', error);
    console.error('[React] Component stack:', errorInfo.componentStack);
  },
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
