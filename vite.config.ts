import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from GitHub Pages at https://<user>.github.io/finance-tracker/
const base = process.env.BASE_PATH ?? '/finance-tracker/';

// The ONNX runtime's WebAssembly engine, served from this site instead of a CDN.
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
const ortDir = () => fileURLToPath(new URL('./node_modules/onnxruntime-web/dist', import.meta.url));
function selfHostOrt(): Plugin {
  return {
    name: 'self-host-ort',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = ORT_FILES.find((f) => req.url?.endsWith(`/ort/${f}`));
        if (!name) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(ortDir(), name)));
      });
    },
    generateBundle() {
      for (const f of ORT_FILES) this.emitFile({ type: 'asset', fileName: `ort/${f}`, source: readFileSync(join(ortDir(), f)) });
    },
  };
}

/** onnxruntime-web also bundles its own copy of the engine; the app uses /ort/ instead, so drop it. */
function dropBundledOrt(): Plugin {
  return {
    name: 'drop-bundled-ort',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) if (/assets\/ort-wasm-.*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

export default defineConfig({
  base,
  worker: { format: 'es', plugins: () => [dropBundledOrt()] },
  plugins: [
    preact(),
    selfHostOrt(),
    VitePWA({
      // Updates install on their own (a crash-looping page couldn't reach an "Update" button).
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Finance Tracker',
        short_name: 'Finances',
        description: 'Private, on-device personal finance tracker.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // AI files are big and optional; they're cached separately once downloaded.
        globIgnores: ['ort/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
