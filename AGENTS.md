# AGENTS.md

此文件为 Codex (Codex.ai/code) 在此仓库中工作时提供指导。

## 项目概述

化工企业公用工程岗位的移动端刷题 SPA（单页应用）。支持外操版和内操版两套题库，涵盖 9 大专业系统（火炬、给水加压泵站、罐区、锅炉、空压站、污水预处理、循环水站、制冷站、制氮站）。

**在线地址**：https://consoleloghello.github.io/yskdocu/

**后端功能（已实现）**：Supabase 提供错题云同步、答题统计（含 Chart.js 饼图）、题目纠错反馈、题目笔记等登录用户功能。方案详见 `docs/后端功能方案设计.md`。

## 命令

```bash
# 本地开发服务器（推荐 — 正确解析中文文件名）
node scripts/serve.mjs            # → http://127.0.0.1:8081

# 备选：Python HTTP 服务器
python -m http.server 8899

# 代码检查（需先 npm install）
npm run lint                          # ESLint 检查（针对 js/ 目录）
npm run lint:fix                      # ESLint 自动修复
npm run format                        # Prettier 格式化（js/ 目录）

# 测试（解析器单元测试 + 前端冒烟测试）
npm test                              # pytest 运行 tests/ 目录全部测试
npm run test:coverage                 # 测试 + 覆盖率报告
node smoke_test.mjs                   # 前端冒烟测试（JSDOM：转义/弹窗/渲染）

# 压缩 JSON 数据文件（解析 docx 后或部署前运行）
npm run compress                      # gzip 压缩 data/*.json → *.json.gz

# 重新解析 docx 题库文件输出 JSON
python scripts/parse_docx.py      # 读取根目录下的 .docx，写入 data/*.json

# Supabase 数据库初始化 / 清理
# 在 Supabase Dashboard → SQL Editor 中执行 scripts/init_supabase.sql
# 如需重置数据，执行 scripts/clear_tables.sql

# 生成更新日志文件（部署前运行）
node scripts/gen_changelog.mjs     # 读取最近3条 git commit，输出 data/changelog.json
```

无构建步骤。

## 项目文件结构

```
├── index.html                 # HTML 骨架（含全部弹窗模板）
├── css/style.css              # 全部样式（含 7 类弹窗、入口遮罩、answer/report/note）
├── js/
│   ├── state.js               # window.State — 状态存储（pub/sub）、localStorage 持久化、工具函数
│   ├── filter.js              # window.Filter — 题目筛选纯函数（searchIn/countByType/getCurrentQuestions）
│   ├── renderer.js            # window.Render — DOM 渲染、统计图表
│   ├── data.js                # window.Data — 加载数据/buildFlat（稳定 _id + 迁移）/拉云端
│   ├── app.js                 # 入口：事件绑定、弹窗逻辑、版本切换、订阅渲染
│   ├── supabase.js            # window.SupabaseAuth — Supabase 认证（登录/注册/登出）
│   ├── sync.js                # window.Sync — 云端 CRUD（错题、笔记、统计 RPC、报错）
│   ├── decompress.js          # window.Decompress — 浏览器端 gzip 解压工具（DecompressionStream）
│   ├── background-motion.js   # window.BgMotion — 背景动画开关/暂停守卫
│   ├── background-loader.js   # 按需加载器：仅 desktop 且非 reduced-motion 时注入 p5.js 与动画
│   ├── background-synthetic-flux.js   # 入口遮罩背景动画（p5.js，动态加载）
│   └── background-quantum-foam.js     # 主页面背景动画（p5.js，动态加载）
├── data/
│   ├── 外操版.json             # 外操作题库 JSON
│   ├── 内操版.json             # 内操作题库 JSON
│   └── changelog.json         # 更新日志（由 gen_changelog.mjs 生成）
├── data/
│   ├── 外操版.json.gz           # gzip 压缩版（约 33 KB，由 compress_data.mjs 生成）
│   ├── 内操版.json.gz           # gzip 压缩版（约 32 KB，由 compress_data.mjs 生成）
├── scripts/
│   ├── parse_docx.py          # docx → JSON 解析器（python-docx）
│   ├── compress_data.mjs      # gzip 压缩 data/*.json → *.json.gz（npm run compress）
│   ├── serve.mjs              # Node.js 开发服务器
│   ├── gen_changelog.mjs      # 生成更新日志脚本
│   ├── init_supabase.sql      # Supabase 数据库初始化 SQL
│   └── clear_tables.sql       # 清空所有表的数据
├── tests/
│   ├── conftest.py            # pytest 夹具（MockParagraph, MockRun）
│   └── test_parse_docx.py     # 解析器单元测试 + 端到端集成测试
├── docs/
│   ├── 后端功能方案设计.md      # 后端功能完整方案设计
│   ├── 方案设计.md             # 项目总体方案设计
│   ├── 测试覆盖实施报告.md      # 测试覆盖实施报告
│   └── 需求理解.md             # 需求理解文档
├── package.json               # ESLint、Prettier、pytest 脚本
├── pytest.ini                 # pytest 配置（含 coverage 参数）
├── .eslintrc.json             # ESLint 配置
├── .eslintignore              # ESLint 忽略规则
├── .prettierrc                # Prettier 配置
├── 公用工程题库（外操版）.docx   # 源文件
├── 公用工程题库（内操版）.docx   # 源文件
└── AGENTS.md / CLAUDE.md     # AI 助手指南
```

