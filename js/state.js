 (function(){
 'use strict';
 
 // ============================================================
 // 共享数据引用（由 app.js 设置）
 // ============================================================
 var _globalData = null;
 var _globalFlatQs = [];
 
 // ============================================================
 // 全局状态
 // ============================================================
 var _state = { version:'外操版', chapter:'all', type:'all', searchQuery:'', mode:'browse', wrongBook:{}, stats:{} };
 var _revealed = new Set();
 var _localNotes = {};
 var _reportedQuestions = {};
 
 // ============================================================
 // DOM / localStorage 辅助
 // ============================================================
 function getEl(id){ return document.getElementById(id); }
 function _loadFromStorage(key){ try{ return JSON.parse(localStorage.getItem(key)) }catch(e){} return null }
 function _saveToStorage(key,v){ try{ localStorage.setItem(key, JSON.stringify(v)) }catch(e){} }
 
 // ============================================================
 // 状态持久化
 // ============================================================
 function _load(){
   var s = _loadFromStorage('ysk_state');
   if(s) for(var k in s) _state[k] = s[k];
   var wb = _loadFromStorage('ysk_wrong_' + _state.version);
   if(wb) _state.wrongBook = wb;
   else if(Object.keys(_state.wrongBook).length === 0) _state.wrongBook = {};
   var r = _loadFromStorage('ysk_revealed');
   if(r) _revealed = new Set(r);
 }
 
 function _save(){
   var rest = {};
   for(var k in _state) if(k !== 'wrongBook' && _state.hasOwnProperty(k)) rest[k] = _state[k];
   _saveToStorage('ysk_state', rest);
   _saveToStorage('ysk_wrong_' + _state.version, _state.wrongBook);
   _saveToStorage('ysk_revealed', [..._revealed]);
 }
 
 // ============================================================
 // HTML 转义 & 搜索高亮
 // ============================================================
 var _escNode;
 function escapeHtml(t){ if(!t) return ''; if(!_escNode) _escNode = document.createElement('div'); _escNode.textContent=t; return _escNode.innerHTML; }
 
 function escapeRegex(str){ return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
 
 function highlightText(text, query){
   if(!query) return escapeHtml(text);
   var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
   var parts = String(text).split(regex);
   return parts.map(function(p){
     return p.toLowerCase() === query.toLowerCase() ? '<mark>' + escapeHtml(p) + '</mark>' : escapeHtml(p);
   }).join('');
 }
 
 // ============================================================
 // 防抖
 // ============================================================
 function debounce(fn, ms){
   var timer;
   return function(){ var ctx=this, a=arguments; clearTimeout(timer); timer=setTimeout(function(){ fn.apply(ctx,a); }, ms); };
 }
 
 // ============================================================
 // 公开 API
 // ============================================================
 window.State = {
   // 数据引用（由 app.js buildFlat 设置）
   get data() { return _globalData; },
   set data(v) { _globalData = v; },
   get flatQs() { return _globalFlatQs; },
   set flatQs(v) { _globalFlatQs = v; },
 
   // 状态对象
   get: function(){ return _state; },
   set: function(k,v){ _state[k]=v; _save(); },
   setMulti: function(obj){ for(var k in obj) _state[k]=obj[k]; _save(); },
 
   // 答案揭示集合
   getRevealed: function(){ return _revealed; },
   isRevealed: function(id){ return _revealed.has(id); },
   toggleRevealed: function(id){ if(_revealed.has(id)) _revealed.delete(id); else _revealed.add(id); _save(); },
 
   // 错题本
   isWrong: function(id){ return !!_state.wrongBook[id]; },
   addWrong: function(id){ _state.wrongBook[id]=true; _save(); },
   removeWrong: function(id){ delete _state.wrongBook[id]; _save(); },
   wrongCount: function(){ return Object.keys(_state.wrongBook).length; },
   getWrongBook: function(){ return _state.wrongBook; },
   setWrongBook: function(wb){ _state.wrongBook=wb; _save(); },
 
   // 笔记 & 报错
   getLocalNotes: function(){ return _localNotes; },
   setLocalNote: function(id,c){ if(c) _localNotes[id]=c; else delete _localNotes[id]; },
   getReportedQuestions: function(){ return _reportedQuestions; },
   markReported: function(id){ _reportedQuestions[id]=true; },
 
   // 持久化
   load: _load,
   save: _save,
 
   // 工具函数
   $: getEl,
   getEl: getEl,
   esc: escapeHtml,
   escapeHtml: escapeHtml,
   highlightText: highlightText,
   debounce: debounce
 };
 })();
