#!/usr/bin/env node
/**
 * Walks every markdown file in scraped-content/, finds remote image URLs
 * (markdown ![](url) and HTML <img src="...">), downloads each unique image
 * to static/img/help/, and rewrites references to use local paths.
 *
 * Idempotent: skips images already on disk. Safe to re-run.
 *
 * Usage:
 *   node scripts/pull-images.mjs [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const scrapedRoot = join(repoRoot, 'scraped-content');
const imageOutDir = join(repoRoot, 'static', 'img', 'help');
const localPathPrefix = '/img/help/';

const dryRun = process.argv.includes('--dry-run');

// Match Embershot/Freshdesk/cdn.shootto image URLs - the hosts the scrape will reference
const REMOTE_IMG_HOSTS = /^(https?:\/\/)([^/]*\.)?(embershot\.com|shootto\.com|shoot\.to|vasari\.art|freshdesk\.com|freshservice\.com|cloudfront\.net|amazonaws\.com)/i;

// markdown image: ![alt](url "optional title")
const MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// HTML img tag with src
const HTML_IMG = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

if (!existsSync(scrapedRoot)) {
  console.error(`No scraped-content/ directory at ${scrapedRoot}. Run the scrape first.`);
  process.exit(1);
}

if (!dryRun) mkdirSync(imageOutDir, { recursive: true });

function walkMd(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkMd(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

function localFilenameFor(url) {
  // Use a content-stable hash + the original extension.
  // Original filenames from Freshdesk often collide (e.g. all "image.png").
  let ext = extname(new URL(url).pathname).toLowerCase();
  if (!ext || ext.length > 6) ext = '.png';
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 12);
  const slugBase = basename(new URL(url).pathname, ext)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'img';
  return `${slugBase}-${hash}${ext}`;
}

async function downloadOnce(url, destPath) {
  if (existsSync(destPath)) return { skipped: true };
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(destPath));
  return { skipped: false };
}

async function main() {
  const files = walkMd(scrapedRoot);
  console.log(`Scanning ${files.length} markdown files...`);

  // url -> localFilename
  const urlMap = new Map();
  // Collect all unique URLs first
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const urls = new Set();
    for (const m of text.matchAll(MD_IMG)) urls.add(m[2]);
    for (const m of text.matchAll(HTML_IMG)) urls.add(m[1]);
    for (const url of urls) {
      if (urlMap.has(url)) continue;
      if (!REMOTE_IMG_HOSTS.test(url)) continue;
      try {
        urlMap.set(url, localFilenameFor(url));
      } catch {
        // Bad URL; skip
      }
    }
  }

  console.log(`Found ${urlMap.size} unique remote images to migrate.`);

  if (dryRun) {
    for (const [url, fn] of urlMap) console.log(`  ${url} -> ${localPathPrefix}${fn}`);
    return;
  }

  // Download in parallel batches of 8
  const entries = [...urlMap.entries()];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  const BATCH = 8;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ([url, fn]) => {
        try {
          const r = await downloadOnce(url, join(imageOutDir, fn));
          if (r.skipped) skipped++;
          else downloaded++;
        } catch (err) {
          failed++;
          failures.push({ url, error: err.message });
        }
      })
    );
    process.stdout.write(`  ${Math.min(i + BATCH, entries.length)}/${entries.length}\r`);
  }
  console.log(`\nDownloaded: ${downloaded}  Skipped (already on disk): ${skipped}  Failed: ${failed}`);

  // Rewrite markdown to use local paths
  let touchedFiles = 0;
  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    let updated = original.replace(MD_IMG, (match, alt, url, ...rest) => {
      const fn = urlMap.get(url);
      return fn ? `![${alt}](${localPathPrefix}${fn})` : match;
    });
    updated = updated.replace(HTML_IMG, (match, url) => {
      const fn = urlMap.get(url);
      if (!fn) return match;
      return match.replace(url, `${localPathPrefix}${fn}`);
    });
    if (updated !== original) {
      writeFileSync(file, updated);
      touchedFiles++;
    }
  }
  console.log(`Rewrote image paths in ${touchedFiles} files.`);

  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.url}  -  ${f.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
