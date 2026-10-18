import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

function exposeRootAssets() {
  return {
    name: 'expose-root-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (request, response, next) => {
        const requestedPath = request.url?.split('?')[0] || '';
        response.sendFile(resolve(__dirname, 'assets', requestedPath.replace(/^\//, '')), (error) => {
          if (error) next();
        });
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/icon.png',
        source: readFileSync(resolve(__dirname, 'assets/icon.png'))
      });
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/main/main.js')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'src/preload/preload.js')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), exposeRootAssets()]
  }
});
