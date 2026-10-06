import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        stream: path.resolve(__dirname, 'stream-stub.js'),
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['task.tranlecorp.com.vn', 'tasks.tranlecorp.com.vn', '.tranlecorp.com.vn', 'tranlecorp.com', 'localhost', '127.0.0.1'],
      port: parseInt(env.VITE_PORT || '5173'),
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://127.0.0.1:3500',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env.VITE_API_URL || 'http://127.0.0.1:3500',
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-ui': ['lucide-react', 'motion', '@hello-pangea/dnd'],
            'vendor-charts': ['recharts'],
            'vendor-excel': ['exceljs'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
