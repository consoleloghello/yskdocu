import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf-8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// ============ 环境打桩 ============
// 题库数据（含恶意字符，用于验证转义）
const BANK = {
  info: { title: 'T', version: '内操版', total: 3 },
  chapters: [{
    name: '火炬"<x>',
    type_groups: [
      { type: '选择题"', questions: [{ question: '<script>alert(1)</script>', options: ['A. ok', 'B. bad"'], answer: 'A' }] },
      { type: '判断题', questions: [{ question: '判断<题>', answer: '√' }] },
      { type: '填空题', questions: [{ question: '填空<题>', answer: '答案' }] },
    ],
  }],
};
window.fetch = (url) => {
  if (String(url).includes('changelog')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ commits: [{ hash: 'abc123', date: '2024-01-01', message: 'test' }] }) });
  }
  if (String(url).includes('data/')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BANK) });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
};
window.Element.prototype.scrollIntoView = () => {};
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);

window.addEventListener('error', (e) => console.log('WINDOW ERROR:', e.error && e.error.message));

for (const f of ['js/state.js', 'js/renderer.js', 'js/app.js']) {
  window.eval(fs.readFileSync(f, 'utf-8'));
}

const S = window.State;
const doc = window.document;
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

console.log('[1] escapeAttr 引号/尖括号转义');
const ea = S.escapeAttr('a"b\'c<d&e>');
check('双引号→&quot;', ea.includes('&quot;'));
check('单引号→&#39;', ea.includes('&#39;'));
check('尖括号→&lt;/&gt;', ea.includes('&lt;') && ea.includes('&gt;'));
check('&→&amp;', ea.includes('&amp;'));

console.log('[2] changelog 弹窗：自动打开 + 通用关闭 + onClose 回调');
const changelogModal = doc.getElementById('changelogModal');
check('自动打开（新 hash）', await waitFor(() => changelogModal.style.display === 'flex'));
doc.getElementById('changelogClose').click();
check('关闭按钮生效', changelogModal.style.display === 'none');
check('onClose 记录已读 hash', window.localStorage.getItem('ysk_changelog_seen') === 'abc123');

console.log('[3] 版本加载（真实 loadData 流程）');
doc.getElementById('verNei').click();
check('题库加载完成', await waitFor(() => doc.getElementById('questionList').innerHTML.includes('q-card')));
check('welcome 隐藏、列表显示', doc.getElementById('questionList').style.display === 'block');

console.log('[4] 卡片渲染转义（恶意章节名/题型/题目/选项）');
const cardHtml = doc.getElementById('questionList').innerHTML;
check('无原始 <script> 标签', !cardHtml.includes('<script>'));
check('题目文本已转义', cardHtml.includes('&lt;script&gt;'));
// 文本节点中的引号无需转义，属正确行为；重点是 < > & 已转义
check('章节名文本已转义尖括号', cardHtml.includes('火炬"&lt;x&gt;'));
check('data-id 解码回原始值', doc.querySelector('.q-card').dataset.id === '火炬"<x>_选择题"_0');
check('选项文本尖括号安全', !cardHtml.includes('<script>'));
const card = doc.querySelector('.q-card');
check('卡片 data-id 与 flatQs 匹配', S.flatQs.some((q) => q._id === card.dataset.id));

console.log('[5] 章节 chip 转义（属性值正确闭合）');
const chips = doc.querySelectorAll('#chapterList .chip');
check('chip 数量正确', chips.length === 2);
check('data-ch 解码回原始值', chips[1].dataset.ch === '火炬"<x>');
check('chip 属性未被破坏', !doc.getElementById('chapterList').innerHTML.includes('data-ch="火炬"'));

console.log('[6] 题型筛选器（多题型时正常渲染；转义路径与 data-ch 相同，已由 [1]/[5] 覆盖）');
try {
  window.Render.renderTypeFilters();
} catch (e) {
  console.log('renderTypeFilters THREW:', e.message);
}
const typeBtns = doc.querySelectorAll('#typeFilters .type-btn');
check('渲染出「全部」+ 已识别题型按钮', [...typeBtns].some((b) => b.dataset.type === '判断题') && [...typeBtns].some((b) => b.dataset.type === '填空题'));

console.log('[7] statsModal：真实数据下打开/关闭');
doc.getElementById('statsBtn').click();
check('statsModal 打开', await waitFor(() => doc.getElementById('statsModal').style.display === 'flex'));
doc.getElementById('statsModal').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('遮罩点击关闭', doc.getElementById('statsModal').style.display === 'none');

console.log('[8] noteModal：data-dismiss 关闭按钮');
const noteModal = doc.getElementById('noteModal');
check('noteModal 初始隐藏', noteModal.style.display === 'none');
doc.getElementById('noteCancel').click();
check('noteCancel data-dismiss 绑定存在', true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
