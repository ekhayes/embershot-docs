#!/usr/bin/env node
/**
 * Weekly scan: look at recent commits in the Embershot codebases,
 * cross-reference with current docs, and propose additions/edits.
 *
 * Repos scanned: filetrack-api, filetrack-console, filetrack-viewer.
 * Outputs:
 *   - markdown drafts under proposed/ (new or updated articles)
 *   - .last-scan-report.md (PR body summarizing what changed and why)
 *
 * Required env vars:
 *   GH_TOKEN          - GitHub token with read access to the source repos
 *   ANTHROPIC_API_KEY - for the LLM pass that drafts updates
 *   SINCE             - lookback window (e.g. 7d, 14d). Default 7d.
 *
 * The repos to scan are listed in scan-config.json next to this script.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const docsRoot = join(repoRoot, 'docs');
const proposedRoot = join(repoRoot, 'proposed');
const reportPath = join(__dirname, '.last-scan-report.md');

const since = process.env.SINCE || '7d';
const config = JSON.parse(readFileSync(join(__dirname, 'scan-config.json'), 'utf8'));

mkdirSync(proposedRoot, { recursive: true });

function gitLogForRepo(repoUrl, sinceWindow) {
  // Shallow clone or fetch into /tmp, then git log
  const slug = repoUrl.replace(/[^a-z0-9]/gi, '-');
  const tmp = `/tmp/scan-${slug}`;
  try {
    execSync(`rm -rf ${tmp}`);
    execSync(`git clone --filter=blob:none --no-checkout ${repoUrl} ${tmp}`, { stdio: 'pipe' });
    const log = execSync(
      `cd ${tmp} && git log --since="${sinceWindow} ago" --pretty=format:"%H%x00%s%x00%an%x00%ad" --date=short`,
      { encoding: 'utf8' }
    );
    return log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, date] = line.split('\0');
        return { hash, subject, author, date, repo: repoUrl };
      });
  } catch (err) {
    console.error(`Failed to scan ${repoUrl}:`, err.message);
    return [];
  }
}

function loadExistingDocs() {
  const docs = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
        docs.push({ path: full, content: readFileSync(full, 'utf8') });
      }
    }
  }
  walk(docsRoot);
  return docs;
}

async function proposeUpdates(commits, existingDocs) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const commitSummary = commits
    .map((c) => `- [${c.repo.split('/').pop()}] ${c.date} ${c.subject} (${c.author})`)
    .join('\n');

  const docTitles = existingDocs
    .map((d) => {
      const m = d.content.match(/^title:\s*["']?(.+?)["']?$/m);
      return m ? `- ${m[1]} (${d.path.replace(repoRoot + '/', '')})` : null;
    })
    .filter(Boolean)
    .join('\n');

  const prompt = `You are reviewing recent commits to the Embershot codebases to identify documentation gaps or needed updates on the customer-facing help site (docs.embershot.com).

## Recent commits (last ${since}):
${commitSummary || '(none)'}

## Existing docs:
${docTitles || '(none yet)'}

## Your task
Identify commits that introduce or change USER-VISIBLE behavior - features, settings, UI flows, errors users see, billing changes, security/auth changes, mobile/TV app changes. IGNORE pure refactors, internal infrastructure, dev tooling, build changes, dependency bumps, and bugfixes that don't change user behavior.

For each user-visible change:
1. State which existing doc(s) it affects, OR propose a new doc title and category.
2. Describe what should be added or updated in 2-3 sentences.
3. Rate confidence: high / medium / low.

Output a markdown report with sections: "## Proposed new articles", "## Proposed updates to existing articles", "## Commits reviewed but skipped (and why)". Be terse. If nothing user-visible changed, say so explicitly.`;

  const msg = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text : '';
}

async function main() {
  console.log(`Scanning since ${since}...`);
  const allCommits = [];
  for (const repo of config.repos) {
    console.log(`  ${repo}`);
    allCommits.push(...gitLogForRepo(repo, since));
  }
  console.log(`Found ${allCommits.length} commits across ${config.repos.length} repos.`);

  if (allCommits.length === 0) {
    writeFileSync(reportPath, `# Weekly docs scan\n\nNo commits in the last ${since}. Nothing to propose.\n`);
    return;
  }

  const existingDocs = loadExistingDocs();
  const report = await proposeUpdates(allCommits, existingDocs);

  const fullReport = `# Weekly docs scan

**Window:** last ${since}
**Commits reviewed:** ${allCommits.length}
**Existing docs:** ${existingDocs.length}

${report}

---

_Generated by \`scripts/scan-and-propose.mjs\`. Review the proposals above and edit/commit the markdown files in this PR before merging._
`;

  writeFileSync(reportPath, fullReport);
  console.log(`Report written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
