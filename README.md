# 公用工程题库 SPA

公用工程题库的移动端刷题应用，纯静态单页面应用，可部署到 GitHub Pages。

## 使用

直接打开 `index.html` 即可使用（需本地 HTTP 服务器，如 `python -m http.server`）。

### 功能
- 外操版 / 内操版 双题库切换
- 按章节、题型筛选
- 卡片式刷题
- 关键字搜索（全文匹配）
- 错题本自动记录（localStorage）
- 随机抽题

## 部署到 GitHub Pages

```bash
git add .
git commit -m "初始版本：公用工程题库 SPA"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 仓库 Settings → Pages 中，选择 `main` 分支，根目录部署即可。

访问地址：`https://<你的用户名>.github.io/<仓库名>/`

## 更新题库

1. 修改 `公用工程题库（外操版）.docx` 或 `公用工程题库（内操版）.docx`
2. 重新运行解析脚本：
```bash
python scripts/parse_docx.py
```
3. 更新 `data/` 目录下的 JSON 文件
4. 重新提交并推送

## 技术栈

- 文档解析：Python + python-docx
- 前端：Vanilla JS + CSS3
- 部署：GitHub Pages
