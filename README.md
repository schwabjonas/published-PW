# published-PW

The public, static build of [jonasschwab.com](https://github.com/schwabjonas) —
portfolio, art gallery, and home page. Deployed to GitHub Pages.

This repo is deliberately **content-only**. It has no backend, no API keys, no
database, and makes no network calls at runtime. Everything a visitor loads is a
file in `dist/`.

## What is not here

The AI avatar ("JonasGPT") — the chat page, the voice synthesis, and the FastAPI
backend — lives in the private `Personal-Website` repo. It needs a live server
and credentials, which is exactly what this repo exists to avoid.

The animated head on the home page *is* here: it is plain sprite art with cursor
tracking, blinking, and a click-to-smile gesture. It makes no network calls. Only
its lip-sync methods needed the voice service, and nothing calls them here.

## How content gets in

Portfolio and art content lives in Google Drive. It is baked into this repo at
build time, on a laptop — never fetched by the browser:

```
Google Drive → local FastAPI backend → npm run export-content → src/content/*.json
                                                              → public/content/assets/*
```

Because the backend only ever runs locally, the Drive credentials never leave
your machine and there is no server for anyone to reach.

### Updating the site after changing Drive

```bash
# 1. In the private Personal-Website repo, start the backend:
cd ../Personal-Website/backend
source .venv/bin/activate
uvicorn app.main:app            # wait for the initial Drive sync to finish

# 2. Back here — pull the content in and commit it:
npm run export-content
git add src/content public/content
git commit -m "Update portfolio content"
git push                        # Actions builds and deploys
```

Anything baked in becomes **public**, since this repo is public. Keep private
material out of the synced Drive folders.

## Local development

```bash
npm install
npm start                       # http://localhost:4200
npm run build                   # prerenders every route into dist/frontend/browser
```

Requires Node 22.22.3+, 24.15+, or 26+ (Angular 22's minimum).

## How it is built

Every route is prerendered to real HTML at build time (`outputMode: "static"`),
so there is no server process. `portfolio/:slug` is enumerated from
`src/content/projects.json` in `app.routes.server.ts`, giving one HTML file per
project. `post-build.mjs` adds `404.html` and `.nojekyll` for Pages.
