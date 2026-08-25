#!/usr/bin/env node
/**
 * Bake the Drive-backed portfolio content into this repo.
 *
 * Run this on your own machine, with the private Personal-Website backend
 * running locally (it needs credentials.json + the Drive folder ids). It:
 *
 *   1. reads /api/v1/projects and /api/v1/art from the local backend
 *   2. downloads every image/video those records reference
 *   3. rewrites the asset URLs to site-relative paths
 *   4. writes src/content/*.json and public/content/assets/*
 *
 * After that the published site is completely self-contained — no backend, no
 * Drive credentials, nothing to keep online. That is the entire point: the CMS
 * exists only on your laptop at build time.
 *
 *   npm run export-content
 *   BACKEND=http://localhost:8000 npm run export-content
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = (process.env.BACKEND ?? 'http://localhost:8000').replace(/\/$/, '');

const CONTENT_DIR = join(ROOT, 'src', 'content');
const ASSET_DIR = join(ROOT, 'public', 'content', 'assets');
// Where the browser will look for assets on the published site.
const PUBLIC_ASSET_PATH = '/content/assets';

async function getJson(path) {
  const res = await fetch(`${BACKEND}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Download one asset, returning the site-relative path to store in the JSON. */
async function download(url, seen) {
  // Asset URLs look like http://localhost:8000/api/v1/assets/<file-id>
  const id = url.split('/').pop();
  if (!id) {
    throw new Error(`Cannot derive a file id from asset URL: ${url}`);
  }
  const rel = `${PUBLIC_ASSET_PATH}/${id}`;
  if (seen.has(id)) {
    return rel;
  }

  const res = await fetch(url);
  if (!res.ok) {
    // Fail loudly. A silently missing image is worse than a failed build: the
    // gallery clears itself on a bad load and does not retry.
    throw new Error(`Asset ${id} -> ${res.status} ${res.statusText}`);
  }
  await writeFile(join(ASSET_DIR, id), Buffer.from(await res.arrayBuffer()));
  seen.add(id);
  return rel;
}

/**
 * Walk any nested structure and replace every backend asset URL with its
 * downloaded, site-relative equivalent. Done generically so new fields in the
 * Drive schema are picked up without editing this script.
 */
async function rewriteAssets(node, seen) {
  if (Array.isArray(node)) {
    return Promise.all(node.map((item) => rewriteAssets(item, seen)));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        typeof value === 'string' && value.startsWith(`${BACKEND}/api/v1/assets/`)
          ? await download(value, seen)
          : await rewriteAssets(value, seen);
    }
    return out;
  }
  return node;
}

async function main() {
  process.stdout.write(`Reading content from ${BACKEND}\n`);

  const [projects, art] = await Promise.all([
    getJson('/api/v1/projects'),
    getJson('/api/v1/art'),
  ]);

  if (projects.length === 0 && art.length === 0) {
    // The backend returns [] until its first Drive sync lands, so an empty
    // result usually means "started too early", not "no content".
    throw new Error(
      'Backend returned no projects and no art. If it just started, wait for ' +
        'the initial Drive sync to finish and run this again.',
    );
  }

  // Rebuild the asset folder from scratch so deleted Drive files don't linger.
  await rm(ASSET_DIR, { recursive: true, force: true });
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(CONTENT_DIR, { recursive: true });

  const seen = new Set();
  const bakedProjects = await rewriteAssets(projects, seen);
  const bakedArt = await rewriteAssets(art, seen);

  await writeFile(
    join(CONTENT_DIR, 'projects.json'),
    `${JSON.stringify(bakedProjects, null, 2)}\n`,
  );
  await writeFile(join(CONTENT_DIR, 'art.json'), `${JSON.stringify(bakedArt, null, 2)}\n`);

  process.stdout.write(
    `Baked ${bakedProjects.length} projects, ${bakedArt.length} artworks, ` +
      `${seen.size} assets.\nRun \`npm run build\` next.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`\nexport-content failed: ${error.message}\n`);
  process.exit(1);
});
