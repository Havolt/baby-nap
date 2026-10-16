import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function getBasePath() {
  if (process.env.GITHUB_PAGES !== 'true') return '/'

  const [owner, repository] = (process.env.GITHUB_REPOSITORY ?? '').split('/')
  if (!repository || repository === `${owner}.github.io`) return '/'

  return `/${repository}/`
}

// https://vite.dev/config/
export default defineConfig({
  base: getBasePath(),
  plugins: [react()],
})
