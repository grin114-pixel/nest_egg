import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    // 같은 Wi‑Fi의 폰이나 다른 PC에서도 숫자 주소(예: 192.168.x.x)로 접속 가능
    host: true,
    // 5173은 다른 앱과 겹침 — Nest Egg 기본 포트
    port: 5188,
    // 5188이 이미 쓰이면 다음 포트 사용(안 그러면 서버가 바로 꺼질 수 있음)
    strictPort: false,
    // 개발 서버 켜지면 기본 브라우저로 열기
    open: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'Nest Egg',
        short_name: 'Nest Egg',
        description: '목돈 마련을 위한 저축 관리 앱',
        theme_color: '#ec4899',
        background_color: '#fff9fc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
