import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['jsqr'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['logo.png', 'app-icon-192.png', 'app-icon-512.png', 'favicon.ico'],
      devOptions: {
        enabled: false, // Disabled in development - no more cache issues!
        type: 'module'
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // 8 MB
        skipWaiting: true, // Force new service worker to activate immediately
        clientsClaim: true, // Take control of all clients immediately
        cleanupOutdatedCaches: true, // Remove old caches automatically
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      manifest: {
        id: '/',
        name: 'Digital Zone Billing',
        short_name: 'Digital Zone',
        description: 'Billing System for Digital Zone',
        theme_color: '#F8FAFC',
        background_color: '#F8FAFC',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/app-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/app-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
})
