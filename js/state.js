(function () {
  'use strict';

  // ============================================================
  // 共享数据引用（由 app.js 设置）
  // ============================================================
  let _globalData = null;
  let _globalFlatQs = [];

  // ============================================================
  // 全局状态
  // ============================================================
  const _state = {
    version: '外操版',
    chapter: 'all',
    type: 'all',
    searchQuery: '',
    mode: 'browse',
    wrongBook: {},
    stats: {},
  };
  let _revealed = new Set();
  const _localNotes = {};
  const _reportedQuestions = {};

  // ============================================================
  // DOM / localStorage 辅助
  // ============================================================
  function getEl(id) {
    return document.getElementById(id);
  }
  function _loadFromStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      /* silent */
    }
    return null;
  }
  function _saveToStorage(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {
      /* silent */
    }
  }

  // ============================================================
  // 状态持久化
  // ============================================================
  function _load() {
    const s = _loadFromStorage('ysk_state');
    if (s) {
      for (const k in s) {
        _state[k] = s[k];
      }
    }
    const wb = _loadFromStorage('ysk_wrong_' + _state.version);
    if (wb) {
      _state.wrongBook = wb;
    } else if (Object.keys(_state.wrongBook).length === 0) {
      _state.wrongBook = {};
    }
    const r = _loadFromStorage('ysk_revealed');
    if (r) {
      _revealed = new Set(r);
    }
  }

  function _save() {
    const rest = {};
    for (const k in _state) {
      if (k !== 'wrongBook' && _state.hasOwnProperty(k)) {
        rest[k] = _state[k];
      }
    }
    _saveToStorage('ysk_state', rest);
    _saveToStorage('ysk_wrong_' + _state.version, _state.wrongBook);
    _saveToStorage('ysk_revealed', [..._revealed]);
  }

  // ============================================================
  // HTML 转义 & 搜索高亮
  // ============================================================
  let _escNode;
  function escapeHtml(t) {
    if (!t) {
      return '';
    }
    if (!_escNode) {
      _escNode = document.createElement('div');
    }
    _escNode.textContent = t;
    return _escNode.innerHTML;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightText(text, query) {
    if (!query) {
      return escapeHtml(text);
    }
    const regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
    const parts = String(text).split(regex);
    return parts
      .map(function (p) {
        return p.toLowerCase() === query.toLowerCase()
          ? '<mark>' + escapeHtml(p) + '</mark>'
          : escapeHtml(p);
      })
      .join('');
  }

  // ============================================================
  // 防抖
  // ============================================================
  function debounce(fn, ms) {
    let timer;
    return function () {
      const ctx = this,
        a = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, a);
      }, ms);
    };
  }

  // ============================================================
  // 公开 API
  // ============================================================
  const QUESTION_TYPES = ['选择题', '填空题', '判断题', '简答题', '实操分析题', '应急处理题'];
  const DIRECT_TYPES = ['简答题', '实操分析题', '应急处理题', '填空题'];

  window.State = {
    // 数据引用（由 app.js buildFlat 设置）
    get data() {
      return _globalData;
    },
    set data(v) {
      _globalData = v;
    },
    get flatQs() {
      return _globalFlatQs;
    },
    set flatQs(v) {
      _globalFlatQs = v;
    },

    // 状态对象
    get: function () {
      return _state;
    },
    set: function (k, v) {
      _state[k] = v;
      _save();
    },
    setMulti: function (obj) {
      for (const k in obj) {
        _state[k] = obj[k];
      }
      _save();
    },

    // 答案揭示集合
    getRevealed: function () {
      return _revealed;
    },
    isRevealed: function (id) {
      return _revealed.has(id);
    },
    toggleRevealed: function (id) {
      if (_revealed.has(id)) {
        _revealed.delete(id);
      } else {
        _revealed.add(id);
      }
      _save();
    },

    // 错题本
    isWrong: function (id) {
      return !!_state.wrongBook[id];
    },
    addWrong: function (id) {
      _state.wrongBook[id] = true;
      _save();
    },
    removeWrong: function (id) {
      delete _state.wrongBook[id];
      _save();
    },
    wrongCount: function () {
      return Object.keys(_state.wrongBook).length;
    },
    getWrongBook: function () {
      return _state.wrongBook;
    },
    setWrongBook: function (wb) {
      _state.wrongBook = wb;
      _save();
    },

    // 笔记 & 报错
    getLocalNotes: function () {
      return _localNotes;
    },
    setLocalNote: function (id, c) {
      if (c) {
        _localNotes[id] = c;
      } else {
        delete _localNotes[id];
      }
    },
    getReportedQuestions: function () {
      return _reportedQuestions;
    },
    markReported: function (id) {
      _reportedQuestions[id] = true;
    },

    // 持久化
    load: _load,
    save: _save,

    // 工具函数
    $: getEl,
    getEl: getEl,
    esc: escapeHtml,
    escapeHtml: escapeHtml,
    highlightText: highlightText,
    debounce: debounce,
    QUESTION_TYPES: QUESTION_TYPES,
    DIRECT_TYPES: DIRECT_TYPES,
  };
})();
