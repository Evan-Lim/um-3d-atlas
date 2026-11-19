import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const BUILD_ID = Date.now().toString(36);

function cacheBustEntryAssets(): Plugin {
  return {
    name: 'cache-bust-entry-assets',
    transformIndexHtml(html) {
      return html
        .replace(/(\.\/assets\/app\.js)(["'])/g, `$1?v=${BUILD_ID}$2`)
        .replace(/(\.\/assets\/app\.css)(["'])/g, `$1?v=${BUILD_ID}$2`)
        .replace(/(\.\/assets\/maplibre\.js)(["'])/g, `$1?v=${BUILD_ID}$2`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), cacheBustEntryAssets()],
  define: {
    __ATLAS_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'assets/app.css';
          }
          return 'assets/[name][extname]';
        },
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
});
