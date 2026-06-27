(function(){
'use strict';

let data = null;
let flatQs = [];
let revealed = new Set();
let state = { version:'外操版', chapter:'all', type:'all', searchQuery:'', mode:'browse', wrongBook:{}, stats:{} };

const $ = id => document.getElementById(id);
const qList = $('questionList');

function ls(key){ try{ return JSON.parse(localStorage.getItem(key)) }catch(e){} return null }
function lss(key,v){ try{ localStorage.setItem(key, JSON.stringify(v)) }catch(e){} }

function loadState(){
  const s = ls('ysk_state');
  if(s) Object.assign(state, s);
  // Per-version wrongBook; migrate legacy data from old single-key format
  const wb = ls('ysk_wrong_' + state.version);
  if(wb) {
    state.wrongBook = wb;
  } else if (!state.wrongBook || Object.keys(state.wrongBook).length === 0) {
    // No per-version key and no legacy data — start fresh
    state.wrongBook = {};
  }
  // else: preserve wrongBook Object.assign copied from legacy ysk_state (migration path)
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
    state.version = ver;
    // Update header toggle to reflect the loaded version (only after successful load)
    if(ver === '外操版'){
      $('verWaic').classList.add('active');
      $('verNei').classList.remove('active');
    } else {
      $('verNei').classList.add('active');
      $('verWaic').classList.remove('active');
    }
    // Load per-version wrongBook
    const wb = ls('ysk_wrong_' + ver);
    if(wb) state.wrongBook = wb;
    else state.wrongBook = {};
    if(state.chapter!='all' && !data.chapters.find(c=>c.name===state.chapter)) state.chapter='all';
    saveState();
    render();
  } catch(e){
    $('welcomeStats').textContent='加载失败，请检查网络连接后刷新页面重试';
    console.error('loadData error:', e);
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
  if(!data) return; // guard against render before data loads
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
  let h = `<div id="listInfo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <span style="font-size:13px;color:var(--text2)">共 ${qs.length} 题${isSearch?' (搜索结果)':''}</span>
    <span style="font-size:12px;color:var(--text2)">点击选项/按钮显示答案</span>
  </div>`;
  qs.forEach((q, idx) => {
    const isRevealed = revealed.has(q._id);
    const isWrong = state.wrongBook[q._id];
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
    });
  });
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

// Search
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

// Stats modal
$('statsBtn').addEventListener('click', ()=>{
  const total = flatQs.length;
  const wrong = Object.keys(state.wrongBook).length;
  $('statsBody').innerHTML = `
    <div class="stat-row"><span class="stat-label">题库版本</span><span class="stat-value">${state.version}</span></div>
    <div class="stat-row"><span class="stat-label">总题数</span><span class="stat-value">${total}</span></div>
    <div class="stat-row"><span class="stat-label">章节数</span><span class="stat-value">${data.chapters.length}</span></div>
    <div class="stat-row"><span class="stat-label">错题数</span><span class="stat-value">${wrong}</span></div>
    <div class="stat-row"><span class="stat-label">已显示答案</span><span class="stat-value">${revealed.size}</span></div>
  `;
  $('statsModal').style.display = 'flex';
});
$('statsClose').addEventListener('click', ()=>{ $('statsModal').style.display='none'; });
$('statsModal').addEventListener('click', e=>{ if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });

// Top action buttons
$('wrongBookBtn').addEventListener('click', ()=>{
  state.mode = 'wrong';
  state.chapter = 'all'; state.type = 'all'; state.searchQuery = '';
  $('searchInput').value = '';
  saveState(); render();
});
$('shuffleBtn').addEventListener('click', ()=>{
  if(!_currentQs.length) return;
  const qs = [..._currentQs];
  for(let i=qs.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  renderCards(qs);
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
    // Reset filters and set target version; wrongBook is NOT cleared here —
    // loadData restores the per-version wrongBook from localStorage.
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
})();
