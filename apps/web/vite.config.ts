import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages는 https://iyaho.github.io/sigwan/ 아래에 올라간다. 배포 워크플로가 PAGES_BASE=/sigwan/을 준다
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173 },
});
