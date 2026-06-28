(function(){
'use strict';

let data = null;
let flatQs = [];
let revealed = new Set();
let state = { version:'外操版', chapter:'all', type:'all', searchQuery:'', mode:'browse', wrongBook:{}, stats:{} };
let localNotes = {};  // 云端笔记缓存 { questionId: content }

const $ = id => document.getElementById(id);
const qList = $('questionList');

function ls(key){ try{ return JSON.parse(localStorage.getItem(key)) }catch(e){} return null }
function lss(key,v){ try{ localStorage.setItem(key, JSON.stringify(v)) }catch(e){} }

function loadState(){
  const s = ls('ysk_state');
  if(s) Object.assign(state, s);
  const wb = ls('ysk_wrong_' + state.version);
  if(wb) {
    state.wrongBook = wb;
  } else if (!state.wrongBook || Object.keys(state.wrongBook).length === 0) {
    state.wrongBook = {};
  }
  const r = ls('ysk_revealed');
  if(r) revealed = new Set(r);
}
function saveState(){
  const {wrongBook, ...rest} = state;
  lss('ysk_state', rest);
  lss('ysk_wrong_' + state.version, wrongBook);
  lss('ysk_revealed', [...revealed]);
}

async function loadData(ver){
  try {
    const r = await fetch('data/'+ver+'.json');
    if(!r.ok) throw new Error('HTTP '+r.status);
    data = await r.json();
    buildFlat();
    revealed.clear();
    flatQs.forEach(q => revealed.add(q._id));
    state.version = ver;
    if(ver === '外操版'){
      $('verWaic').classList.add('active');
      $('verNei').classList.remove('active');
    } else {
      $('verNei').classList.add('active');
      $('verWaic').classList.remove('active');
    }
    const wb = ls('ysk_wrong_' + ver);
    if(wb) state.wrongBook = wb;
    else state.wrongBook = {};
    if(state.chapter!='all' && !data.chapters.find(c=>c.name===state.chapter)) state.chapter='all';
    saveState();
    // 登录状态下拉取云端错题和笔记
    pullCloudData(ver);
    render();
  } catch(e){
    $('welcomeStats').textContent='加载失败，请检查网络连接后刷新页面重试';
    console.error('loadData error:', e);
  }
}

// ============================================================
// 云端数据同步（登录用户）
// ============================================================

/** 拉取云端错题本和笔记，合并到本地 */
async function pullCloudData(ver) {
  if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) return;
  try {
    // 拉取云端错题
    var cloudWrong = await window.Sync.getWrongQuestions(ver);
    if (cloudWrong && cloudWrong.length) {
      cloudWrong.forEach(function(id) { state.wrongBook[id] = true; });
      saveState();
    }
    // 拉取云端笔记
    var notes = await window.Sync.getNotes(ver);
    if (notes) localNotes = notes;
  } catch(e) {
    console.error('pullCloudData error:', e);
  }
}

/** 监听认证状态变化 */
function initAuthSync() {
  if (typeof window.SupabaseAuth === 'undefined') return;

  window.SupabaseAuth.onAuthStateChange(function(user) {
    if (user) {
      // 登录：合并云端数据
      pullCloudData(state.version).then(function() { render(); });
    } else {
      // 登出：清除笔记缓存，保留本地错题
      localNotes = {};
      render();
    }
  });

  // 页面初始化时检查是否已登录
  if (window.SupabaseAuth.isLoggedIn()) {
    pullCloudData(state.version).then(function() { render(); });
  }
}

function buildFlat(){
  flatQs = []; let qid=0;
  data.chapters.forEach(ch => {
    ch.type_groups.forEach(tg => {
      tg.questions.forEach(q => {
        q._id = ch.name+'_'+tg.type+'_'+(qid++);
        q._chapter = ch.name;
        q._type = tg.type;
        flatQs.push(q);
      });
    });
  });
}

function getCurrentQs(){
  if(state.mode==='wrong'){
    return flatQs.filter(q => state.wrongBook[q._id]);
  }
  let list = state.searchQuery ? searchIn(flatQs, state.searchQuery) :
    (state.chapter==='all' ? flatQs : flatQs.filter(q => q._chapter===state.chapter));
  if(state.type!=='all') list = list.filter(q => q._type===state.type);
  return list;
}

function searchIn(arr, query){
  const q = query.toLowerCase();
  return arr.filter(item => {
    const haystack = [
      item.question, item.answer, item._chapter, item._type,
      ...(item.options || [])
    ].join(' ');
    return haystack.toLowerCase().includes(q);
  });
}

function countByType(arr){
  const m = {};
  arr.forEach(q => { m[q._type] = (m[q._type]||0)+1; });
  return m;
}

function render(){
  if(!data) return;
  renderChapters();
  renderTypeFilters();
  updateStats();
  const qs = getCurrentQs();
  $('topActions').style.display = qs.length ? 'flex' : 'none';
  if(qs.length===0){
    $('welcome').style.display='block';
    qList.style.display='none';
    if(state.searchQuery) $('welcome').querySelector('p').textContent='未找到匹配题目';
    else if(state.mode==='wrong') { $('welcome').querySelector('h2').textContent='🎉 错题本为空'; $('welcome').querySelector('p').textContent='继续加油！'; }
    else { $('welcome').querySelector('h2').textContent='📖 选择章节开始刷题'; $('welcome').querySelector('p').textContent=data?.info?.title+' · '+(state.searchQuery||'浏览模式'); }
    return;
  }
  $('welcome').style.display='none';
  qList.style.display='block';
  renderCards(qs);
}

function renderChapters(){
  const el = $('chapterList');
  const chShow = state.mode==='wrong' ? 'all' : state.chapter;
  let h = `<button class="chip ${chShow==='all'?'active':''}" data-ch="all">全部<span class="count">${flatQs.length}</span></button>`;
  data.chapters.forEach(ch => {
    const cnt = ch.type_groups.reduce((s,g)=>s+g.questions.length,0);
    h += `<button class="chip ${chShow===ch.name?'active':''}" data-ch="${ch.name}">${ch.name}<span class="count">${cnt}</span></button>`;
  });
  el.innerHTML = h;
  el.querySelectorAll('.chip').forEach(el2 => {
    el2.addEventListener('click', ()=>{
      state.chapter = el2.dataset.ch;
      state.type = 'all';
      state.mode = 'browse';
      state.searchQuery = '';
      $('searchInput').value = '';
      saveState(); render();
    });
  });
}

function renderTypeFilters(){
  const el = $('typeFilters');
  let base;
  if(state.mode==='wrong') base = flatQs.filter(q => state.wrongBook[q._id]);
  else base = state.searchQuery ? searchIn(flatQs, state.searchQuery) :
    (state.chapter==='all' ? flatQs : flatQs.filter(q=>q._chapter===state.chapter));
  const types = countByType(base);
  const order = ['选择题','填空题','判断题','简答题','实操分析题','应急处理题'];
  const sorted = order.filter(t => types[t]);
  const total = base.length;
  if(sorted.length<=1 && state.type==='all'){ el.style.display='none'; return; }
  el.style.display='flex';
  let h = `<button class="type-btn ${state.type==='all'?'active':''}" data-type="all">全部 <span class="count">${total}</span></button>`;
  sorted.forEach(t => {
    h += `<button class="type-btn ${state.type===t?'active':''}" data-type="${t}">${t} <span class="count">${types[t]}</span></button>`;
  });
  el.innerHTML = h;
  el.querySelectorAll('.type-btn').forEach(el2 => {
    el2.addEventListener('click', ()=>{
      state.type = el2.dataset.type;
      saveState(); render();
    });
  });
}

let _currentQs = [];
function renderCards(qs){
  _currentQs = qs;
  const isSearch = state.searchQuery!=='';
  const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();
  let h = `<div id="listInfo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <span style="font-size:13px;color:var(--text2)">共 ${qs.length} 题${isSearch?' (搜索结果)':''}</span>
    <span style="font-size:12px;color:var(--text2)">点击选项/按钮显示答案</span>
  </div>`;
  qs.forEach((q, idx) => {
    const isRevealed = revealed.has(q._id);
    const isWrong = state.wrongBook[q._id];
    const hasNote = localNotes[q._id];
    h += `<div class="q-card" data-id="${q._id}">
      <div class="q-card-header">
        <span class="q-type-badge">${q._type}</span>
        <span class="q-chapter-label">${q._chapter} · #${idx+1}</span>
      </div>
      <div class="q-text">${esc(q.question)}</div>`;
    // Options for 选择题
    if(q.options && q.options.length>0){
      h += `<div class="q-options">`;
      q.options.forEach((opt, oi) => {
        const letter = String.fromCharCode(65+oi);
        const correct = q.answer && q.answer.toUpperCase()===letter;
        let cls = 'opt-row';
        if(isRevealed && correct) cls += ' revealed';
        if(isRevealed && !correct && isWrong) cls += ' wrong';
        h += `<div class="${cls}" data-letter="${letter}">${esc(opt)}</div>`;
      });
      h += `</div>`;
    }
    // Answer
    const isDirect = ['简答题','实操分析题','应急处理题','填空题'].includes(q._type);
    let ansHtml = '';
    if(q._type==='判断题') ansHtml = q.answer==='√' ? '正确 ✓' : '错误 ✗';
    else if(q._type==='选择题') ansHtml = q.answer ? '正确答案：'+q.answer : '⚠ 答案未标注';
    else ansHtml = q.answer || '⚠ 答案未解析';
    const showAns = isDirect || isRevealed;
    h += `<div class="q-answer ${showAns?'visible':''}"><div class="label">📝 参考答案</div>${esc(ansHtml)}</div>`;
    if(!isDirect){
      h += `<button class="q-show-answer-btn" data-id="${q._id}">${isRevealed?'隐藏答案':'显示答案'}</button>`;
    }
    // 登录用户：笔记和报错按钮
    if(isLoggedIn){
      h += `<div class="q-actions">
        <button class="q-action-btn q-note-btn" data-id="${q._id}">${hasNote ? '📝✏️' : '📝'} 笔记</button>
        <button class="q-action-btn q-report-btn" data-id="${q._id}">🐛 报错</button>
      </div>`;
    }
    h += `</div>`;
  });
  qList.innerHTML = h;
  updateTopActions();
  // Event: show/hide answer
  qList.querySelectorAll('.q-show-answer-btn').forEach(btn => {
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const id = this.dataset.id;
      if(revealed.has(id)) revealed.delete(id);
      else revealed.add(id);
      saveState();
      renderCards(qs);
    });
  });
  // Event: opt click (选择题)
  qList.querySelectorAll('.opt-row').forEach(el => {
    el.addEventListener('click', function(){
      const card = this.closest('.q-card');
      const id = card.dataset.id;
      const letter = this.dataset.letter;
      const q = flatQs.find(x => x._id===id);
      if(!q) return;
      const hasAnswer = q.answer && q.answer.trim() !== '';
      const correct = hasAnswer && q.answer.toUpperCase()===letter;
      // Highlight
      card.querySelectorAll('.opt-row').forEach(o => {
        const l = o.dataset.letter;
        if(hasAnswer && l === q.answer) o.classList.add('revealed');
        else if(o===this && !correct) o.classList.add('wrong');
      });
      card.querySelector('.q-answer').classList.add('visible');
      revealed.add(id);
      if(hasAnswer){
        if(!correct) state.wrongBook[id] = true;
        else delete state.wrongBook[id];
      }
      saveState();
      updateTopActions();
      // 云端同步：记录答题 + 更新错题
      logAnswer(q, correct);
    });
  });
  // Event: 笔记按钮
  qList.querySelectorAll('.q-note-btn').forEach(btn => {
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      openNoteModal(this.dataset.id);
    });
  });
  // Event: 报错按钮
  qList.querySelectorAll('.q-report-btn').forEach(btn => {
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      openReportModal(this.dataset.id);
    });
  });
}

