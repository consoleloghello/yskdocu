(function () {
  'use strict';
  if (typeof window.State === 'undefined') {
    throw new Error('state.js must be loaded before renderer.js');
  }

  let _currentQuestions = [];

  function getCurrentQs() {
    const st = State.get();
    const fqs = State.flatQs;
    if (st.mode === 'wrong') {
      return fqs.filter(function (q) {
        return State.isWrong(q._id);
      });
    }
    let list = st.searchQuery
      ? searchIn(fqs, st.searchQuery)
      : st.chapter === 'all'
        ? fqs
        : fqs.filter(function (q) {
            return q._chapter === st.chapter;
          });
    if (st.type !== 'all') {
      list = list.filter(function (q) {
        return q._type === st.type;
      });
    }
    return list;
  }

  function searchIn(arr, query) {
    const q = query.toLowerCase();
    return arr.filter(function (item) {
      return [item.question, item.answer, item._chapter, item._type]
        .concat(item.options || [])
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }

  function countByType(arr) {
    const m = {};
    arr.forEach(function (q) {
      m[q._type] = (m[q._type] || 0) + 1;
    });
    return m;
  }

  function render() {
    if (!State.data) {
      return;
    }
    renderChapters();
    renderTypeFilters();
    updateStats();
    const qs = getCurrentQs();
    const $ = State.getEl;
    $('topActions').style.display = qs.length ? 'flex' : 'none';
    if (qs.length === 0) {
      $('welcome').style.display = 'block';
      $('questionList').style.display = 'none';
      if (State.get().searchQuery) {
        $('welcome').querySelector('p').textContent = '未找到匹配题目';
      } else if (State.get().mode === 'wrong') {
        $('welcome').querySelector('h2').textContent = '🎉 错题本为空';
        $('welcome').querySelector('p').textContent = '继续加油！';
      } else {
        $('welcome').querySelector('h2').textContent = '📖 选择章节开始刷题';
        $('welcome').querySelector('p').textContent =
          (State.data.info ? State.data.info.title : '') +
          ' · ' +
          (State.get().searchQuery || '浏览模式');
      }
      return;
    }
    $('welcome').style.display = 'none';
    $('questionList').style.display = 'block';
    renderCards(qs);
  }

  function renderChapters() {
    const el = State.$('chapterList');
    const st = State.get();
    const chShow = st.mode === 'wrong' ? 'all' : st.chapter;
    const C = State.CSS;
    let h =
      '<button class="' + C.CHIP + ' ' + (chShow === 'all' ? C.ACTIVE : '') + '" data-ch="all">全部<span class="' + C.COUNT + '">' + State.flatQs.length + '</span></button>';
      State.data.chapters.forEach(function (ch) {
        const cnt = ch.type_groups.reduce(function (s, g) {
        return s + g.questions.length;
      }, 0);
      h +=
        '<button class="' + C.CHIP + ' ' + (chShow === ch.name ? C.ACTIVE : '') + '" data-ch="' + ch.name +  '">' + ch.name + '<span class="' + C.COUNT + '">' + cnt + '</span></button>';
    });
    el.innerHTML = h;
    el.querySelectorAll('.' + C.CHIP).forEach(function (el2) {
      // 滑动到激活的按钮
      if (el2.className == C.CHIP + " " + C.ACTIVE) {
        el2.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      }
      el2.addEventListener('click', function () {
        State.setMulti({ chapter: el2.dataset.ch, type: 'all', mode: 'browse', searchQuery: '' });
        State.$('searchInput').value = '';
        el2.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
        render();
      });
    });
  }

  function renderTypeFilters() {
    const el = State.$('typeFilters');
    const st = State.get();
    const C = State.CSS;
    let base;
    if (st.mode === 'wrong') {
      base = State.flatQs.filter(function (q) {
        return State.isWrong(q._id);
      });
    } else {
      base = st.searchQuery
        ? searchIn(State.flatQs, st.searchQuery)
        : st.chapter === 'all'
          ? State.flatQs
          : State.flatQs.filter(function (q) {
              return q._chapter === st.chapter;
            });
    }
    const types = countByType(base);
    const order = State.QUESTION_TYPES;
    const sorted = order.filter(function (t) {
      return types[t];
    });
    const total = base.length;
    if (sorted.length <= 1 && st.type === 'all') {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    let h =
      '<button class="' + C.TYPE_BTN + ' ' +
      (st.type === 'all' ? C.ACTIVE : '') +
      '" data-type="all">全部 <span class="' + C.COUNT + '">' +
      total +
      '</span></button>';
    sorted.forEach(function (t) {
      h +=
        '<button class="' + C.TYPE_BTN + ' ' +
        (st.type === t ? C.ACTIVE : '') +
        '" data-type="' +
        t +
        '">' +
        t +
        ' <span class="' + C.COUNT + '">' +
        types[t] +
        '</span></button>';
    });
    el.innerHTML = h;
    el.querySelectorAll('.' + C.TYPE_BTN).forEach(function (el2) {
      // 滑动到激活的按钮
      if (el2.className == C.TYPE_BTN + " " + C.ACTIVE) {
        el2.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      }
      el2.addEventListener('click', function () {
        State.set('type', el2.dataset.type);
        el2.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
        render();
      });
    });
  }

  function renderCards(qs) {
    _currentQuestions = qs;
    const st = State.get();
    const C = State.CSS;
    const isSearch = st.searchQuery !== '';
    const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();
    const $ = State.getEl;
    const highlightText = State.highlightText;
    let h =
      '<div id="listInfo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:13px;color:var(--text2)">共 ' +
      qs.length +
      ' 题' +
      (isSearch ? ' (搜索结果)' : '') +
      '</span>' +
      '<span style="font-size:12px;color:var(--text2)">点击选项/按钮显示答案</span></div>';
    qs.forEach(function (q, idx) {
      const isRevealed = State.isRevealed(q._id);
      const isWrong = State.isWrong(q._id);
      const notes = State.getLocalNotes();
      const hasNote = notes[q._id];
      h +=
        '<div class="' + C.Q_CARD + '" data-id="' +
        q._id +
        '">' +
        '<div class="' + C.Q_CARD_HEADER + '"><span class="' + C.Q_TYPE_BADGE + '">' +
        q._type +
        '</span><span class="' + C.Q_CHAPTER_LABEL + '">' +
        q._chapter +
        ' · #' +
        (idx + 1) +
        '</span></div>' +
        '<div class="' + C.Q_TEXT + '">' +
        highlightText(q.question, st.searchQuery) +
        '</div>';
      if (q.options && q.options.length > 0) {
        h += '<div class="' + C.Q_OPTIONS + '">';
        q.options.forEach(function (opt, oi) {
          const letter = String.fromCharCode(65 + oi);
          const correct = q.answer && q.answer.toUpperCase() === letter;
          let cls = C.OPT_ROW;
          if (isRevealed && correct) {
            cls += ' ' + C.REVEALED;
          }
          if (isRevealed && !correct && isWrong) {
            cls += ' ' + C.WRONG;
          }
          h +=
            '<div class="' +
            cls +
            '" data-letter="' +
            letter +
            '">' +
            highlightText(opt, st.searchQuery) +
            '</div>';
        });
        h += '</div>';
      }
      const isDirect = State.DIRECT_TYPES.indexOf(q._type) >= 0;
      let ansHtml = '';
      if (q._type === '判断题') {
        ansHtml = q.answer === '√' ? '正确 ✓' : '错误 ✗';
      } else if (q._type === '选择题') {
        ansHtml = q.answer ? '正确答案：' + q.answer : '⚠ 答案未标注';
      } else {
        ansHtml = q.answer || '⚠ 答案未解析';
      }
      const showAns = isDirect || isRevealed;
      h +=
        '<div class="' + C.Q_ANSWER + ' ' +
        (showAns ? C.VISIBLE : '') +
        '"><div class="' + C.LABEL + '">📝 参考答案</div>' +
        highlightText(ansHtml, st.searchQuery) +
        '</div>';
      if (!isDirect) {
        h +=
          '<button class="' + C.Q_SHOW_ANSWER_BTN + '" data-id="' +
          q._id +
          '">' +
          (isRevealed ? '隐藏答案' : '显示答案') +
          '</button>';
      }
      if (isLoggedIn) {
        h +=
          '<div class="' + C.Q_ACTIONS + '">' +
          '<button class="' + C.Q_ACTION_BTN + ' ' + C.Q_NOTE_BTN + '" data-id="' +
          q._id +
          '">' +
          (hasNote ? '📝✏️' : '📝') +
          ' 笔记</button>' +
          '<button class="' + C.Q_ACTION_BTN + ' ' + C.Q_REPORT_BTN + '" data-id="' +
          q._id +
          '">🐛 报错</button></div>';
      }
      h += '</div>';
    });
    $('questionList').innerHTML = h;
    updateTopActions();
  }

  /** 云端记录答题结果（仅登录用户） */
  function logAnswer(q, isCorrect) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    window.Sync.recordAnswer(State.get().version, q._id, q._chapter, q._type, isCorrect);
    if (!isCorrect) {
      window.Sync.addWrongQuestion(State.get().version, q._id, q._chapter, q._type);
    } else if (State.isWrong(q._id)) {
      window.Sync.removeWrongQuestion(State.get().version, q._id);
    }
  }

  function updateTopActions() {
    const wc = State.wrongCount();
    State.$('wrongBookBtn').textContent = '❌ 错题 (' + wc + ')';
    const shown = _currentQuestions.filter(function (q) {
      return State.isRevealed(q._id);
    }).length;
    const total = _currentQuestions.length;
    State.$('revealAllBtn').style.display = shown < total ? 'inline-block' : 'none';
    State.$('hideAllBtn').style.display = shown > 0 ? 'inline-block' : 'none';
  }

  function updateStats() {
    if (!State.data) {
      return;
    }
    State.$('welcomeStats').innerHTML =
      State.get().version +
      ' · ' +
      State.flatQs.length +
      ' 道题 · 错题 ' +
      State.wrongCount() +
      ' 道';
  }

  /** 渲染统计饼图 */
  function renderStatsChart(cloudStats) {
    if (typeof window.Chart === 'undefined') {
      return;
    }
    const canvas = document.getElementById('statsPieChart');
    if (!canvas) {
      return;
    }
    if (canvas._chart) {
      canvas._chart.destroy();
    }
    const correct = (cloudStats && cloudStats.correct) || 0;
    const wrong = (cloudStats && cloudStats.wrong) || 0;
    if (correct === 0 && wrong === 0) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('暂无答题记录', canvas.width / 2, canvas.height / 2);
      }
      return;
    }
    canvas._chart = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['正确', '错误'],
        datasets: [
          { data: [correct, wrong], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 16 } } },
      },
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
    getCurrentQs: function () {
      return _currentQuestions;
    },
    setCurrentQs: function (qs) {
      _currentQuestions = qs;
    },
    logAnswer: logAnswer,
  };
})();
