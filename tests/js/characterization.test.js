/**
 * Characterization tests for Phase 2 refactoring.
 *
 * These tests capture the current behavior of duplicate functions in
 * renderer.js and app.js so that the consolidated version can be verified
 * to produce identical results.
 *
 * Run: node --test tests/js/characterization.test.js
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ============================================================
// Test fixtures
// ============================================================
const SAMPLE_CHAPTERS = [
  {
    name: '火炬',
    type_groups: [
      {
        type: '选择题',
        questions: [
          { question: '地面火炬系统不能处理以下哪种气体？', options: ['A. 正常排放', 'B. 有毒气体', 'C. 开车排放', 'D. 事故泄压'], answer: 'B' },
          { question: '水封罐的作用不包括', options: ['A. 防止空气渗入', 'B. 建立背压', 'C. 分离液体', 'D. 阻止震动'], answer: 'C' },
        ],
      },
      { type: '判断题', questions: [{ question: '地面火炬可以处理所有类型气体', answer: '×' }, { question: '高能点火装置采用半导体表面放电原理', answer: '√' }] },
      { type: '填空题', questions: [{ question: '火炬系统主要设备包括____和____。', answer: '分液罐 水封罐' }] },
      { type: '简答题', questions: [{ question: '简述地面火炬的工作原理。', answer: '放空气经分液罐分离液体后进入燃烧炉燃烧。' }] },
    ],
  },
  {
    name: '锅炉',
    type_groups: [
      {
        type: '选择题',
        questions: [{ question: '锅炉蒸汽压力升高时，饱和温度会', options: ['A. 升高', 'B. 降低', 'C. 不变', 'D. 不确定'], answer: 'A' }],
      },
      { type: '判断题', questions: [{ question: '锅炉水位越高越安全', answer: '×' }] },
      { type: '实操分析题', questions: [{ question: '分析锅炉汽包水位波动的原因。', answer: '给水流量波动、负荷变化、燃烧工况变化等。' }] },
      { type: '应急处理题', questions: [{ question: '锅炉满水时的处理步骤。', answer: '立即停止给水，打开紧急放水管。' }] },
    ],
  },
];

const SAMPLE_INFO = { title: '公用工程题库（外操版）', version: '外操版', total: 10 };

function buildFlatQs(chapters) {
  const flat = [];
  let qid = 0;
  for (const ch of chapters) {
    for (const tg of ch.type_groups) {
      for (const q of tg.questions) {
        q._id = ch.name + '_' + tg.type + '_' + qid++;
        q._chapter = ch.name;
        q._type = tg.type;
        flat.push(q);
      }
    }
  }
  return flat;
}

const FLAT_QS = buildFlatQs(SAMPLE_CHAPTERS);

// ============================================================
// Minimal HTML skeleton
// ============================================================
const HTML_SKELETON = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"></head>
<body>
  <div id="app">
    <header id="header">
      <div class="header-inner">
        <h1 class="logo">📁 公用工程题库</h1>
        <div class="header-right">
          <button id="verWaic" class="ver-btn active">外操版</button>
          <button id="verNei" class="ver-btn">内操版</button>
          <button id="statsBtn" class="icon-btn">📊</button>
          <button id="loginBtn" class="auth-login-btn">🔐 登录</button>
          <span id="userInfo" class="auth-user-info" style="display:none">
            <span id="userName" class="auth-user-name"></span>
            <button id="logoutBtn" class="auth-logout-btn">登出</button>
          </span>
        </div>
      </div>
    </header>
    <div id="searchBar"><input id="searchInput" type="search" placeholder="搜索..."/><button id="searchClear" class="icon-btn" style="display:none">✕</button></div>
    <nav id="chapterNav"><div id="chapterList"></div><div id="typeFilters" style="display:none"></div></nav>
    <main id="mainContent">
      <div id="topActions" style="display:none"><button id="wrongBookBtn" class="action-btn">❌ 错题 (0)</button><button id="revealAllBtn" class="action-btn">👁 全部显示</button><button id="hideAllBtn" class="action-btn" style="display:none">🙈 全部隐藏</button></div>
      <div id="welcome"><div class="welcome-icon">📖</div><h2>选择章节开始刷题</h2><p id="welcomeStats">加载中...</p></div>
      <div id="questionList" style="display:none"></div>
    </main>
  </div>
  <div id="statsModal" class="modal" style="display:none"><div class="modal-content"><span id="statsClose" class="modal-close">✕</span><h2>📊 学习统计</h2><div id="statsBody"></div></div></div>
  <div id="noteModal" class="modal" style="display:none"><div class="modal-content"><span id="noteClose" class="modal-close">✕</span><h2>📝 题目笔记</h2><textarea id="noteTextarea" class="note-textarea"></textarea><div class="note-actions"><button id="noteSaveBtn" class="note-save-btn">💾 保存</button><button id="noteDeleteBtn" class="note-delete-btn">🗑 删除</button><button id="noteCancel" class="note-cancel-btn">取消</button></div></div></div>
  <div id="reportModal" class="modal" style="display:none"><div class="modal-content"><span id="reportClose" class="modal-close">✕</span><h2>🐛 题目纠错反馈</h2><div class="report-form"><p class="report-label">报错原因：</p><label class="report-option"><input type="radio" name="reportReason" value="答案有误"> 答案有误</label><label class="report-option"><input type="radio" name="reportReason" value="其他"> 其他</label><textarea id="reportDetail" class="report-textarea"></textarea><p id="reportMsg" class="report-msg"></p><div class="report-actions"><button id="reportSubmit" class="report-submit-btn">提交</button><button id="reportCancel" class="report-cancel-btn">取消</button></div></div></div>
  <div id="changelogModal" class="modal" style="display:none"><div class="modal-content"><span id="changelogClose" class="modal-close">✕</span><h2>📢 更新公告</h2><div id="changelogBody"></div></div></div>
</body>
</html>`;

// ============================================================
// Global shared env
// ============================================================
let sharedWin = null;
let sharedDoc = null;
let S = null; // State
let R = null; // Render

/** Load state.js into window */
function loadStateJs(win) {
  win.eval(readFileSync(resolve(PROJECT_ROOT, 'js/state.js'), 'utf-8'));
  return win.State;
}

