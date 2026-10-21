import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5392, strictPort: true, fs: { allow: ['..'] }, proxy: { '/api': 'http://localhost:4392' } },
});
