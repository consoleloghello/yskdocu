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
  /** 通过 ID 获取 DOM 元素 */
  function getEl(id) {
    return document.getElementById(id);
  }
  /** 从 localStorage 读取并解析 JSON，解析失败或不存在时返回 null */
  function _loadFromStorage(storageKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey));
    } catch (e) {
      // JSON 格式损坏时静默处理
    }
    return null;
  }
  /** 将值序列化为 JSON 写入 localStorage，捕获 QuotaExceededError 等异常 */
  function _saveToStorage(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (e) {
      // 存储空间满或隐私模式下静默失败
    }
  }

  // ============================================================
  // 状态持久化
  // ============================================================
  function _loadState() {
    const savedState = _loadFromStorage('ysk_state');
    if (savedState) {
      for (const key in savedState) {
        _state[key] = savedState[key];
      }
    }
    const wrongBookData = _loadFromStorage('ysk_wrong_' + _state.version);
    if (wrongBookData) {
      _state.wrongBook = wrongBookData;
    } else if (Object.keys(_state.wrongBook).length === 0) {
      _state.wrongBook = {};
    }
    const revealedData = _loadFromStorage('ysk_revealed');
    if (revealedData) {
      _revealed = new Set(revealedData);
    }
  }

  function _saveState() {
    const stateWithoutWrongBook = {};
    for (const key in _state) {
      if (key !== 'wrongBook' && _state.hasOwnProperty(key)) {
        stateWithoutWrongBook[key] = _state[key];
      }
    }
    _saveToStorage('ysk_state', stateWithoutWrongBook);
    _saveToStorage('ysk_wrong_' + _state.version, _state.wrongBook);
    _saveToStorage('ysk_revealed', [..._revealed]);
  }

  // ============================================================
  // HTML 转义 & 搜索高亮
  // ============================================================
  // 利用 DOM 节点的 textContent → innerHTML 机制安全转义 HTML 特殊字符
  // 避免 XSS 攻击，比正则替换更可靠
  let _escapeDiv;
  function escapeHtml(text) {
    if (!text) {
      return '';
    }
    if (!_escapeDiv) {
      _escapeDiv = document.createElement('div');
    }
    _escapeDiv.textContent = text;
    return _escapeDiv.innerHTML;
  }

  /**
   * 转义 HTML 属性值：escapeHtml 基于 textContent→innerHTML，浏览器序列化时不转义引号，
   * 拼接进 data-* 等属性值时会破坏属性边界，需在此额外转义双引号和单引号
   */
  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
      .map(function (part) {
        return part.toLowerCase() === query.toLowerCase()
          ? '<mark>' + escapeHtml(part) + '</mark>'
          : escapeHtml(part);
      })
      .join('');
  }

  // ============================================================
  // 防抖
  // ============================================================
  function debounce(fn, delayMs) {
    let timer;
    return function () {
      const context = this,
        args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delayMs);
    };
  }

  // ============================================================
  // 公开 API
  // ============================================================
  const QUESTION_TYPES = ['选择题', '填空题', '判断题', '简答题', '实操分析题', '应急处理题'];
  const DIRECT_TYPES = ['简答题', '实操分析题', '应急处理题', '填空题'];

  // ============================================================
  // CSS 类名常量 — 集中定义以便修改
  // ============================================================
  const CSS = {
    // 导航 & 筛选
    CHIP: 'chip',
    ACTIVE: 'active',
    COUNT: 'count',
    TYPE_BTN: 'type-btn',
    // 题目卡片
    Q_CARD: 'q-card',
    Q_CARD_HEADER: 'q-card-header',
    Q_TYPE_BADGE: 'q-type-badge',
    Q_CHAPTER_LABEL: 'q-chapter-label',
    Q_TEXT: 'q-text',
    Q_OPTIONS: 'q-options',
    OPT_ROW: 'opt-row',
    REVEALED: 'revealed',
    WRONG: 'wrong',
    Q_ANSWER: 'q-answer',
    VISIBLE: 'visible',
    LABEL: 'label',
    Q_SHOW_ANSWER_BTN: 'q-show-answer-btn',
    Q_ACTIONS: 'q-actions',
    Q_ACTION_BTN: 'q-action-btn',
    Q_NOTE_BTN: 'q-note-btn',
    Q_REPORT_BTN: 'q-report-btn',
    // 版本切换 & 入口
    VER_BTN: 'ver-btn',
    OVERLAY_CARD: 'overlay-card',
    RIPPLE: 'ripple',
    CLICKED: 'clicked',
    EXIT: 'exit',
    HIDE: 'hide',
    // 弹窗
    MODAL_CLOSE: 'modal-close',
    DISMISS_ATTR: 'data-dismiss',
  };

  window.State = {
    // 数据引用（由 app.js buildFlat 设置）
    get data() {
      return _globalData;
    },
    set data(value) {
      _globalData = value;
    },
    get flatQs() {
      return _globalFlatQs;
    },
    set flatQs(value) {
      _globalFlatQs = value;
    },

    // 状态对象
    get: function () {
      return _state;
    },
    set: function (key, value) {
      _state[key] = value;
      _saveState();
    },
    setMulti: function (obj) {
      for (const key in obj) {
        _state[key] = obj[key];
      }
      _saveState();
    },

    // 答案揭示集合
    getRevealed: function () {
      return _revealed;
    },
    isRevealed: function (questionId) {
      return _revealed.has(questionId);
    },
    toggleRevealed: function (questionId) {
      if (_revealed.has(questionId)) {
        _revealed.delete(questionId);
      } else {
        _revealed.add(questionId);
      }
      _saveState();
    },

    // 错题本
    isWrong: function (questionId) {
      return !!_state.wrongBook[questionId];
    },
    addWrong: function (questionId) {
      _state.wrongBook[questionId] = true;
      _saveState();
    },
    removeWrong: function (questionId) {
      delete _state.wrongBook[questionId];
      _saveState();
    },
    /** 返回错题数量（Object.keys 比维护计数器更可靠，避免溢出） */
    wrongCount: function () {
      return Object.keys(_state.wrongBook).length;
    },
    getWrongBook: function () {
      return _state.wrongBook;
    },
    setWrongBook: function (wrongBookObj) {
      _state.wrongBook = wrongBookObj;
      _saveState();
    },

    // 笔记 & 报错
    getLocalNotes: function () {
      return _localNotes;
    },
    setLocalNote: function (questionId, content) {
      if (content) {
        _localNotes[questionId] = content;
      } else {
        delete _localNotes[questionId];
      }
    },
    getReportedQuestions: function () {
      return _reportedQuestions;
    },
    markReported: function (questionId) {
      _reportedQuestions[questionId] = true;
    },

    // 持久化
    load: _loadState,
    save: _saveState,

    // 工具函数
    $: getEl,
    getEl: getEl,
    esc: escapeHtml,
    escapeHtml: escapeHtml,
    escAttr: escapeAttr,
    escapeAttr: escapeAttr,
    highlightText: highlightText,
    debounce: debounce,
    QUESTION_TYPES: QUESTION_TYPES,
    DIRECT_TYPES: DIRECT_TYPES,
    CSS: CSS,
  };
})();
