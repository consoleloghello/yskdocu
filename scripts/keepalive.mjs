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
 * 传输层说明（踩过坑）：
 *   Node 18+ 的全局 fetch（undici）**不读取 http_proxy / https_proxy /
 *   ALL_PROXY 环境变量** —— 挂了代理的机器上 fetch 必然 fetch failed，
 *   而 curl 会正常走代理。所以有代理时优先用 curl，没有代理时用 fetch
 *   并在网络失败时回退 curl；两者都没有才报错。
 *
 * 退出码：0 = 保活成功；1 = 失败（cron 会据此发邮件告警）
 */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 环境探测                                                            */
/* ------------------------------------------------------------------ */

/** 返回代理 URL（大小写都查），没有则空串。 */
function proxyFromEnv(env = process.env) {
  const keys = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ];
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** curl 是否可用以及版本（用于决定传输方式）。 */
function curlVersion() {
  const r = spawnSync('curl', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (r.error || r.status !== 0) return '';
  return (r.stdout || '').split('\n')[0].trim();
}

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
/* 两种传输方式，统一返回 { status, body, transport }                  */
/* ------------------------------------------------------------------ */

/**
 * 用 curl 发请求。curl 会自动读取 http_proxy / https_proxy / ALL_PROXY，
 * 这是挂在代理后面的机器上唯一可靠的方式。
 */
function callViaCurl({ endpoint, key, source }) {
  const args = [
    '-sS',
    '--max-time',
    '30',
    '--retry',
    '3',
    '--retry-delay',
    '5',
    '--retry-all-errors',
    '-o',
    '-',
    '-w',
    '\n%{http_code}',
    '-X',
    'POST',
    '-H',
    `apikey: ${key}`,
    '-H',
    `Authorization: Bearer ${key}`,
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ p_source: source }),
    endpoint,
  ];

  const r = spawnSync('curl', args, { encoding: 'utf8', timeout: 120_000 });

  if (r.error) throw new Error(`curl 调用失败：${r.error.message}`);
  if (r.status !== 0 && !r.stdout) {
    throw new Error(`curl 退出码 ${r.status}：${(r.stderr || '').trim() || '无 stderr'}`);
  }

  // stdout 形如 "<body>\n<http_code>"
  const out = r.stdout || '';
  const idx = out.lastIndexOf('\n');
  const body = idx >= 0 ? out.slice(0, idx) : '';
  const status = Number((idx >= 0 ? out.slice(idx + 1) : out).trim()) || 0;
  return { status, body, transport: 'curl' };
}

/** 用 Node 内置 fetch 发请求（不走代理）。 */
async function callViaFetch({ endpoint, key, source }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_source: source }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.text(), transport: 'fetch' };
}

/**
 * 选择传输方式并执行。
 *
 * - 有代理 → 只能用 curl（fetch 不认代理环境变量）
 * - 无代理 → 先用 fetch，网络层失败再回退 curl
 *
 * 依赖通过参数注入，便于单测（不需要真发请求）。
 */
async function ping({
  endpoint,
  key,
  source,
  log = () => {},
  env = process.env,
  curlAvailable = null, // null = 自动探测
  fetchImpl = callViaFetch,
  curlImpl = callViaCurl,
} = {}) {
  const proxy = proxyFromEnv(env);
  const hasCurl = curlAvailable === null ? Boolean(curlVersion()) : curlAvailable;

  if (proxy) {
    log(`检测到代理 ${proxy.replace(/\/\/.*@/, '//***@')} → 使用 curl（Node fetch 不走代理）`);
    if (!hasCurl) {
      throw new Error(
        `检测到代理但找不到 curl。Node 的 fetch 不读取 *_PROXY 环境变量，无法走代理。\n` +
          `   → 安装 curl，或用 curl 手动执行本脚本要发的请求。`
      );
    }
    return curlImpl({ endpoint, key, source });
  }

  try {
    return await fetchImpl({ endpoint, key, source });
  } catch (err) {
    if (!hasCurl) throw err;
    log(`fetch 失败（${err.message}），回退 curl 重试`);
    return curlImpl({ endpoint, key, source });
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('用法: node scripts/keepalive.mjs [--quiet] [--url <URL>] [--key <ANON_KEY>]');
    return 0;
  }

  const fromSource = await loadConfigFromSource();
  const url = args.url || process.env.SUPABASE_URL || fromSource.url;
  const key = args.key || process.env.SUPABASE_ANON_KEY || fromSource.key;
  const source = process.env.KEEPALIVE_SOURCE || 'local-cron';

  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/keepalive_ping`;
  const log = (...m) => {
    if (!args.quiet) console.log(...m);
  };

  log(`[${new Date().toISOString()}] Supabase keepalive → ${url}`);

  let result;
  try {
    result = await ping({ endpoint, key, source, log });
  } catch (err) {
    // 网络层失败：与「项目被暂停」是两回事，别给错误暗示
    console.error(`❌ 请求未能发出：${err.message}`);
    console.error(
      '   → 这是本机网络/代理问题，不代表项目异常。' +
        '确认能访问 Supabase；若走代理请确认 curl 可用。'
    );
    return 1;
  }

  const { status, body, transport } = result;
  log(`[${transport}] HTTP ${status}  ${body}`);

  if (status === 404) {
    console.error('❌ public.keepalive_ping() 不存在。');
    console.error('   → 请在 Supabase Dashboard → SQL Editor 执行 scripts/keepalive.sql（一次性）。');
    return 1;
  }
  if (status === 0) {
    console.error('❌ 连接失败（拿不到 HTTP 状态码）。');
    console.error('   → 检查网络/代理；若网络正常，项目可能已被暂停，需到 Supabase Dashboard Resume。');
    return 1;
  }
  if (status < 200 || status >= 300) {
    console.error(`❌ 保活失败（HTTP ${status}）`);
    if (status === 401 || status === 403) {
      console.error('   → anon key 被拒绝，可能已轮换；需同步 js/supabase.js。');
    } else if (status >= 500) {
      console.error('   → 服务端错误，项目可能已被暂停，去 Supabase Dashboard Resume。');
    }
    return 1;
  }

  let payload = null;
  try {
    payload = JSON.parse(body);
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

// 仅在直接执行时跑主流程，便于测试导入纯函数
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}

export { proxyFromEnv, curlVersion, ping, callViaCurl, callViaFetch, parseArgs };
