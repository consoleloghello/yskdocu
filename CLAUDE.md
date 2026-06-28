# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

化工企业公用工程岗位的移动端刷题 SPA（单页应用）。支持外操版和内操版两套题库，涵盖 9 大专业系统（火炬、给水加压泵站、罐区、锅炉、空压站、污水预处理、循环水站、制冷站、制氮站）。

**在线地址**：https://consoleloghello.github.io/yskdocu/

**后端功能（开发中）**：Supabase 提供错题云同步、答题统计、题目纠错反馈、题目笔记等登录用户功能。方案详见 `docs/后端功能方案设计.md`。

## 命令

```bash
# 本地开发服务器（推荐 — 正确解析中文文件名）
node serve.mjs                    # → http://127.0.0.1:8081

# 备选：Python HTTP 服务器
python -m http.server 8899

# 重新解析 docx 题库文件输出 JSON
python scripts/parse_docx.py      # 读取根目录下的 .docx，写入 data/*.json

# Supabase 数据库初始化
# 在 Supabase Dashboard → SQL Editor 中执行 scripts/init_supabase.sql
```

无构建步骤、无测试套件、无代码检查工具。

## 架构

### 数据管道

```
.docx 源文件 → scripts/parse_docx.py → data/外操版.json + data/内操版.json → 浏览器 fetch() → 渲染为题目卡片
```

### 前端架构（匿名模式）

`index.html` + `css/style.css` + `js/app.js`。`app.js` 是一个 IIFE，包含四个逻辑层：

| 层 | 职责 |
|---|---|
| DataLoader | `fetch()` 加载 JSON，`buildFlat()` 将嵌套结构展平为 `flatQs[]`，合成 `_id`/`_chapter`/`_type` |
| StateManager | `state` 全局对象，持久化到 localStorage（`ysk_state`, `ysk_revealed`, `ysk_wrong_${version}`） |
| Renderer | `render()` 编排 `renderChapters()` / `renderTypeFilters()` / `renderCards(qs)`，每次状态变化全量重渲染 |
| Event Handlers | 搜索、chip 点击、题型筛选、答案展示、版本切换、入口遮罩、统计弹窗 |

### 前端架构（登录模式，开发中）

登录后在前端直接操作 Supabase 数据库（通过 supabase-js SDK），不经过中间后端服务：

| 新文件 | 职责 |
|------|------|
| `js/supabase.js` | 初始化 supabase 客户端、登录/登出 UI、session 管理 |
| `js/sync.js` | 云端 CRUD 封装：错题增删、统计上报、笔记读写、报错提交 |

登录后数据同时写入 localStorage（缓存）和 Supabase（主存储），离线不阻塞。

### 本地状态 (localStorage)

| Key | 内容 |
|---|---|
| `ysk_state` | `{ version, chapter, type, searchQuery, mode, wrongBook, stats }` |
| `ysk_revealed` | 已显示答案的题目 ID 数组 |
| `ysk_wrong_外操版` | 外操版错题本 `{ id: true }` |
| `ysk_wrong_内操版` | 内操版错题本 `{ id: true }` |

### 展平后的题目模型 (flatQs)

```javascript
{
  _id: "火炬_选择题_0",     // 合成 ID：章节_题型_序号
  _chapter: "火炬",
  _type: "选择题",
  question: "...",
  options: ["A. ...", ...],  // 仅选择题
  answer: "B" | "√" | "×" | text
}
```

### 版本切换

键是 `app.js` 中的 `resetViewState()` 辅助函数。

## docx 解析器 (`scripts/parse_docx.py`)

- 使用 `python-docx` 提取段落纯文本（忽略样式 — 所有 docx 内容均为 Normal 样式）
- 章节检测：根据 `KNOWN_CHAPTERS` 硬编码列表精确匹配。如果源 docx 新增章节，需要更新此列表
- 题型检测：正则匹配 `一、…` 到 `五、…` 前缀
- 答案提取：正则匹配 `（A）` / `（√）` / `（×）`
- 简答题合并：启发式函数 `looks_like_new_question()` 判断是否为新题目，可能出错
- 输出格式：`{ info: { title, version, total }, chapters: [{ name, type_groups: [{ type, questions: [{ question, options?, answer }] }] }] }`

## 关键约束

- **生产环境零依赖**：SPA 由 1 个 HTML + 1 个 CSS + 1 个 JS + 2 个 JSON 组成（后端功能引入后增加 supabase-js CDN 和 Chart.js CDN）
- **移动端优先**：响应式 CSS 适配到 320px。粘性顶部栏、横向滚动 chip 导航、适合触控的点击区域
- **无离线/PWA 支持**：Service Worker 未实现（列为 P3 技术债）
- **中文文件名**：JSON 文件名为中文。`serve.mjs` 包含 `decodeURIComponent` 处理；Python 的 `http.server` 可能无法正确处理
- **localStorage 是匿名用户唯一持久化方式**：清除 localStorage 会丢失所有数据

## 已知问题

- **P1**：内操版给水加压泵站扩展题解析后显示异常（同名题型分组合并问题）
- **P1**：搜索无高亮显示
- **P1**：约 15 道选择题选项解析失败（docx 格式非标准）
- **P2**：无夜间模式、无收藏功能、无答题历史
- **P3**：无虚拟滚动（全量渲染 372 题可能较慢）
- **P3**：无 Service Worker / PWA 离线支持
