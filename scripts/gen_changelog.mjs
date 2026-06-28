import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outPath = resolve(root, 'changelog.json');

let raw;
try {
  raw = execSync('git log -3 --format="%h||%ad||%s" --date=format:"%Y-%m-%d %H:%M"', {
    cwd: root,
    encoding: 'utf-8'
  }).trim();
} catch (e) {
  console.error('Failed to run git log. Is git installed and are you in a git repository?');
  console.error(e.message);
  process.exit(1);
}

const commits = raw.split('\n').filter(Boolean).map(line => {
  const i = line.indexOf('||');
  const j = line.indexOf('||', i + 2);
  const hash = line.slice(0, i);
  const date = line.slice(i + 2, j);
  const message = line.slice(j + 2);
  return { hash, date, message };
});

const changelog = {
  updated: new Date().toISOString(),
  commits
};

writeFileSync(outPath, JSON.stringify(changelog, null, 3), 'utf-8');
console.log(`Wrote ${commits.length} commits to ${outPath}`);