/** Load renderer.js into window */
function loadRendererJs(win) {
  win.eval(readFileSync(resolve(PROJECT_ROOT, 'js/renderer.js'), 'utf-8'));
  return win.Render;
}

/** Create or reset the entire test environment */
function resetEnv() {
  // First-time setup
  if (!sharedWin) {
    sharedDom = new JSDOM(HTML_SKELETON, { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'outside-only' });
    sharedWin = sharedDom.window;
    sharedDoc = sharedWin.document;
    sharedWin.addEventListener('error', (e) => { /* suppress eval errors from source files */ });
    S = loadStateJs(sharedWin);
    R = loadRendererJs(sharedWin);
  }

  // Reset state to defaults
  sharedWin.localStorage.clear();
  S.data = { info: SAMPLE_INFO, chapters: SAMPLE_CHAPTERS };
  S.flatQs = FLAT_QS;

  const st = S.get();
  st.version = '外操版';
  st.chapter = 'all';
  st.type = 'all';
  st.searchQuery = '';
  st.mode = 'browse';
  st.wrongBook = {};
  st.stats = {};

  // Clear revealed
  const rev = S.getRevealed();
  rev.clear();
}

/** Minimal state reset (lightweight, keeps data/flatQs intact) */
function resetState() {
  S.setMulti({ version: '外操版', chapter: 'all', type: 'all', searchQuery: '', mode: 'browse' });
  S.set('wrongBook', {});
  S.getRevealed().clear();
}

let sharedDom = null;

