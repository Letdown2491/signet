import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '../../src/styles/tokens.css';
import './style.css';
import { Setup } from './Setup';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Setup />
  </React.StrictMode>,
);
