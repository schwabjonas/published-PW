#!/usr/bin/env node
/**
 * Post-build fixes for GitHub Pages.
 *
 * 1. 404.html — Pages serves this for any path it has no file for. Angular
 *    prerenders /, /portfolio, /art and one page per project, but a mistyped or
 *    stale URL would otherwise hit GitHub's own 404 page instead of the site.
 *    Copying the client-side shell there lets the Angular router take over and
 *    apply its `**` redirect, so visitors land on the home page in our design.
 *
 * 2. .nojekyll — Pages runs Jekyll by default, which silently ignores files and
 *    folders whose names start with an underscore. Angular does not emit those
 *    today, but the failure mode is an invisible missing asset, so we opt out.
 */

import { copyFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'frontend', 'browser');

await copyFile(join(OUT, 'index.csr.html'), join(OUT, '404.html'));
await writeFile(join(OUT, '.nojekyll'), '');

process.stdout.write('post-build: wrote 404.html and .nojekyll\n');