/** 云端记录答题结果（仅登录用户） */
function logAnswer(q, isCorrect) {
  if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) return;
  var id = q._id;
  window.Sync.recordAnswer(state.version, id, q._chapter, q._type, isCorrect);
  if (!isCorrect) {
    window.Sync.addWrongQuestion(state.version, id, q._chapter, q._type);
  } else {
    window.Sync.removeWrongQuestion(state.version, id);
  }
}

function updateTopActions(){
  const wc = Object.keys(state.wrongBook).length;
  $('wrongBookBtn').textContent = '❌ 错题 ('+wc+')';
  const shown = _currentQs.filter(q => revealed.has(q._id)).length;
  const total = _currentQs.length;
  $('revealAllBtn').style.display = shown < total ? 'inline-block' : 'none';
  $('hideAllBtn').style.display = shown > 0 ? 'inline-block' : 'none';
}

var _escNode;
function esc(t){ if(!t) return ''; if(!_escNode) _escNode = document.createElement('div'); _escNode.textContent=t; return _escNode.innerHTML; }

function updateStats(){
  if(!data) return;
  const wrong = Object.keys(state.wrongBook).length;
  $('welcomeStats').innerHTML = state.version+' · '+flatQs.length+' 道题 · 错题 '+wrong+' 道';
}