## 架构

### 数据管道

```
.docx 源文件 → scripts/parse_docx.py → data/外操版.json + data/内操版.json → 浏览器 fetch() → 渲染为题目卡片
```

### 前端架构（匿名模式）

`index.html`（弹窗模板）+ `css/style.css` + 核心 JS 模块，按依赖顺序加载：

| 文件 | 职责 |
|---|---|
| `js/state.js` (`window.State`) | 状态存储（pub/sub：`set/setMulti` 自动持久化并通知渲染）、HTML 转义/搜索高亮/防抖工具 |
| `js/filter.js` (`window.Filter`) | 题目筛选纯函数：`searchIn` / `countByType` / `getCurrentQuestions`（无 DOM 副作用） |
| `js/renderer.js` (`window.Render`) | `render()` 编排章节导航、题型筛选、卡片渲染、统计图表（Chart.js 饼图），筛选逻辑调用 `Filter` |
| `js/data.js` (`window.Data`) | `loadData` / `buildFlat`（稳定 `_id` + 旧 ID 迁移）/ `pullCloudData` |
| `js/app.js` | 入口：事件委托（答案/笔记/报错/选项）、版本切换、入口遮罩、搜索、弹窗逻辑、订阅渲染 |

> **脚本加载策略**：全部 `defer`（并行下载、不阻塞渲染）；`app.js` 在 p5/Chart 之前执行，入口遮罩无需等动画；p5.js 由 `background-loader.js` 按需注入（移动端 / reduced-motion 不下载）。

### 前端架构（登录模式，已实现）

登录后在前端直接操作 Supabase 数据库（通过 supabase-js SDK），不经过中间后端服务：

| 文件 | 职责 |
|---|---|
| `js/supabase.js` (`window.SupabaseAuth`) | 初始化 supabase 客户端、邮箱密码登录/注册、OTP 邮箱验证、登出、session 管理、UI 更新 |
| `js/sync.js` (`window.Sync`) | 云端 CRUD 封装：错题增删（upsert）、统计（调用 RPC `get_answer_stats`）、笔记读写、报错提交 |
| `js/decompress.js` (`window.Decompress`) | 浏览器端 gzip 解压：利用原生 DecompressionStream 解压 `.json.gz` 文件，自动降级到 `.json` |

登录后数据同时写入 localStorage（缓存）和 Supabase（主存储），离线不阻塞。
登录时自动从云端拉取错题和笔记合并到本地。

**认证流程**：
1. 注册：输入邮箱+密码 → Supabase 发送验证码邮件 → 用户输入 8 位 OTP 验证 → 自动登录
2. 登录：邮箱+密码直接登录
3. 登出：清除笔记缓存，保留本地错题

### 本地状态 (localStorage)

| Key | 内容 |
|---|---|
| `ysk_state` | `{ version, chapter, type, searchQuery, mode, wrongBook, stats }` |
| `ysk_revealed` | 已显示答案的题目 ID 数组 |
| `ysk_wrong_外操版` | 外操版错题本 `{ id: true }` |
| `ysk_wrong_内操版` | 内操版错题本 `{ id: true }` |
| `ysk_changelog_seen` | 最后看到的 commit hash，用于控制更新公告弹窗 |

### CSS 类名常量

