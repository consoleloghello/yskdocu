# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

**本仓库的完整、权威指南见 [`AGENTS.md`](./AGENTS.md)**，以下内容与之一致，请以 AGENTS.md 为准。

## 一句话概述

化工企业公用工程岗位的移动端刷题 SPA（外操版 + 内操版，9 大专业系统）。前端为**零构建** vanilla JS 模块化 SPA，登录用户通过 Supabase（前端直连 + RLS）做错题云同步、答题统计、笔记、纠错反馈。

## 快速命令

```bash
node scripts/serve.mjs          # 本地开发服务器 → http://127.0.0.1:8081
npm test                        # pytest 解析器测试
node smoke_test.mjs             # 前端冒烟测试（JSDOM）
npm run lint / npm run format   # ESLint / Prettier（js/ 目录）
python scripts/parse_docx.py    # 重新解析 .docx → data/*.json
npm run compress                # gzip 压缩 data/*.json → *.json.gz
```

## 架构要点（详见 AGENTS.md）

- `js/state.js` — `window.State`：状态存储（pub/sub）+ localStorage 持久化 + 工具函数
- `js/filter.js` — `window.Filter`：题目筛选纯函数（`searchIn`/`countByType`/`getCurrentQuestions`）
- `js/renderer.js` — `window.Render`：DOM 渲染 + 统计图表
- `js/data.js` — `window.Data`：`loadData`/`buildFlat`（稳定 `_id` + 旧 ID 迁移）/`pullCloudData`
- `js/app.js` — 入口：事件绑定、弹窗、版本切换、订阅渲染
- `js/supabase.js` / `js/sync.js` / `js/decompress.js` — 认证 / 云端 CRUD（统计走 RPC）/ gzip 解压

脚本加载顺序见 `index.html`：supabase/sync 必须先于 `app.js`（否则登录态监听会失效）。

## 关键约束

- 零构建、移动端优先、中文文件名、localStorage 是匿名用户唯一持久化。
- CDN 依赖：supabase-js、Chart.js；p5.js 背景动画按需加载（移动端 / reduced-motion 不下载，入口遮罩无需等动画）。
