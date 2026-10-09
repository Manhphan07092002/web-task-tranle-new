import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import AdminApp from './pages/Admin/AdminApp';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { DataProvider } from './contexts/DataContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import 'flatpickr/dist/flatpickr.min.css';

// Suppress Recharts ResponsiveContainer "width/height = -1" warning
const _warn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('width(-1) and height(-1)')) return;
  _warn(...args);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <LanguageProvider>
            <AuthProvider>
              <DataProvider>
                <NotificationProvider>
                  <Routes>
                    <Route path="/admin/*" element={<AdminApp />} />
                    <Route path="/*" element={<App />} />
                  </Routes>
                </NotificationProvider>
              </DataProvider>
            </AuthProvider>
          </LanguageProvider>
        </BrowserRouter>
        {/* <ReactQueryDevtools initialIsOpen={false} /> */}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