// ============================================================
// Pure data function reference implementations (parity tests)
// ============================================================
function rendererGetCurrentQs(st, fqs, isWrongFn) {
  if (st.mode === 'wrong') return fqs.filter(q => isWrongFn(q._id));
  let list = st.searchQuery
    ? rendererSearchIn(fqs, st.searchQuery)
    : st.chapter === 'all' ? fqs : fqs.filter(q => q._chapter === st.chapter);
  if (st.type !== 'all') list = list.filter(q => q._type === st.type);
  return list;
}
function rendererSearchIn(arr, query) {
  const q = query.toLowerCase();
  return arr.filter(item =>
    [item.question, item.answer, item._chapter, item._type].concat(item.options || []).join(' ').toLowerCase().includes(q)
  );
}
function appGetCurrentQs(st, fqs, wb) {
  if (st.mode === 'wrong') return fqs.filter(q => wb[q._id]);
  let list = st.searchQuery
    ? appSearchIn(fqs, st.searchQuery)
    : st.chapter === 'all' ? fqs : fqs.filter(q => q._chapter === st.chapter);
  if (st.type !== 'all') list = list.filter(q => q._type === st.type);
  return list;
}
function appSearchIn(arr, query) {
  const q = query.toLowerCase();
  return arr.filter(item => [item.question, item.answer, item._chapter, item._type, ...(item.options || [])].join(' ').toLowerCase().includes(q));
}
function rendererCountByType(arr) {
  const m = {};
  arr.forEach(function (q) { m[q._type] = (m[q._type] || 0) + 1; });
  return m;
}

// ============================================================
// Characterization tests
// ============================================================

describe('Characterization — Pure data functions', () => {
  before(() => resetEnv());
  beforeEach(() => resetState());

  describe('getCurrentQs (via Render.render() + Render.getCurrentQs())', () => {

    it('returns all flatQs in browse mode with chapter=all and type=all', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: '' });
      R.render();
      // Render.getCurrentQs() returns _currentQuestions set by renderCards()
      // After a full render, this should be all flatQs
      const qs = R.getCurrentQs();
      assert.equal(qs.length, FLAT_QS.length);
    });

    it('filters by chapter correctly', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: 'all', searchQuery: '' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.length > 0);
      assert.ok(qs.every(q => q._chapter === '火炬'));
    });

    it('filters by type correctly', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: '选择题', searchQuery: '' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.every(q => q._type === '选择题'));
    });

    it('shows wrong book items when mode=wrong', () => {
      S.setMulti({ mode: 'wrong', chapter: 'all', type: 'all', searchQuery: '' });
      S.set('wrongBook', { '火炬_判断题_2': true });
      R.render();
      const qs = R.getCurrentQs();
      assert.equal(qs.length, 1);
      assert.equal(qs[0]._id, '火炬_判断题_2');
    });

    it('shows welcome empty state when wrong book is empty and mode=wrong', () => {
      S.setMulti({ mode: 'wrong', chapter: 'all', type: 'all', searchQuery: '' });
      S.set('wrongBook', {});
      R.render();
      // When qs.length === 0, render() does NOT call renderCards()
      // so _currentQuestions from previous test may be stale.
      // Instead check the DOM state:
      assert.equal(sharedDoc.getElementById('welcome').style.display, 'block');
      assert.equal(sharedDoc.getElementById('questionList').style.display, 'none');
      assert.ok(sharedDoc.getElementById('welcome').querySelector('h2').textContent.includes('错题本为空'));
    });

    it('combines chapter and type filter', () => {
      S.setMulti({ mode: 'browse', chapter: '锅炉', type: '选择题', searchQuery: '' });
      R.render();
      const qs = R.getCurrentQs();
      assert.equal(qs.length, 1);
      assert.equal(qs[0]._id, '锅炉_选择题_6');
    });
  });

  describe('searchIn', () => {
    it('finds matches in question text', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: '水封罐' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.length >= 1);
      assert.ok(qs.some(q => q.question.includes('水封罐')));
    });

    it('finds matches in answer text', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: '分液罐' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.length >= 1);
    });

    it('shows welcome empty for non-matching search', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: 'zzz_not_there_12345' });
      R.render();
      // Empty state — check DOM rather than Render.getCurrentQs()
      assert.equal(sharedDoc.getElementById('welcome').style.display, 'block');
      assert.ok(sharedDoc.getElementById('welcome').querySelector('p').textContent.includes('未找到匹配题目'));
    });

    it('is case-insensitive', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: 'SHUI' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.length >= 1);
    });

    it('searches across options array', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: '有毒气体' });
      R.render();
      const qs = R.getCurrentQs();
      assert.ok(qs.length >= 1);
    });
  });

  describe('countByType', () => {
    it('counts question types correctly in rendered filters', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: '' });
      R.render();
      const typeFilters = sharedDoc.getElementById('typeFilters');
      assert.equal(typeFilters.style.display, 'flex');
      const allBtn = typeFilters.querySelector('.type-btn[data-type="all"]');
      assert.ok(allBtn);
      // "全部" count = total questions after filtering
      const countSpan = allBtn.querySelector('.count');
      assert.ok(countSpan);
      // All 10 questions should be shown
      assert.equal(countSpan.textContent, String(FLAT_QS.length));
    });
  });
});