所有 JS 模板中使用的 CSS 类名集中在 `State.CSS` 对象中定义：

```javascript
// state.js — CSS 类名常量
const CSS = {
  CHIP: 'chip', ACTIVE: 'active', COUNT: 'count',
  TYPE_BTN: 'type-btn',
  Q_CARD: 'q-card', Q_CARD_HEADER: 'q-card-header',
  Q_TYPE_BADGE: 'q-type-badge', Q_CHAPTER_LABEL: 'q-chapter-label',
  Q_TEXT: 'q-text', Q_OPTIONS: 'q-options',
  OPT_ROW: 'opt-row', REVEALED: 'revealed', WRONG: 'wrong',
  Q_ANSWER: 'q-answer', VISIBLE: 'visible', LABEL: 'label',
  Q_SHOW_ANSWER_BTN: 'q-show-answer-btn',
  Q_ACTIONS: 'q-actions', Q_ACTION_BTN: 'q-action-btn',
  Q_NOTE_BTN: 'q-note-btn', Q_REPORT_BTN: 'q-report-btn',
  VER_BTN: 'ver-btn',
  OVERLAY_CARD: 'overlay-card', RIPPLE: 'ripple',
  CLICKED: 'clicked', EXIT: 'exit', HIDE: 'hide',
  MODAL_CLOSE: 'modal-close', DISMISS_ATTR: 'data-dismiss',
};
```

**使用规则**：
- 模板字符串中引用的 CSS 类名必须通过 `State.CSS.XXX` 常量，不能直接写字符串字面量
- 修改 CSS 类名只需改 `state.js` 中的常量定义
- 命名约定：`Q_XXX` 前缀表示题目卡片相关 class，其余使用驼峰式大写下划线

### 展平后的题目模型 (flatQs)

```javascript
{
  _id: "火炬_选择题_0",     // 稳定 ID：章节_题型_本题型内序号（见下方「题目 ID」）
  _chapter: "火炬",
  _type: "选择题",
  question: "...",
  options: ["A. ...", ...],  // 仅选择题
  answer: "B" | "√" | "×" | text
}
```

**题目 ID**：`data.js` 的 `buildFlat()` 以「章节_题型_本题型内序号」生成稳定 `_id`（旧版为全局自增，题库任一处增删都会串位）。同时生成 `State.legacyIdMap`（旧 ID → 新 ID），本地错题本与云端错题/笔记在加载时自动迁移。

#### JSON 压缩优化

项目使用 gzip 算法压缩数据文件以加快首次加载速度：

1. 运行 `npm run compress` 执行 `scripts/compress_data.mjs`，使用 Node.js `zlib.gzipSync()` 将 `data/*.json` 压缩为 `data/*.json.gz`（压缩比约 23%）
2. `js/decompress.js` 在浏览器端通过原生 `DecompressionStream('gzip')` API 解压，无需额外库
3. `js/data.js` 的 `loadData()` 优先加载 `.json.gz` 文件，若失败则自动降级到 `.json`
4. 开发服务器 `serve.mjs` 默认以 `application/octet-stream` 提供 `.gz` 文件

# 版本切换 & 入口遮罩

首次访问显示渐变遮罩（玻璃态设计），要求用户选择外操版/内操版后进入主界面。选择时有 ripple 动画和弹出过渡。
后续切换版本通过顶部导航栏按钮完成。`app.js` 中的 `resetViewState()` 辅助函数重置所有筛选条件。

### 弹窗系统

| 弹窗 | 触发方式 | 功能 |
|---|---|---|
| 入口遮罩 `#entryOverlay` | 页面首次加载 | 选择版本（外操版/内操版） |
| 统计弹窗 `#statsModal` | 点击头部的 📊 按钮 | 显示题库统计 + 登录用户的云端答题正确率饼图 |
| 登录弹窗 `#loginModal` | 点击 🔐 登录按钮 | 登录/注册/邮箱验证 |
| 笔记弹窗 `#noteModal` | 点击题卡的 📝 笔记按钮（仅登录） | 保存/编辑/删除题目笔记 |
| 报错弹窗 `#reportModal` | 点击题卡的 🐛 报错按钮（仅登录） | 提交题目纠错反馈 |
| 更新公告弹窗 `#changelogModal` | 检测到新的 commit hash | 显示最近 5 条更新记录 |

## docx 解析器 (`scripts/parse_docx.py`)

