import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './thinking.css';
import './layout-fix.css';
import '@xterm/xterm/css/xterm.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