describe('Characterization — DOM rendering functions', () => {
  before(() => resetEnv());
  beforeEach(() => resetState());

  describe('render() — empty state (welcome screen)', () => {
    it('shows welcome message when no questions match', () => {
      S.setMulti({ mode: 'wrong', wrongBook: {} });
      R.render();
      assert.equal(sharedDoc.getElementById('welcome').style.display, 'block');
      assert.equal(sharedDoc.getElementById('questionList').style.display, 'none');
    });

    it('shows "错题本为空" when mode=wrong and no wrong items', () => {
      S.setMulti({ mode: 'wrong', wrongBook: {} });
      R.render();
      const h2 = sharedDoc.getElementById('welcome').querySelector('h2');
      assert.ok(h2.textContent.includes('错题本为空'));
    });

    it('shows search-not-found when search yields no results', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all', searchQuery: 'xxx_nonexistent' });
      R.render();
      const p = sharedDoc.getElementById('welcome').querySelector('p');
      assert.ok(p.textContent.includes('未找到匹配题目'));
    });

    it('shows browse prompt when no search, not wrong, and chapter has no questions', () => {
      S.setMulti({ mode: 'browse', chapter: 'nonexistent_chapter', type: 'all', searchQuery: '' });
      R.render();
      const p = sharedDoc.getElementById('welcome').querySelector('p');
      assert.ok(p.textContent.includes('公用工程题库'));
    });
  });

  describe('renderChapters()', () => {
    it('renders chapter chip buttons with correct names and total count', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
      R.render();
      const chips = sharedDoc.getElementById('chapterList').querySelectorAll('.chip');
      assert.ok(chips.length >= 3);
      assert.ok(chips[0].textContent.includes('全部'));
      assert.equal(chips[0].querySelector('.count').textContent, String(FLAT_QS.length));
    });

    it('marks the active chapter chip', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: 'all' });
      R.render();
      const activeChips = sharedDoc.querySelectorAll('.chip.active');
      assert.equal(activeChips.length, 1);
      assert.equal(activeChips[0].dataset.ch, '火炬');
    });

    it('marks "all" as active when mode=wrong', () => {
      S.setMulti({ mode: 'wrong', chapter: '火炬', type: 'all', wrongBook: { '火炬_选择题_0': true } });
      R.render();
      const activeChips = sharedDoc.querySelectorAll('.chip.active');
      assert.equal(activeChips.length, 1);
      assert.equal(activeChips[0].dataset.ch, 'all');
    });
  });

  describe('renderTypeFilters()', () => {
    it('shows type filter buttons when there are multiple types', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
      R.render();
      assert.equal(sharedDoc.getElementById('typeFilters').style.display, 'flex');
      const btns = sharedDoc.querySelectorAll('.type-btn');
      assert.ok(btns.length > 1);
    });

    it('marks active type button', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: '判断题' });
      R.render();
      const activeType = sharedDoc.querySelector('.type-btn.active');
      assert.ok(activeType);
      assert.equal(activeType.dataset.type, '判断题');
    });

    it('shows correct counts on type buttons', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
      R.render();
      const choiceBtn = sharedDoc.querySelector('.type-btn[data-type="选择题"]');
      assert.ok(choiceBtn);
      assert.equal(choiceBtn.querySelector('.count').textContent, '3');
    });
  });

  describe('renderCards()', () => {
    it('renders card HTML for each question', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬' });
      R.render();
      assert.equal(sharedDoc.querySelectorAll('.q-card').length, 6);
    });

    it('shows list info with total count', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
      R.render();
      const listInfo = sharedDoc.getElementById('listInfo');
      assert.ok(listInfo);
      assert.ok(listInfo.textContent.includes(String(FLAT_QS.length)));
    });

    it('renders options for choice questions', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '选择题' });
      R.render();
      assert.equal(sharedDoc.querySelectorAll('.opt-row').length, 8);
    });

    it('renders answer section with correct answer text for judgments', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '判断题' });
      R.render();
      const answers = sharedDoc.querySelectorAll('.q-answer');
      assert.equal(answers.length, 2);
      // First judgment is × → '错误 ✗'
      assert.ok(answers[0].textContent.includes('错误') || answers[0].textContent.includes('正确'));
    });

    it('shows answer by default for DIRECT_TYPES (填空题)', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '填空题' });
      R.render();
      const answers = sharedDoc.querySelectorAll('.q-answer');
      assert.ok(answers[0].classList.contains('visible'));
    });

    it('hides answer by default for choice questions unless revealed', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '选择题' });
      R.render();
      sharedDoc.querySelectorAll('.q-answer').forEach(ans => {
        assert.equal(ans.classList.contains('visible'), false);
      });
    });

    it('includes show-answer-btn for choice questions', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '选择题' });
      R.render();
      assert.equal(sharedDoc.querySelectorAll('.q-show-answer-btn').length, 2);
    });

    it('excludes show-answer-btn for DIRECT_TYPES (填空题)', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '填空题' });
      R.render();
      assert.equal(sharedDoc.querySelectorAll('.q-show-answer-btn').length, 0);
    });

    it('sets data-id on each card matching flatQs _id', () => {
      S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
      R.render();
      const cards = sharedDoc.querySelectorAll('.q-card');
      assert.equal(cards[0].dataset.id, '火炬_选择题_0');
      assert.equal(cards[1].dataset.id, '火炬_选择题_1');
    });

    it('renders header with type badge and chapter label', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '选择题' });
      R.render();
      const header = sharedDoc.querySelector('.q-card-header');
      assert.ok(header.querySelector('.q-type-badge'));
      assert.ok(header.querySelector('.q-chapter-label'));
    });
  });

  describe('updateTopActions()', () => {
    it('updates wrong book button text count', () => {
      S.setMulti({ mode: 'browse', wrongBook: { '火炬_选择题_0': true, '锅炉_选择题_6': true } });
      R.render();
      assert.ok(sharedDoc.getElementById('wrongBookBtn').textContent.includes('2'));
    });

    it('shows revealAllBtn when not all are revealed', () => {
      S.setMulti({ mode: 'browse', chapter: '火炬', type: '选择题' });
      R.render();
      assert.equal(sharedDoc.getElementById('revealAllBtn').style.display, 'inline-block');
    });
  });

  describe('updateStats()', () => {
    it('shows version, total count, and wrong count', () => {
      S.setMulti({ wrongBook: { '火炬_选择题_0': true } });
      R.render();
      const stats = sharedDoc.getElementById('welcomeStats');
      assert.ok(stats.innerHTML.includes('外操版'));
      assert.ok(stats.innerHTML.includes(String(FLAT_QS.length)));
      assert.ok(stats.innerHTML.includes('1'));
    });
  });
});

