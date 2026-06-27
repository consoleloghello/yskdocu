# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A mobile-first SPA flashcard app for a chemical plant's public utilities exam question bank. Pure static files — no build step, no backend, no framework. Deployed to GitHub Pages.

## Commands

```bash
# Local dev server (recommended — handles CJK filenames in URL encoding)
node serve.mjs                    # → http://127.0.0.1:8081

# Alternative: Python HTTP server
python -m http.server 8899 --directory D:\workSpace\yskdoc

# Re-parse docx source files into JSON
python scripts/parse_docx.py      # reads .docx from repo root, writes data/*.json
```

There is no build step, no test suite, and no linter configured.

## Architecture

**Data pipeline:** `.docx` source files → `scripts/parse_docx.py` → `data/外操版.json` + `data/内操版.json` → browser loads via `fetch()` → rendered as question cards.

**Frontend** (`index.html` + `css/style.css` + `js/app.js`): a single IIFE in `app.js` manages everything. No framework, no modules, no bundler. The app has four conceptual layers all in one file:

| Layer | Responsibility |
|---|---|
| DataLoader | `fetch()` JSON by version, `buildFlat()` flattens nested chapters/type-groups into `flatQs[]` with synthetic `_id`/`_chapter`/`_type` fields |
| StateManager | `state` object persisted to `localStorage` under keys `ysk_state` and `ysk_revealed`. See fields below. |
| Renderer | `render()` orchestrates `renderChapters()`, `renderTypeFilters()`, `renderCards(qs)`. Full re-render on every state change (no virtual DOM). |
| Event handlers | Inline `addEventListener` bindings for search, chip clicks, type filters, answer reveal, version switch, entry overlay, stats modal. |

**State object** (`state` global, synced to `ysk_state` in localStorage):
- `version`: `"外操版"` | `"内操版"`
- `chapter`: `"all"` | chapter name string
- `type`: `"all"` | question type string
- `searchQuery`: current search input text
- `mode`: `"browse"` | `"wrong"` | `"search"`
- `wrongBook`: `{ [q._id]: true }` — auto-populated on wrong answers; persisted per-version under `ysk_wrong_${version}`
- `stats`: reserved object (currently unused in rendering)

**Revealed state** (`revealed` Set, synced to `ysk_revealed`): tracks which question IDs have their answer currently shown.

**localStorage keys:** `ysk_state`, `ysk_revealed`, `ysk_wrong_外操版`, `ysk_wrong_内操版`

**Key functions in `app.js`:**
- `loadData(ver)` — fetch JSON, call `buildFlat()`, render
- `getCurrentQs()` — filter `flatQs` by `state` (chapter → type → search → wrong-book mode)
- `renderCards(qs)` — generate card HTML, bind per-card events (answer reveal, option click)
- `esc()` — XSS-safe text escaping via DOM textContent

**Version switching** now preserves per-version wrongBook — each version's mistaken questions are stored independently under `ysk_wrong_${version}` and restored when switching back. The entry overlay and header toggle share a `resetViewState()` helper for filter resets.

**Entry overlay** (`#entryOverlay`): full-screen blur backdrop shown on every page load. User must pick 外操版 or 内操版 to enter. No "remember choice" — this is intentional.

## docx parser (`scripts/parse_docx.py`)

- Uses `python-docx` to extract paragraph text only (ignores styles — all docx content is Normal style).
- Chapter detection: exact-match against a hardcoded `KNOWN_CHAPTERS` list. If the source docx adds a new chapter, this list must be updated.
- Question type detection: regex matches on `一、…` through `五、…` prefix patterns.
- Answer extraction: regex for `（A）` / `（√）` / `（×）` markers inline in question text.
- Short-answer merging: heuristic `looks_like_new_question()` decides whether a paragraph starts a new question or continues the previous answer. This heuristic can fail — see known issues in 交接文档.md.
- Output JSON structure: `{ info: { title, version, total }, chapters: [{ name, type_groups: [{ type, questions: [{ question, options?, answer }] }] }] }`

## Data model

Each question object in `flatQs`:
```
{
  _id: "火炬_选择题_0",     // synthetic: chapter_type_index
  _chapter: "火炬",
  _type: "选择题",
  question: "...",
  options: ["A. ...", ...],  // only for 选择题
  answer: "B" | "√" | "×" | text
}
```

## Key constraints

- **Zero dependencies in production**: the SPA is a single HTML file + one CSS file + one JS file + two JSON data files. No npm packages appear in the frontend.
- **Mobile-first**: all CSS is responsive down to 320px. Sticky header, horizontal-scroll chip nav, touch-friendly tap targets.
- **No offline/PWA support**: Service Worker not implemented (listed as P3 tech debt).
- **CJK filenames**: the JSON files have Chinese names. `serve.mjs` includes `decodeURIComponent` to handle this; Python's `http.server` may not.
- **LocalStorage is the only persistence**: no server, no IndexedDB. All state is lost if localStorage is cleared.
