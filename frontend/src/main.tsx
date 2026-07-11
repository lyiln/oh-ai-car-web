import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.js';
import { AuthProvider } from './contexts/AuthContext.js';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
