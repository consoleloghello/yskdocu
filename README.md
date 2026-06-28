# 公用工程题库 SPA

化工企业公用工程岗位的移动端刷题应用，纯静态单页面应用，部署于 GitHub Pages。

## 在线地址

<https://consoleloghello.github.io/yskdocu/>

## 功能

- **双题库切换**：外操版 / 内操版，覆盖 9 大专业系统（火炬、给水加压泵站、罐区、锅炉、空压站、污水预处理、循环水站、制冷站、制氮站）
- **章节与题型筛选**：按章节 chip 导航 + 选择题 / 判断题 / 填空题 / 简答题分类过滤
- **关键字搜索**：全文匹配题目内容
- **答案展示**：点击卡片显示参考答案，支持一键展开/隐藏全部答案
- **错题本**：自动记录错题，支持按版本独立管理（localStorage 持久化）
- **学习统计**：总题数、章节数、错题数统计，登录用户可查看正确率饼图
- **更新公告**：版本更新后首次访问自动弹出最近提交记录
- **登录功能（Supabase）**：邮箱注册/登录，云端同步错题、题目笔记、纠错反馈、答题统计

## 本地运行

```bash
# 推荐：Node.js 开发服务器（正确解析中文文件名）
node scripts/serve.mjs            # → http://127.0.0.1:8081

# 备选：Python HTTP 服务器
python -m http.server 8899
```

无需 `npm install`，零依赖。

## 部署到 GitHub Pages

1. Push 到 GitHub 仓库的 `main` 分支
2. 在仓库 Settings → Pages 中，选择 `main` 分支，根目录部署
3. 部署前运行 `node scripts/gen_changelog.mjs` 更新公告数据

## 更新题库

1. 修改 `公用工程题库（外操版）.docx` 或 `公用工程题库（内操版）.docx`
2. 运行解析脚本重新生成 JSON：

```bash
python scripts/parse_docx.py
```

3. 提交更新后的 `data/` 目录下 JSON 文件

## 更新公告

部署前生成最新的提交记录：

```bash
node scripts/gen_changelog.mjs     # 输出 changelog.json，需提交到仓库
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | Vanilla JS (IIFE) + CSS3 |
| 文档解析 | Python 3 + python-docx |
| 后端服务 | Supabase (PostgreSQL + Auth + REST API) |
| 图表 | Chart.js v4 (CDN) |
| 部署 | GitHub Pages 静态托管 |

**零构建步骤、零 npm 依赖。**
