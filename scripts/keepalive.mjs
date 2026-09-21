#!/usr/bin/env node
/**
 * Supabase 保活脚本（本地 / 服务器 cron 用）
 *
 * 目的：避免 Supabase 免费项目因「一周无数据库活动」被自动暂停。
 * 与 .github/workflows/keepalive.yml 走同一条链路 —— 调用 RPC
 * public.keepalive_ping()，在数据库里产生一次真实的 UPDATE 写入。
 * 只读 SELECT 已被证实不足以阻止暂停。
 *
 * 前置条件（一次性）：
 *   在 Supabase Dashboard → SQL Editor 执行 scripts/keepalive.sql
 *
 * 用法：
 *   node scripts/keepalive.mjs                 # 手动跑一次
 *   node scripts/keepalive.mjs --quiet         # cron 用，成功时不输出
 *   node scripts/keepalive.mjs --url ... --key ...
 *   环境变量 SUPABASE_URL / SUPABASE_ANON_KEY 优先级高于 js/supabase.js
 *
 * 退出码：0 = 保活成功；1 = 失败（cron 会据此发邮件告警）
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 读取配置：默认从 js/supabase.js 里解析，避免多处维护                */
/* ------------------------------------------------------------------ */
async function loadConfigFromSource() {
  const src = await readFile(join(ROOT, 'js', 'supabase.js'), 'utf8');

  const url = src.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
  const key = src.match(/SUPABASE_ANON_KEY\s*=\s*\n?\s*['"]([^'"]+)['"]/);

  if (!url || !key) {
    throw new Error('无法从 js/supabase.js 解析出 SUPABASE_URL / SUPABASE_ANON_KEY');
  }
  return { url: url[1], key: key[1] };
}

function parseArgs(argv) {
  const out = { quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`用法: node scripts/keepalive.mjs [--quiet] [--url <URL>] [--key <ANON_KEY>]`);
    return 0;
  }

  const fromSource = await loadConfigFromSource();
  const url = args.url || process.env.SUPABASE_URL || fromSource.url;
  const key = args.key || process.env.SUPABASE_ANON_KEY || fromSource.key;
  const source = process.env.KEEPALIVE_SOURCE || 'local-cron';

  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/keepalive_ping`;
  const ts = new Date().toISOString();
  const log = (...m) => {
    if (!args.quiet) console.log(...m);
  };

  log(`[${ts}] Supabase keepalive → ${url}`);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_source: source }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error(`❌ 请求失败：${err.message}`);
    console.error('   → 检查网络；若持续失败，项目可能已被暂停，需到 Supabase Dashboard 手动 Resume。');
    return 1;
  }

  const text = await res.text();
  log(`HTTP ${res.status}  ${text}`);

  if (res.status === 404) {
    console.error('❌ public.keepalive_ping() 不存在。');
    console.error('   → 请在 Supabase Dashboard → SQL Editor 执行 scripts/keepalive.sql（一次性）。');
    return 1;
  }
  if (!res.ok) {
    console.error(`❌ 保活失败（HTTP ${res.status}）`);
    return 1;
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* RPC 正常返回 jsonb，解析失败说明返回体异常 */
  }

  if (!payload || payload.ok !== true) {
    console.error('❌ 返回体异常，未确认写入成功。');
    return 1;
  }

  log(
    `✅ 保活成功（${payload.throttled ? '节流中' : '已写入'}）` +
      ` last_ping=${payload.last_ping} 累计=${payload.ping_count}`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
