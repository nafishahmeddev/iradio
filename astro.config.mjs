// @ts-check
import { defineConfig } from 'astro/config';

// A fully static site. The API is a separate Cloudflare Worker (see worker/);
// in development, requests to /api are passed to it on port 8787.
export default defineConfig({
  output: 'static',
  server: { port: 4321 },
  vite: {
    server: { proxy: { '/api': 'http://localhost:8787' } },
  },
});