// ============================================================
// 笔记弹窗
// ============================================================
function openNoteModal(questionId) {
  var modal = $('noteModal');
  var textarea = $('noteTextarea');
  var saveBtn = $('noteSaveBtn');
  var deleteBtn = $('noteDeleteBtn');
  if (!modal || !textarea) return;

  // 填充已有内容
  textarea.value = localNotes[questionId] || '';
  modal.dataset.questionId = questionId;
  modal.style.display = 'flex';

  // 保存
  saveBtn.onclick = async function() {
    var content = textarea.value.trim();
    if (!content) {
      // 空内容视为删除
      delete localNotes[questionId];
      if (window.Sync && window.SupabaseAuth && window.SupabaseAuth.isLoggedIn()) {
        await window.Sync.deleteNote(state.version, questionId);
      }
    } else {
      localNotes[questionId] = content;
      if (window.Sync && window.SupabaseAuth && window.SupabaseAuth.isLoggedIn()) {
        await window.Sync.saveNote(state.version, questionId, content);
      }
    }
    modal.style.display = 'none';
    renderCards(_currentQs);  // 刷新笔记图标
  };

  // 删除
  if (deleteBtn) {
    deleteBtn.onclick = async function() {
      delete localNotes[questionId];
      if (window.Sync && window.SupabaseAuth && window.SupabaseAuth.isLoggedIn()) {
        await window.Sync.deleteNote(state.version, questionId);
      }
      modal.style.display = 'none';
      renderCards(_currentQs);
    };
  }
}

