/**
 * gen_changelog.mjs
 *
 * 读取最近 3 条 git commit 记录，生成 data/changelog.json 供前端展示更新公告。
 *
 * 用法：node scripts/gen_changelog.mjs
 * 输出：data/changelog.json
 *
 * 由 GitHub Actions 在 push 后自动运行，无需手动执行。
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outPath = resolve(root, 'data', 'changelog.json');

// 执行 git log，用 || 作为字段分隔符（hash、日期、提交信息）
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

// 逐行解析，使用 indexOf 而非 split 以兼容 commit message 中包含 || 的情况
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
