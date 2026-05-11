'use strict';

/**
 * Vercel is often configured with Output Directory = "public", but `nest build` only emits `dist/`.
 * This script runs as part of `npm run build` so `public/` always exists when the build finishes.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const template = path.join(__dirname, 'vercel-static-index.html');
const dest = path.join(publicDir, 'index.html');

fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(template)) {
  console.error('sync-public-for-vercel: missing template', template);
  process.exit(1);
}
fs.copyFileSync(template, dest);
console.log('sync-public-for-vercel: wrote', dest);
