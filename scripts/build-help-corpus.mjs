#!/usr/bin/env node
/**
 * Build a single text corpus of every docs/ article for the Embershot
 * Help Chat. Each article is delimited by a banner that includes title,
 * URL, and category so Claude can cite back to specific docs.
 *
 * Output: dist-corpus/help-corpus.txt (gitignored, regenerated on every run)
 *
 * Run: node scripts/build-help-corpus.mjs
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const docsRoot = join(repoRoot, 'docs');
const outDir = join(repoRoot, 'dist-corpus');
const outPath = join(outDir, 'help-corpus.txt');

const SITE_BASE = 'https://docs.embershot.com';
const SEPARATOR = '='.repeat(80);

// Mirror of CATEGORY_META in organize-docs.mjs - kept inline so this
// script has no external deps and can be run anywhere.
const CATEGORY_LABELS = {
  'getting-started':        'Getting Started',
  'account-settings':       'Account & Profile',
  'account-billing':        'Billing & Subscription',
  'security-and-mfa':       'Security & MFA',
  'projects-and-admins':    'Projects & Admins',
  'groups-and-permissions': 'Groups & Permissions',
  'uploads-and-files':      'Uploads & Files',
  'sharing-and-links':      'Sharing & Links',
  'watermarks':             'Watermarks',
  'annotations':            'Annotations',
  'viewing-and-playback':   'Viewing & Playback',
  'analytics-and-tracking': 'Analytics & Tracking',
  'mobile-and-apps':        'Mobile & Apps',
  'enterprise':             'Enterprise',
  'troubleshooting':        'Troubleshooting',
};

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue; // _category_.json etc.
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, files);
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) files.push(p);
  }
  return files;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: raw.slice(m[0].length) };
}

// Strip MDX-only constructs (imports, JSX wrappers) so the corpus reads
// like plain markdown. Keep inner text and structural tags' children.
function cleanMdx(body) {
  return body
    .replace(/^\s*import\s+.+?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+.+$/gm, '')
    .replace(/<[A-Z]\w*[^>]*\/>/g, '')
    .replace(/<\/?[A-Z]\w*[^>]*>/g, '')
    .replace(/<\/?(?:div|span|h\d|p|ul|ol|li)\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

function categoryFromPath(filePath) {
  const rel = relative(docsRoot, filePath);
  const seg = rel.split(/[\\/]/)[0];
  if (seg.endsWith('.md') || seg.endsWith('.mdx')) return null;
  return seg;
}

function fallbackSlug(filePath, cat) {
  const name = basename(filePath).replace(/\.mdx?$/, '');
  return cat ? `/${cat}/${name}` : `/${name}`;
}

const files = walk(docsRoot).sort();
const articles = [];
const skipped = [];

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  if (!meta.title) {
    skipped.push({ file: f, reason: 'no title in frontmatter' });
    continue;
  }
  const cat = categoryFromPath(f);
  const slug = meta.slug || fallbackSlug(f, cat);
  articles.push({
    title: meta.title,
    url: SITE_BASE + slug,
    category: cat ? (CATEGORY_LABELS[cat] || cat) : 'Overview',
    body: cleanMdx(body).trim(),
  });
}

// Group by category, alpha within. Stable order = stable cache key.
articles.sort((a, b) => {
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  return a.title.localeCompare(b.title);
});

const header = [
  '# Embershot Help Documentation',
  '# Source: https://docs.embershot.com (built from github.com/ekhayes/embershot-docs)',
  `# Articles: ${articles.length}`,
  `# Generated: ${new Date().toISOString()}`,
  '',
  '# Each article is delimited by an "ARTICLE" banner with title, URL, and',
  '# category. When citing, link to the URL so users can read the full doc.',
  '',
].join('\n');

const sections = articles.map(a => [
  SEPARATOR,
  `ARTICLE: ${a.title}`,
  `URL: ${a.url}`,
  `CATEGORY: ${a.category}`,
  SEPARATOR,
  '',
  a.body,
  '',
].join('\n')).join('\n');

mkdirSync(outDir, { recursive: true });
const output = header + sections;
writeFileSync(outPath, output, 'utf8');

const totalChars = output.length;
const estTokens = Math.round(totalChars / 4);

console.log(`Wrote ${articles.length} articles to ${relative(repoRoot, outPath)}`);
console.log(`  Size: ${(totalChars / 1024).toFixed(1)} KB (~${(estTokens / 1000).toFixed(1)}k tokens)`);
if (skipped.length) {
  console.log(`  Skipped: ${skipped.length}`);
  skipped.forEach(s => console.log(`    - ${relative(repoRoot, s.file)}: ${s.reason}`));
}
