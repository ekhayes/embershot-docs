#!/usr/bin/env node
/**
 * Read scraped-content/_manifest.json, place each scraped markdown file into
 * docs/<category>/<slug>.md, write a _category_.json for each category, and
 * rewrite cross-article links from the old Freshdesk URLs to the new local
 * Docusaurus paths.
 *
 * Idempotent. Run after the scrape + image migration.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const scrapedRoot = join(repoRoot, 'scraped-content');
const docsRoot = join(repoRoot, 'docs');
const manifestPath = join(scrapedRoot, '_manifest.json');

// Category metadata: pretty label, sidebar position, optional description.
// Add or edit here to change the sidebar - this is the single source of truth.
const CATEGORY_META = {
  'getting-started':        { label: 'Getting Started',        position: 1 },
  'account-settings':       { label: 'Account & Profile',      position: 2 },
  'account-billing':        { label: 'Billing & Subscription', position: 3 },
  'security-and-mfa':       { label: 'Security & MFA',         position: 4 },
  'projects-and-admins':    { label: 'Projects & Admins',      position: 5 },
  'groups-and-permissions': { label: 'Groups & Permissions',   position: 6 },
  'uploads-and-files':      { label: 'Uploads & Files',        position: 7 },
  'sharing-and-links':      { label: 'Sharing & Links',        position: 8 },
  'watermarks':             { label: 'Watermarks',             position: 9 },
  'annotations':            { label: 'Annotations',            position: 10 },
  'viewing-and-playback':   { label: 'Viewing & Playback',     position: 11 },
  'analytics-and-tracking': { label: 'Analytics & Tracking',   position: 12 },
  'mobile-and-apps':        { label: 'Mobile & Apps',          position: 13 },
  'enterprise':             { label: 'Enterprise',             position: 14 },
  'troubleshooting':        { label: 'Troubleshooting',        position: 15 },
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Build url-> new local path map for cross-link rewriting
// Old: https://help.embershot.com/support/solutions/articles/<id>-...
// New: /<category>/<slug>
const linkMap = new Map();
for (const a of manifest) {
  const cat = a.suggested_category || 'troubleshooting';
  linkMap.set(a.source_url, `/${cat}/${a.slug}`);
  // Also handle url without trailing dash, with /a/, etc.
  linkMap.set(a.source_url.replace(/\/$/, ''), `/${cat}/${a.slug}`);
  // Just the article ID, in case some links use a shorter form
  linkMap.set(`/support/solutions/articles/${a.id}`, `/${cat}/${a.slug}`);
}

// Rewrite article body
function rewriteBody(body, ownArticle) {
  let out = body;
  // Cross-article links: replace each known source_url with the new local path
  for (const [oldUrl, newPath] of linkMap) {
    if (oldUrl === ownArticle.source_url) continue; // skip self-links
    out = out.split(oldUrl).join(newPath);
  }
  // Catch-all: any remaining help.embershot.com links to articles - leave but log
  return out;
}

// Group articles by category
const byCategory = new Map();
for (const a of manifest) {
  const cat = a.suggested_category || 'troubleshooting';
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  byCategory.get(cat).push(a);
}

// Validate categories exist in CATEGORY_META
const unknownCats = [...byCategory.keys()].filter((c) => !CATEGORY_META[c]);
if (unknownCats.length) {
  console.warn(`Warning: categories in manifest not in CATEGORY_META: ${unknownCats.join(', ')}`);
  for (const c of unknownCats) CATEGORY_META[c] = { label: c, position: 99 };
}

// Wipe stale auto-migrated content (anything in docs/ that matches a category folder)
// but PRESERVE intro.md and any other non-category top-level files.
for (const cat of Object.keys(CATEGORY_META)) {
  const dir = join(docsRoot, cat);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
}

// Write each category folder
let totalWritten = 0;
let leftoverHelpLinks = 0;
for (const [cat, articles] of byCategory) {
  const catDir = join(docsRoot, cat);
  mkdirSync(catDir, { recursive: true });

  // Sort articles alphabetically by title for stable ordering
  articles.sort((a, b) => a.title.localeCompare(b.title));

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const srcPath = join(scrapedRoot, a.filename);
    if (!existsSync(srcPath)) {
      console.warn(`Missing scrape file: ${srcPath}`);
      continue;
    }
    const raw = readFileSync(srcPath, 'utf8');

    // Strip the original frontmatter, build a fresh one for Docusaurus
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
    const rewritten = rewriteBody(body, a);

    // Count any remaining help.embershot.com cross-links so we know what's leftover
    const leftovers = (rewritten.match(/help\.embershot\.com\/support\/solutions\/articles/g) || []).length;
    leftoverHelpLinks += leftovers;

    const newFm = [
      '---',
      `id: ${a.id}`,
      `title: ${JSON.stringify(a.title)}`,
      `sidebar_position: ${i + 1}`,
      `slug: /${cat}/${a.slug}`,
      `description: ${JSON.stringify(a.title)}`,
      '---',
      '',
    ].join('\n');

    writeFileSync(join(catDir, `${a.slug}.md`), newFm + rewritten.trimStart());
    totalWritten++;
  }

  // _category_.json for the sidebar
  const meta = CATEGORY_META[cat];
  writeFileSync(
    join(catDir, '_category_.json'),
    JSON.stringify(
      {
        label: meta.label,
        position: meta.position,
        link: { type: 'generated-index', title: meta.label, slug: `/${cat}` },
      },
      null,
      2
    ) + '\n'
  );
}

console.log(`Wrote ${totalWritten} articles across ${byCategory.size} categories.`);
if (leftoverHelpLinks) {
  console.log(`Note: ${leftoverHelpLinks} cross-link(s) still point at help.embershot.com (likely point to articles outside the manifest).`);
}
