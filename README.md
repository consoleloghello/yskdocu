# 公用工程题库 SPA

化工企业公用工程岗位的移动端刷题应用，纯静态单页面应用，部署于 GitHub Pages。

## 在线地址

<https://consoleloghello.github.io/yskdocu/>

## 功能

- **双题库切换**：外操版 / 内操版，覆盖 9 大专业系统（火炬、给水加压泵站、罐区、锅炉、空压站、污水预处理、循环水站、制冷站、制氮站）
- **章节与题型筛选**：按章节 chip 导航 + 选择题 / 判断题 / 填空题 / 简答题 / 实操分析题 / 应急处理题 分类过滤
- **关键字搜索**：全文匹配题目内容，支持搜索关键词高亮显示
- **答案展示**：点击卡片显示参考答案，支持一键展开/隐藏全部答案
- **错题本**：自动记录错题，支持按版本独立管理（localStorage 持久化 + 云端同步）
- **学习统计**：总题数、章节数、错题数统计，登录用户可查看云端答题正确率饼图（Chart.js）
- **更新公告**：版本更新后首次访问自动弹出最近提交记录
- **用户系统（Supabase）**：
  - 邮箱密码注册和登录，支持 8 位 OTP 验证码验证
  - 云端错题同步（登录后自动拉取合并）
  - 题目笔记：每道题可写笔记，云端存储
  - 纠错反馈：对存疑题目提交答案纠错报告
  - 答题统计：云端记录每次作答，生成正确率饼图

## 本地运行

```bash
# 推荐：Node.js 开发服务器（正确解析中文文件名）
node scripts/serve.mjs            # → http://127.0.0.1:8081

# 备选：Python HTTP 服务器
python -m http.server 8899
```

运行 SPA 无需 `npm install`；如需执行代码检查或测试：

```bash
npm install
npm run lint            # ESLint 检查
npm run lint:fix        # ESLint 自动修复
npm run format          # Prettier 格式化
npm run compress        # gzip 压缩 data/*.json → *.json.gz
npm test                # pytest 运行解析器测试
npm run test:smoke      # 前端冒烟测试（JSDOM）
npm run test:coverage   # 测试 + 覆盖率报告
```

## 部署到 GitHub Pages

Push 到 `main` 分支后，GitHub Actions 自动完成：运行测试（pytest + 前端冒烟）→ 解析 docx → 生成 changelog → gzip 压缩 JSON → 部署到 GitHub Pages。

> **首次配置**：仓库 Settings → Pages → Source 选择 **GitHub Actions**（仅需一次）。

## 更新题库

1. 修改 `公用工程题库（外操版）.docx` 或 `公用工程题库（内操版）.docx`
2. 运行解析脚本重新生成 JSON：

```bash
python scripts/parse_docx.py
```

3. 运行压缩脚本生成 `.json.gz` 文件：`npm run compress`
4. 提交更新后的 `data/` 目录下 JSON 和 `.json.gz` 文件
5. 如需验证解析正确性：`python -m pytest tests/`

## 更新公告

push 后由 GitHub Actions 自动生成 `data/changelog.json`。本地预览可手动运行：

```bash
node scripts/gen_changelog.mjs     # 输出 data/changelog.json，需提交到仓库
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | Vanilla JS（模块化：state / filter / renderer / data / app / supabase / sync / decompress）+ CSS3 |
| 文档解析 | Python 3 + python-docx |
| 后端服务 | Supabase (PostgreSQL + Auth + REST API) |
| 图表 | Chart.js v4 (CDN) |
| 测试 | pytest (含 coverage) |
| 代码质量 | ESLint + Prettier |
| 部署 | GitHub Pages 静态托管 |

**运行 SPA 零构建步骤、零 npm 依赖**（代码检查和测试需 `npm install`）。
