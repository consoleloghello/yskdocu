#!/usr/bin/env node
/**
 * scripts/keepalive.mjs 的单元测试（零依赖，直接用 node 跑）
 *
 *   node tests/keepalive_script_test.mjs
 *
 * 背景（踩过的坑）：
 *   Node 18+ 的全局 fetch（undici）不读取 http_proxy / https_proxy / ALL_PROXY
 *   环境变量。本机开着 clash 时，脚本一直 "fetch failed"，而 curl 却正常。
 *   所以有代理时必须走 curl。这里把这条规则钉死。
 */

import assert from 'node:assert/strict';
import { proxyFromEnv, ping } from '../scripts/keepalive.mjs';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------------ */
/* proxyFromEnv                                                       */
/* ------------------------------------------------------------------ */

test('proxyFromEnv: 无代理时返回空串', () => {
  assert.equal(proxyFromEnv({}), '');
  assert.equal(proxyFromEnv({ PATH: '/bin' }), '');
});

test('proxyFromEnv: 空值/空白不算代理', () => {
  assert.equal(proxyFromEnv({ https_proxy: '' }), '');
  assert.equal(proxyFromEnv({ https_proxy: '   ' }), '');
});

test('proxyFromEnv: 识别大小写各种代理变量', () => {
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    assert.equal(proxyFromEnv({ [k]: 'http://127.0.0.1:7890' }), 'http://127.0.0.1:7890', k);
  }
});

test('proxyFromEnv: 优先级 HTTPS_PROXY > ... > all_proxy', () => {
  const env = {
    HTTPS_PROXY: 'http://a',
    http_proxy: 'http://b',
    ALL_PROXY: 'socks5://c',
  };
  assert.equal(proxyFromEnv(env), 'http://a');
  assert.equal(proxyFromEnv({ ALL_PROXY: 'socks5://c', http_proxy: 'http://b' }), 'http://b');
});

test('proxyFromEnv: 去除首尾空白', () => {
  assert.equal(proxyFromEnv({ https_proxy: '  http://p:1  ' }), 'http://p:1');
});

/* ------------------------------------------------------------------ */
/* ping：传输方式选择                                                  */
/* ------------------------------------------------------------------ */

const OK = { status: 200, body: '{"ok": true}', transport: 'stub' };

test('ping: 有代理 → 走 curl，不碰 fetch', async () => {
  let fetched = false;
  const res = await ping({
    endpoint: 'http://x',
    key: 'k',
    source: 's',
    env: { https_proxy: 'http://127.0.0.1:7890' },
    curlAvailable: true,
    fetchImpl: async () => {
      fetched = true;
      return OK;
    },
    curlImpl: async () => OK,
  });
  assert.equal(res, OK);
  assert.equal(fetched, false, '有代理时不应调用 fetch（它不走代理）');
});

test('ping: 无代理 → 走 fetch', async () => {
  let usedCurl = false;
  const res = await ping({
    endpoint: 'http://x',
    key: 'k',
    source: 's',
    env: {},
    curlAvailable: true,
    fetchImpl: async () => OK,
    curlImpl: async () => {
      usedCurl = true;
      return OK;
    },
  });
  assert.equal(res, OK);
  assert.equal(usedCurl, false);
});

test('ping: 无代理但 fetch 网络失败 → 回退 curl', async () => {
  const logs = [];
  const res = await ping({
    endpoint: 'http://x',
    key: 'k',
    source: 's',
    env: {},
    curlAvailable: true,
    log: (...m) => logs.push(m.join(' ')),
    fetchImpl: async () => {
      throw new Error('fetch failed');
    },
    curlImpl: async () => OK,
  });
  assert.equal(res, OK);
  assert.ok(
    logs.some((l) => l.includes('回退 curl')),
    `应记录回退日志，实际：${JSON.stringify(logs)}`
  );
});

test('ping: 无代理、fetch 失败且没有 curl → 抛出原错误', async () => {
  await assert.rejects(
    ping({
      endpoint: 'http://x',
      key: 'k',
      source: 's',
      env: {},
      curlAvailable: false,
      fetchImpl: async () => {
        throw new Error('fetch failed');
      },
    }),
    /fetch failed/
  );
});

test('ping: 有代理但没有 curl → 报错并说清原因', async () => {
  await assert.rejects(
    ping({
      endpoint: 'http://x',
      key: 'k',
      source: 's',
      env: { https_proxy: 'http://127.0.0.1:7890' },
      curlAvailable: false,
    }),
    (err) => {
      assert.match(err.message, /curl/);
      assert.match(err.message, /_PROXY|代理/);
      return true;
    }
  );
});

test('ping: 代理日志不泄露凭据', async () => {
  const logs = [];
  await ping({
    endpoint: 'http://x',
    key: 'k',
    source: 's',
    env: { https_proxy: 'http://user:secret@proxy:7890' },
    curlAvailable: true,
    log: (...m) => logs.push(m.join(' ')),
    curlImpl: async () => OK,
  });
  assert.ok(
    !logs.join(' ').includes('secret'),
    `代理日志泄露了凭据：${JSON.stringify(logs)}`
  );
});

test('ping: 把 endpoint/key/source 原样透传给传输层', async () => {
  let seen = null;
  await ping({
    endpoint: 'https://p.supabase.co/rest/v1/rpc/keepalive_ping',
    key: 'anon-key',
    source: 'my-cron',
    env: {},
    curlAvailable: true,
    fetchImpl: async (a) => {
      seen = a;
      return OK;
    },
  });
  assert.deepEqual(seen, {
    endpoint: 'https://p.supabase.co/rest/v1/rpc/keepalive_ping',
    key: 'anon-key',
    source: 'my-cron',
  });
});

/* ------------------------------------------------------------------ */
/* 运行                                                               */
/* ------------------------------------------------------------------ */

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

console.log(`\nkeepalive.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
