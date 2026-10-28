import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages project site: https://<org>.github.io/Dynamic-Booking-Calendar/
export default defineConfig({
  base: process.env.VITE_BASE || '/Dynamic-Booking-Calendar/',
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') }
    }
  }
});