// 关闭笔记弹窗
(function() {
  var modal = $('noteModal');
  if (!modal) return;
  $('noteClose').addEventListener('click', function() { modal.style.display = 'none'; });
  $('noteCancel').addEventListener('click', function() { modal.style.display = 'none'; });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
})();

// ============================================================
// 报错弹窗
// ============================================================
function openReportModal(questionId) {
  var modal = $('reportModal');
  if (!modal) return;
  modal.dataset.questionId = questionId;
  modal.style.display = 'flex';
  // 清除上次选择
  modal.querySelectorAll('input[name="reportReason"]').forEach(function(r) { r.checked = false; });
  $('reportDetail').value = '';
  $('reportMsg').textContent = '';
}

(function() {
  var modal = $('reportModal');
  if (!modal) return;
  $('reportClose').addEventListener('click', function() { modal.style.display = 'none'; });
  $('reportCancel').addEventListener('click', function() { modal.style.display = 'none'; });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });

  $('reportSubmit').addEventListener('click', async function() {
    var questionId = modal.dataset.questionId;
    var reasonEl = modal.querySelector('input[name="reportReason"]:checked');
    var detail = $('reportDetail').value.trim();
    var msgEl = $('reportMsg');

    if (!reasonEl) {
      msgEl.textContent = '请选择报错原因';
      return;
    }
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      msgEl.textContent = '请先登录';
      return;
    }

    $('reportSubmit').disabled = true;
    $('reportSubmit').textContent = '提交中...';

    var result = await window.Sync.submitReport(state.version, questionId, reasonEl.value, detail);
    if (result !== null) {
      msgEl.textContent = '✅ 反馈已提交，感谢！';
      setTimeout(function() { modal.style.display = 'none'; }, 1500);
    } else {
      msgEl.textContent = '提交失败，请稍后重试';
    }
    $('reportSubmit').disabled = false;
    $('reportSubmit').textContent = '提交';
  });
})();

// ============================================================
// Search
// ============================================================
$('searchInput').addEventListener('input', ()=>{
  const v = $('searchInput').value.trim();
  $('searchClear').style.display = v ? 'inline' : 'none';
  state.searchQuery = v;
  state.mode = v ? 'search' : 'browse';
  if(v) state.chapter = 'all';
  state.type = 'all';
  saveState(); render();
});
$('searchClear').addEventListener('click', ()=>{
  $('searchInput').value = '';
  $('searchClear').style.display = 'none';
  state.searchQuery = '';
  state.mode = 'browse';
  state.type = 'all';
  saveState(); render();
});