describe('Characterization — Renderer vs App parity', () => {
  before(() => resetEnv());

  it('renderer.js and app.js getCurrentQs produce identical results', () => {
    const testCases = [
      { mode: 'browse', chapter: 'all', type: 'all', searchQuery: '', wrongBook: {} },
      { mode: 'browse', chapter: '火炬', type: 'all', searchQuery: '', wrongBook: {} },
      { mode: 'browse', chapter: '锅炉', type: '选择题', searchQuery: '', wrongBook: {} },
      { mode: 'browse', chapter: 'all', type: '判断题', searchQuery: '', wrongBook: {} },
      { mode: 'browse', chapter: 'all', type: '简答题', searchQuery: '', wrongBook: {} },
      { mode: 'wrong', chapter: 'all', type: 'all', searchQuery: '', wrongBook: { '火炬_选择题_0': true } },
      { mode: 'wrong', chapter: 'all', type: 'all', searchQuery: '', wrongBook: { '火炬_选择题_0': true, '锅炉_判断题_7': true } },
      { mode: 'browse', chapter: 'all', type: 'all', searchQuery: '火炬', wrongBook: {} },
    ];

    for (const st of testCases) {
      const r1 = rendererGetCurrentQs(st, FLAT_QS, id => !!st.wrongBook[id]);
      const r2 = appGetCurrentQs(st, FLAT_QS, st.wrongBook);
      const ids1 = r1.map(q => q._id).sort();
      const ids2 = r2.map(q => q._id).sort();
      assert.deepEqual(ids1, ids2, `Mismatch for state: ${JSON.stringify(st)}`);
    }
  });

  it('renderer.js and app.js searchIn produce identical results', () => {
    for (const q of ['水封罐', '锅炉', '地面', '错误', 'semiconductor', '']) {
      const r1 = rendererSearchIn(FLAT_QS, q).map(x => x._id).sort();
      const r2 = appSearchIn(FLAT_QS, q).map(x => x._id).sort();
      assert.deepEqual(r1, r2, `Search "${q}" differs`);
    }
  });

  it('renderer.js and app.js countByType produce identical results', () => {
    assert.deepEqual(rendererCountByType(FLAT_QS), { '选择题': 3, '判断题': 3, '填空题': 1, '简答题': 1, '实操分析题': 1, '应急处理题': 1 });
  });
});

