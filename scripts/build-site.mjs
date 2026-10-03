// Builds the Vercel site: landing page at / and the browser/iPad web app at /app/
import { rmSync, cpSync } from 'node:fs'
import { execSync } from 'node:child_process'
rmSync('site-dist', { recursive: true, force: true })
execSync('npx vite build --outDir site-dist/app --emptyOutDir', { stdio: 'inherit' })
cpSync('site', 'site-dist', { recursive: true })
