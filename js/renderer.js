 (function(){
'use strict';
if (typeof window.State === 'undefined') throw new Error('state.js must be loaded before renderer.js');

let _currentQuestions = [];
 
 function getCurrentQs(){
   let st = State.get();
   let fqs = State.flatQs;
   if(st.mode === 'wrong'){
     return fqs.filter(function(q){ return State.isWrong(q._id); });
   }
   let list = st.searchQuery ? searchIn(fqs, st.searchQuery) :
     (st.chapter === 'all' ? fqs : fqs.filter(function(q){ return q._chapter === st.chapter; }));
   if(st.type !== 'all') list = list.filter(function(q){ return q._type === st.type; });
   return list;
 }
 
 function searchIn(arr, query){
   let q = query.toLowerCase();
   return arr.filter(function(item){
     return [item.question, item.answer, item._chapter, item._type].concat(item.options||[]).join(' ').toLowerCase().includes(q);
   });
 }
 
 function countByType(arr){
   let m = {};
   arr.forEach(function(q){ m[q._type] = (m[q._type]||0)+1; });
   return m;
 }
 
 function render(){
   if(!State.data) return;
   renderChapters();
   renderTypeFilters();
   updateStats();
   let qs = getCurrentQs();
    let $ = State.getEl;
   let highlightText = State.highlightText;
   $('topActions').style.display = qs.length ? 'flex' : 'none';
   if(qs.length === 0){
     $('welcome').style.display = 'block';
     $('questionList').style.display = 'none';
     if(State.get().searchQuery) $('welcome').querySelector('p').textContent = '未找到匹配题目';
     else if(State.get().mode === 'wrong') { $('welcome').querySelector('h2').textContent = '🎉 错题本为空'; $('welcome').querySelector('p').textContent = '继续加油！'; }
     else { $('welcome').querySelector('h2').textContent = '📖 选择章节开始刷题'; $('welcome').querySelector('p').textContent = (State.data.info ? State.data.info.title : '') + ' · ' + (State.get().searchQuery || '浏览模式'); }
     return;
   }
   $('welcome').style.display = 'none';
   $('questionList').style.display = 'block';
   renderCards(qs);
 }
 
 function renderChapters(){
   let el = State.$('chapterList');
   let st = State.get();
   let chShow = st.mode === 'wrong' ? 'all' : st.chapter;
   let h = '<button class="chip ' + (chShow === 'all' ? 'active' : '') + '" data-ch="all">全部<span class="count">' + State.flatQs.length + '</span></button>';
   State.data.chapters.forEach(function(ch){
     let cnt = ch.type_groups.reduce(function(s,g){ return s + g.questions.length; }, 0);
     h += '<button class="chip ' + (chShow === ch.name ? 'active' : '') + '" data-ch="' + ch.name + '">' + ch.name + '<span class="count">' + cnt + '</span></button>';
   });
   el.innerHTML = h;
   el.querySelectorAll('.chip').forEach(function(el2){
     el2.addEventListener('click', function(){
       State.setMulti({ chapter: el2.dataset.ch, type: 'all', mode: 'browse', searchQuery: '' });
       State.$('searchInput').value = '';
       render();
     });
   });
 }
 
 function renderTypeFilters(){
   let el = State.$('typeFilters');
   let st = State.get();
   let base;
   if(st.mode === 'wrong') base = State.flatQs.filter(function(q){ return State.isWrong(q._id); });
   else base = st.searchQuery ? searchIn(State.flatQs, st.searchQuery) :
     (st.chapter === 'all' ? State.flatQs : State.flatQs.filter(function(q){ return q._chapter === st.chapter; }));
   let types = countByType(base);
  let order = State.QUESTION_TYPES;
   let sorted = order.filter(function(t){ return types[t]; });
   let total = base.length;
   if(sorted.length <= 1 && st.type === 'all'){ el.style.display = 'none'; return; }
   el.style.display = 'flex';
   let h = '<button class="type-btn ' + (st.type === 'all' ? 'active' : '') + '" data-type="all">全部 <span class="count">' + total + '</span></button>';
   sorted.forEach(function(t){
     h += '<button class="type-btn ' + (st.type === t ? 'active' : '') + '" data-type="' + t + '">' + t + ' <span class="count">' + types[t] + '</span></button>';
   });
   el.innerHTML = h;
   el.querySelectorAll('.type-btn').forEach(function(el2){
     el2.addEventListener('click', function(){ State.set('type', el2.dataset.type); render(); });
   });
 }
 
 function renderCards(qs){
   _currentQuestions = qs;
   let st = State.get();
   let isSearch = st.searchQuery !== '';
   let isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();
   let $ = State.$;
   let h = '<div id="listInfo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
     '<span style="font-size:13px;color:var(--text2)">共 ' + qs.length + ' 题' + (isSearch ? ' (搜索结果)' : '') + '</span>' +
     '<span style="font-size:12px;color:var(--text2)">点击选项/按钮显示答案</span></div>';
   qs.forEach(function(q, idx){
     let isRevealed = State.isRevealed(q._id);
     let isWrong = State.isWrong(q._id);
     let notes = State.getLocalNotes();
     let hasNote = notes[q._id];
     h += '<div class="q-card" data-id="' + q._id + '">' +
       '<div class="q-card-header"><span class="q-type-badge">' + q._type + '</span><span class="q-chapter-label">' + q._chapter + ' · #' + (idx+1) + '</span></div>' +
       '<div class="q-text">' + highlightText(q.question, st.searchQuery) + '</div>';
     if(q.options && q.options.length > 0){
       h += '<div class="q-options">';
       q.options.forEach(function(opt, oi){
         let letter = String.fromCharCode(65+oi);
         let correct = q.answer && q.answer.toUpperCase() === letter;
         let cls = 'opt-row';
         if(isRevealed && correct) cls += ' revealed';
         if(isRevealed && !correct && isWrong) cls += ' wrong';
         h += '<div class="' + cls + '" data-letter="' + letter + '">' + highlightText(opt, st.searchQuery) + '</div>';
       });
       h += '</div>';
     }
    let isDirect = State.DIRECT_TYPES.indexOf(q._type) >= 0;
     let ansHtml = '';
     if(q._type === '判断题') ansHtml = q.answer === '√' ? '正确 ✓' : '错误 ✗';
     else if(q._type === '选择题') ansHtml = q.answer ? '正确答案：' + q.answer : '⚠ 答案未标注';
     else ansHtml = q.answer || '⚠ 答案未解析';
     let showAns = isDirect || isRevealed;
     h += '<div class="q-answer ' + (showAns ? 'visible' : '') + '"><div class="label">📝 参考答案</div>' + highlightText(ansHtml, st.searchQuery) + '</div>';
     if(!isDirect){
       h += '<button class="q-show-answer-btn" data-id="' + q._id + '">' + (isRevealed ? '隐藏答案' : '显示答案') + '</button>';
     }
     if(isLoggedIn){
       h += '<div class="q-actions">' +
         '<button class="q-action-btn q-note-btn" data-id="' + q._id + '">' + (hasNote ? '📝✏️' : '📝') + ' 笔记</button>' +
         '<button class="q-action-btn q-report-btn" data-id="' + q._id + '">🐛 报错</button></div>';
     }
     h += '</div>';
   });
   $('questionList').innerHTML = h;
   updateTopActions();
 }
 
 /** 云端记录答题结果（仅登录用户） */
 function logAnswer(q, isCorrect){
   if(!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) return;
   window.Sync.recordAnswer(State.get().version, q._id, q._chapter, q._type, isCorrect);
   if(!isCorrect) window.Sync.addWrongQuestion(State.get().version, q._id, q._chapter, q._type);
   else if(State.isWrong(q._id)) window.Sync.removeWrongQuestion(State.get().version, q._id);
 }
 
 function updateTopActions(){
   let wc = State.wrongCount();
   State.$('wrongBookBtn').textContent = '❌ 错题 (' + wc + ')';
   let shown = _currentQuestions.filter(function(q){ return State.isRevealed(q._id); }).length;
   let total = _currentQuestions.length;
   State.$('revealAllBtn').style.display = shown < total ? 'inline-block' : 'none';
   State.$('hideAllBtn').style.display = shown > 0 ? 'inline-block' : 'none';
 }
 
 function updateStats(){
   if(!State.data) return;
   State.$('welcomeStats').innerHTML = State.get().version + ' · ' + State.flatQs.length + ' 道题 · 错题 ' + State.wrongCount() + ' 道';
 }
 
 /** 渲染统计饼图 */
 function renderStatsChart(cloudStats){
   if(typeof window.Chart === 'undefined') return;
   let canvas = document.getElementById('statsPieChart');
   if(!canvas) return;
   if(canvas._chart) canvas._chart.destroy();
   let correct = (cloudStats && cloudStats.correct) || 0;
   let wrong = (cloudStats && cloudStats.wrong) || 0;
   if(correct === 0 && wrong === 0){
     let ctx = canvas.getContext('2d');
     if(ctx){
       ctx.clearRect(0,0,canvas.width,canvas.height);
       ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
       ctx.fillStyle = '#94a3b8';
       ctx.textAlign = 'center';
       ctx.fillText('暂无答题记录', canvas.width/2, canvas.height/2);
     }
     return;
   }
   canvas._chart = new window.Chart(canvas, {
     type: 'doughnut',
     data: { labels: ['正确','错误'], datasets: [{ data: [correct,wrong], backgroundColor: ['#22c55e','#ef4444'], borderWidth:0 }] },
     options: { responsive: true, plugins: { legend: { position:'bottom', labels: { font:{size:12}, padding:16 } } } }
   });
 }
 
 // ============================================================
 // 公开 API
 // ============================================================
 window.Render = {
   render: render,
   renderCards: renderCards,
   renderChapters: renderChapters,
   renderTypeFilters: renderTypeFilters,
   renderStatsChart: renderStatsChart,
   updateTopActions: updateTopActions,
   updateStats: updateStats,
   getCurrentQs: function(){ return _currentQuestions; },
   setCurrentQs: function(qs){ _currentQuestions = qs; },
   logAnswer: logAnswer
 };
 })();