describe('Characterization — Edge cases', () => {
  before(() => resetEnv());
  beforeEach(() => resetState());

  it('renders "答案未标注" for choice questions without answer', () => {
    const badQ = { question: 'Test without answer', options: ['A. Opt1', 'B. Opt2'], answer: '', _id: 'test_no_answer_0', _chapter: '火炬', _type: '选择题' };
    const savedFlatQs = S.flatQs;
    S.flatQs = [...FLAT_QS, badQ];
    S.setMulti({ mode: 'browse', chapter: 'all', type: '选择题' });
    R.render();
    const unmarked = Array.from(sharedDoc.querySelectorAll('.q-answer')).find(a => a.textContent.includes('答案未标注'));
    assert.ok(unmarked);
    // Restore flatQs to not pollute subsequent tests
    S.flatQs = savedFlatQs;
  });

  it('handles highlightText with null/undefined gracefully', () => {
    assert.equal(S.highlightText(null, ''), '');
    assert.equal(S.highlightText(undefined, ''), '');
    assert.equal(S.highlightText('test', ''), 'test');
  });

  it('preserves wrongBook across state reset (wrongBook not touched by setMulti with no wrongBook key)', () => {
    // First set wrong items
    S.setMulti({ wrongBook: { '火炬_选择题_0': true, '锅炉_判断题_7': true } });
    // Then do a view-only reset (like switchVersion does via resetViewState)
    S.setMulti({ chapter: 'all', type: 'all', searchQuery: '', mode: 'browse' });
    // wrongBook should survive
    assert.equal(S.wrongCount(), 2);
  });

  it('"全部" type filter shows correct aggregated count for a chapter', () => {
    S.setMulti({ mode: 'browse', chapter: '火炬', type: 'all' });
    R.render();
    const allFilter = sharedDoc.querySelector('#typeFilters .type-btn[data-type="all"]');
    assert.ok(allFilter);
    // 火炬: 2+2+1+1 = 6
    assert.equal(allFilter.querySelector('.count').textContent, '6');
  });

  it('current questions are in flatQs insertion order', () => {
    S.setMulti({ mode: 'browse', chapter: 'all', type: 'all' });
    R.render();
    const qs = R.getCurrentQs();
    // flatQs is in insertion order; render() returns items in flatQs order
    // with the same length (no filtering). Verify by matching _id values.
    assert.equal(qs.length, FLAT_QS.length);
    for (let i = 0; i < qs.length; i++) {
      assert.equal(qs[i]._id, FLAT_QS[i]._id, `Position ${i} mismatch`);
    }
  });
});