// ============================================================
// Stats modal（支持登录用户拉取云端统计 + Chart.js 图表）
// ============================================================
$('statsBtn').addEventListener('click', async function(){
  const total = flatQs.length;
  const wrong = Object.keys(state.wrongBook).length;
  const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();

  var statsHtml = `
    <div class="stat-row"><span class="stat-label">题库版本</span><span class="stat-value">${state.version}</span></div>
    <div class="stat-row"><span class="stat-label">总题数</span><span class="stat-value">${total}</span></div>
    <div class="stat-row"><span class="stat-label">章节数</span><span class="stat-value">${data.chapters.length}</span></div>
    <div class="stat-row"><span class="stat-label">错题数</span><span class="stat-value">${wrong}</span></div>
    <div class="stat-row"><span class="stat-label">已显示答案</span><span class="stat-value">${revealed.size}</span></div>
  `;

  // 登录用户：显示云端统计和图表
  if (isLoggedIn && window.Sync) {
    var cloudStats = await window.Sync.getStats(state.version);
    if (cloudStats && cloudStats.total > 0) {
      statsHtml += `<div class="stat-divider"></div>
        <div class="stat-row"><span class="stat-label">📊 云端答题总数</span><span class="stat-value">${cloudStats.total}</span></div>
        <div class="stat-row"><span class="stat-label">✅ 正确率</span><span class="stat-value">${cloudStats.accuracy}%</span></div>
        <div class="stat-row"><span class="stat-label">✔ 正确</span><span class="stat-value" style="color:var(--success)">${cloudStats.correct}</span></div>
        <div class="stat-row"><span class="stat-label">✘ 错误</span><span class="stat-value" style="color:var(--danger)">${cloudStats.wrong}</span></div>
      `;
    }
    // 图表容器
    statsHtml += `<div class="stat-divider"></div>
      <div class="chart-container" style="margin-top:12px">
        <canvas id="statsPieChart" width="240" height="240"></canvas>
      </div>`;

    $('statsBody').innerHTML = statsHtml;
    $('statsModal').style.display = 'flex';

    // 渲染 Chart.js 饼图
    renderStatsChart(cloudStats);
  } else {
    $('statsBody').innerHTML = statsHtml;
    $('statsModal').style.display = 'flex';
  }
});
$('statsClose').addEventListener('click', ()=>{ $('statsModal').style.display='none'; });
$('statsModal').addEventListener('click', e=>{ if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });

/** 渲染统计饼图（正确/错误比例） */
function renderStatsChart(cloudStats) {
  if (typeof window.Chart === 'undefined') return;
  var canvas = document.getElementById('statsPieChart');
  if (!canvas) return;

  // 销毁旧图表
  if (canvas._chart) canvas._chart.destroy();

  var correct = (cloudStats && cloudStats.correct) || 0;
  var wrong = (cloudStats && cloudStats.wrong) || 0;
  if (correct === 0 && wrong === 0) {
    correct = 1; wrong = 0;  // 显示空白图表
  }

  canvas._chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['正确', '错误'],
      datasets: [{
        data: [correct, wrong],
        backgroundColor: ['#22c55e', '#ef4444'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 16 } }
      }
    }
  });
}

// Top action buttons
$('wrongBookBtn').addEventListener('click', ()=>{
  state.mode = 'wrong';
  state.chapter = 'all'; state.type = 'all'; state.searchQuery = '';
  $('searchInput').value = '';
  saveState(); render();
});

$('revealAllBtn').addEventListener('click', ()=>{
  _currentQs.forEach(q => revealed.add(q._id));
  saveState(); renderCards(_currentQs);
});
$('hideAllBtn').addEventListener('click', ()=>{
  _currentQs.forEach(q => revealed.delete(q._id));
  saveState(); renderCards(_currentQs);
});

// Shared helper: reset all view filters (used by both entry paths)
function resetViewState(){
  state.chapter = 'all';
  state.type = 'all';
  state.searchQuery = '';
  state.mode = 'browse';
  $('searchInput').value = '';
}

// Version switch (header buttons)
function switchVersion(ver){
  if(state.version === ver) return;
  resetViewState();
  loadData(ver);
}

$('verWaic').addEventListener('click', function(){ switchVersion('外操版'); });
$('verNei').addEventListener('click', function(){ switchVersion('内操版'); });
// ===== Entry Overlay =====
(function initOverlay() {
  const overlay = document.getElementById('entryOverlay');
  if (!overlay) return;

  const cards = overlay.querySelectorAll('.overlay-card');

  function handleVersionSelect(ver) {
    state.version = ver;
    resetViewState();

    overlay.classList.add('exit');
    overlay.querySelectorAll('.overlay-card').forEach(c => c.style.pointerEvents = 'none');

    setTimeout(() => {
      loadData(ver);
    }, 100);

    setTimeout(() => {
      overlay.classList.add('hide');
      overlay.classList.remove('exit');
    }, 650);
  }

  cards.forEach(card => {
    card.addEventListener('click', function(e) {
      if (this.classList.contains('clicked')) return;
      this.classList.add('clicked');

      const rect = this.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      this.style.position = 'relative';
      this.style.overflow = 'hidden';
      this.appendChild(ripple);

      handleVersionSelect(this.dataset.ver);
    });
  });
})();

// Init
loadState();
// 启动认证状态监听
initAuthSync();
})();