- 使用 `python-docx` 提取段落纯文本
- **章节检测**：识别 `Heading 2` 样式 + `居中` 对齐的段落作为章节标题。不再依赖硬编码列表，docx 新增章节自动发现
- **题型检测**：正则匹配 `一、…` 到 `十、…` 前缀（`extract_type_name()` 同时处理括号后缀如 `三、判断题（含答案，对打√、错打 ×）`）
- **选项收集**：统一处理两种格式 — 外操版（同一行 `A. xxx B. xxx`）和内操版（每个选项独立一行）
- **答案提取**：正则匹配 `（A）` / `（√）` / `（×）`
- **加粗/下划线填充题**：`_extract_answers_from_runs()` 检测 docx run 的加粗/下划线格式，提取填充题答案，用 `____` 替换
- **简答题合并**：启发式函数 `looks_like_new_question()` 判断是否为新题目，可能出错
- **输出格式**：`{ info: { title, version, total }, chapters: [{ name, type_groups: [{ type, questions: [{ question, options?, answer }] }] }] }`

## 测试 (`tests/test_parse_docx.py`)

使用 pytest 对解析器进行全面的单元测试和端到端集成测试。所有 mock 对象（`MockParagraph`、`MockRun`）定义在 `conftest.py` 中。

| 测试类 | 测试内容 |
|---|---|
| `TestIsChapterHeading` | 章节标题检测（Heading 2 + CENTER 组合） |
| `TestExtractTypeName` | 题型名称提取（一～十、括号后缀） |
| `TestIsTypeHeader` | 题型前缀匹配 |
| `TestParseChoiceAnswer` | 选择题答案提取（全角/半角括号、空格） |
| `TestParseJudgeAnswer` | 判断题答案提取（√/×） |
| `TestSplitInlineOptions` | 内联选项分割（A. / A、/ A．） |
| `TestIsListingContinuation` | 列表续行检测（带圈数字、编号、项目符号） |
| `TestLooksLikeNewQuestion` | 新题目启发式判断（标点结尾/关键词开头） |
| `TestExtractAnswersFromRuns` | 加粗/下划线答案提取 |
| `TestIntegration` | 集成测试：解析真实 docx 文件，验证结构完整性 |

运行测试：`npm test` 或 `pytest tests/`。

## Supabase 数据库 (`scripts/init_supabase.sql`)

| 表 | 用途 | 唯一约束 |
|---|---|---|
| `wrong_questions` | 用户错题记录 | `(user_id, version, question_id)` |
| `answer_history` | 答题历史（含是否正确） | — |
| `question_notes` | 题目笔记 | `(user_id, version, question_id)` |
| `question_reports` | 纠错反馈（含 status） | `(user_id, version, question_id)` |

所有表通过 `user_id` 关联 Supabase Auth 用户，启用 RLS（Row Level Security）保证用户只能读写自己的数据。

此外定义了一个 RPC 函数 `get_answer_stats(text)`，在数据库端按章节聚合 `answer_history`（前端 `sync.js` 的 `getStats` 调用），避免分页拉全表再统计。

## 关键约束

- **生产环境零构建**：SPA 由 1 个 HTML + 1 个 CSS + 12 个 JS 模块 + data/*.json(含 .gz) 组成，依赖 supabase-js CDN、Chart.js CDN；p5.js CDN 仅桌面端按需加载（移动端/reduced-motion 不下载）
- **移动端优先**：响应式 CSS 适配到 320px。粘性顶部栏、横向滚动 chip 导航、适合触控的点击区域
- **无离线/PWA 支持**：Service Worker 未实现（列为 P3 技术债）
- **中文文件名**：JSON 文件名为中文。`scripts/serve.mjs` 包含 `decodeURIComponent` 处理；Python 的 `http.server` 可能无法正确处理
- **localStorage 是匿名用户唯一持久化方式**：清除 localStorage 会丢失所有数据
- **CDN 依赖**：依赖 `cdn.jsdelivr.net`（supabase-js、Chart.js）与 `cdnjs.cloudflare.com`（p5.js 按需加载），网络离线时登录/图表/动画不可用，匿名刷题不受影响

## 已知问题

- **P2**：无夜间模式、无收藏功能、无答题历史
- **P3**：无虚拟滚动（全量渲染 372 题可能较慢）
- **P3**：无 Service Worker / PWA 离线支持