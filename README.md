# FOCUS

Local-first book reader (Electron + React). Import PDF / EPUB / DOCX / HTML / TXT / MD, ads and boilerplate are stripped, then read with highlights, sticky notes, bookmarks, auto-resume and local search.

## Run
    npm install
    npm run dev        # Electron with hot reload
    npm start          # build + run the packaged renderer
    npm run dist       # make a .dmg / installer (electron-builder)

## iPad / other devices
The renderer is a plain web app (IndexedDB storage), so `npm run build:web` produces `dist/`.
Host it on any static host (Netlify, GitHub Pages, Cloudflare Pages), open it in Safari, Share > Add to Home Screen.
Then: Export everything on laptop -> AirDrop / iCloud Drive the .json -> Restore backup on iPad. Imports merge (newest edit wins), so you can go back and forth.

## Notes
- Scanned PDFs (no text layer) are rejected; OCR is not built in.
- Two-column PDFs may interleave columns.
- Semantic note search is optional (Aa panel): downloads a ~25MB model once. Default search is offline fuzzy/lexical.
