import {defineConfig} from 'vite';

// The gateway serves this build from web/dist and sends a strict CSP for '/'
// and '/assets/': script-src 'self' with no 'unsafe-inline'. Vite's module
// preload polyfill is injected as an INLINE <script>, which that header blocks
// outright -- the app would ship a blank page. Turning the polyfill off keeps
// every script external; module preload is native in all browsers that can run
// an ES2022 bundle anyway.
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    modulePreload: {polyfill: false},
    sourcemap: false,
  },
  // Same-origin gateway during local development, so the PWA never needs CORS
  // or a second backend.
  server: {proxy: Object.fromEntries(['/api', '/livekit-token', '/health'].map(p => [p, {target: 'http://127.0.0.1:8080', changeOrigin: true}]))},
});
