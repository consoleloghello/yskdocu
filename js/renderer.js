(function () {
  'use strict';
  if (typeof window.State === 'undefined') {
    throw new Error('state.js must be loaded before renderer.js');
  }

  let _currentQuestionList = [];

  /**
   * 根据当前状态（模式/章节/题型/搜索词）筛选并返回当前要显示的题目列表
   * 优先级：错题模式 → 搜索 → 章节 → 题型
   */
  function getCurrentQuestions() {
    const appState = State.get();
    const flatQuestionList = State.flatQs;
    if (appState.mode === 'wrong') {
      return flatQuestionList.filter(function (question) {
        return State.isWrong(question._id);
      });
    }
    let filtered = appState.searchQuery
      ? searchIn(flatQuestionList, appState.searchQuery)
      : appState.chapter === 'all'
        ? flatQuestionList
        : flatQuestionList.filter(function (question) {
            return question._chapter === appState.chapter;
          });
    if (appState.type !== 'all') {
      filtered = filtered.filter(function (question) {
        return question._type === appState.type;
      });
    }
    return filtered;
  }

  /**
   * 全字段模糊搜索：匹配题目文本、答案、章节名、题型和选项
   * 支持搜索关键词自动转为小写实现大小写不敏感
   */
  function searchIn(items, query) {
    const lowerQuery = query.toLowerCase();
    return items.filter(function (item) {
      return [item.question, item.answer, item._chapter, item._type]
        .concat(item.options || [])
        .join(' ')
        .toLowerCase()
        .includes(lowerQuery);
    });
  }

  /** 按题型统计题目数量 */
  function countByType(items) {
    const typeCounts = {};
    items.forEach(function (question) {
      typeCounts[question._type] = (typeCounts[question._type] || 0) + 1;
    });
    return typeCounts;
  }

  /**
   * 主渲染入口：依次渲染章节导航、题型筛选、顶部统计，最后渲染题目卡片列表
   * 空结果时显示欢迎/提示信息而非空白页
   */
  function render() {
    if (!State.data) {
      return;
    }
    renderChapters();
    renderTypeFilters();
    updateStats();
    const questions = getCurrentQuestions();
    const $ = State.getEl;
    $('topActions').style.display = questions.length ? 'flex' : 'none';
    if (questions.length === 0) {
      // 无结果时的友好提示：区分搜索无匹配、错题本为空、和初始浏览三种场景
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
    renderCardList(questions);
  }

  /** 渲染横向滚动的章节导航 chip 按钮，激活项自动滚动到可视区域 */
  function renderChapters() {
    const chapterListEl = State.$('chapterList');
    const appState = State.get();
    // 错题模式下强制显示「全部」，不允许按章节筛选
    const activeChapterName = appState.mode === 'wrong' ? 'all' : appState.chapter;
    const C = State.CSS;
    const esc = State.escapeHtml;
    const escAttr = State.escapeAttr;
    let html =
      '<button class="' + C.CHIP + ' ' + (activeChapterName === 'all' ? C.ACTIVE : '') + '" data-ch="all">全部<span class="' + C.COUNT + '">' + State.flatQs.length + '</span></button>';
      State.data.chapters.forEach(function (chapter) {
        const questionCount = chapter.type_groups.reduce(function (sum, group) {
        return sum + group.questions.length;
      }, 0);
      html +=
        '<button class="' + C.CHIP + ' ' + (activeChapterName === chapter.name ? C.ACTIVE : '') + '" data-ch="' + escAttr(chapter.name) + '">' + esc(chapter.name) + '<span class="' + C.COUNT + '">' + questionCount + '</span></button>';
    });
    chapterListEl.innerHTML = html;
    chapterListEl.querySelectorAll('.' + C.CHIP).forEach(function (buttonEl) {
      // 滑动到激活的按钮
      if (buttonEl.className == C.CHIP + " " + C.ACTIVE) {
        buttonEl.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      }
      buttonEl.addEventListener('click', function () {
        State.setMulti({ chapter: buttonEl.dataset.ch, type: 'all', mode: 'browse', searchQuery: '' });
        State.$('searchInput').value = '';
        buttonEl.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      });
    });
  }

  /** 渲染题型筛选按钮组，当只有一种题型时自动隐藏（无需筛选） */
  function renderTypeFilters() {
    const typeFilterEl = State.$('typeFilters');
    const appState = State.get();
    const C = State.CSS;
    const esc = State.escapeHtml;
    const escAttr = State.escapeAttr;
    // 根据当前模式/搜索/章节计算题型分布
    let filteredQuestions;
    if (appState.mode === 'wrong') {
      filteredQuestions = State.flatQs.filter(function (question) {
        return State.isWrong(question._id);
      });
    } else {
      filteredQuestions = appState.searchQuery ? searchIn(State.flatQs, appState.searchQuery) : appState.chapter === 'all' ? State.flatQs : State.flatQs.filter(function (question) {
        return question._chapter === appState.chapter;
      });
    }
    const typeCounts = countByType(filteredQuestions);
    const typeOrder = State.QUESTION_TYPES;
    const sortedTypes = typeOrder.filter(function (typeName) {
      return typeCounts[typeName];
    });
    const totalQuestions = filteredQuestions.length;
    if (sortedTypes.length <= 1 && appState.type === 'all') {
      typeFilterEl.style.display = 'none';
      return;
    }
    typeFilterEl.style.display = 'flex';
    let html =
      '<button class="' + C.TYPE_BTN + ' ' +
      (appState.type === 'all' ? C.ACTIVE : '') +
      '" data-type="all">全部 <span class="' + C.COUNT + '">' +
      totalQuestions +
      '</span></button>';
    sortedTypes.forEach(function (typeName) {
      html +=
        '<button class="' + C.TYPE_BTN + ' ' +
        (appState.type === typeName ? C.ACTIVE : '') +
        '" data-type="' +
        escAttr(typeName) +
        '">' +
        esc(typeName) +
        ' <span class="' + C.COUNT + '">' +
        typeCounts[typeName] +
        '</span></button>';
    });
    typeFilterEl.innerHTML = html;
    typeFilterEl.querySelectorAll('.' + C.TYPE_BTN).forEach(function (buttonEl) {
      // 滑动到激活的按钮
      if (buttonEl.className == C.TYPE_BTN + " " + C.ACTIVE) {
        buttonEl.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      }
      buttonEl.addEventListener('click', function () {
        State.set('type', buttonEl.dataset.type);
        buttonEl.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
      });
    });
  }

  let _renderVersion = 0;

  function renderCardList(questions) {
    _currentQuestionList = questions;
    const appState = State.get();
    const C = State.CSS;
    const isSearchMode = appState.searchQuery !== '';
    const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();
    const $ = State.getEl;
    const highlightText = State.highlightText;
    const container = $('questionList');

    // 先写入列表头部（快速显示，用户立刻看到总题数）
    container.innerHTML =
      '<div id="listInfo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:13px;color:var(--text2)">共 ' +
      questions.length +
      ' 题' +
      (isSearchMode ? ' (搜索结果)' : '') +
      '</span>' +
      '<span style="font-size:12px;color:var(--text2)">点击选项/按钮显示答案</span></div>';

    if (questions.length === 0) {
      updateTopActions();
      return;
    }

    // 分帧渲染：每帧渲染 CHUNK 道题，避免卡顿
    _renderVersion++;
    const currentVersion = _renderVersion;
    const CHUNK_SIZE = 24; // 每帧渲染题数，可调
    let cardIndex = 0;

    /**
     * 构建单道题目的完整 HTML 字符串
     * @param {object} question - 题目对象（flatQs 中的条目）
     * @param {number} position - 在列表中的位置（用于显示题号）
     */
    function buildCardHtml(question, position) {
      const isRevealed = State.isRevealed(question._id);
      const isWrong = State.isWrong(question._id);
      const notes = State.getLocalNotes();
      const hasNote = notes[question._id];
      const esc = State.escapeHtml;
      const escAttr = State.escapeAttr;
      let html = '';

      // 卡片头部：题型标签 + 章节名 + 题号
      html += '<div class="' + C.Q_CARD + '" data-id="' + escAttr(question._id) + '">' +
        '<div class="' + C.Q_CARD_HEADER + '"><span class="' + C.Q_TYPE_BADGE + '">' + esc(question._type) +
        '</span><span class="' + C.Q_CHAPTER_LABEL + '">' + esc(question._chapter) + ' · #' + (position + 1) + '</span></div>' +
        '<div class="' + C.Q_TEXT + '">' + highlightText(question.question, appState.searchQuery) + '</div>';

      // 选择题选项区域（65 对应 ASCII 'A'）
      if (question.options && question.options.length > 0) {
        html += '<div class="' + C.Q_OPTIONS + '">';
        question.options.forEach(function (optionText, optionIndex) {
          const letter = String.fromCharCode(65 + optionIndex);
          const isCorrect = question.answer && question.answer.toUpperCase() === letter;
          let cssClass = C.OPT_ROW;
          if (isRevealed && isCorrect) cssClass += ' ' + C.REVEALED;
          if (isRevealed && !isCorrect && isWrong) cssClass += ' ' + C.WRONG;
          html += '<div class="' + cssClass + '" data-letter="' + letter + '">' + highlightText(optionText, appState.searchQuery) + '</div>';
        });
        html += '</div>';
      }

      // 参考答案区域：不同题型的显示格式不同
      const isDirectType = State.DIRECT_TYPES.indexOf(question._type) >= 0;
      let answerHtml = '';
      if (question._type === '判断题') {
        answerHtml = question.answer === '√' ? '正确 ✓' : '错误 ✗';
      } else if (question._type === '选择题') {
        answerHtml = question.answer ? '正确答案：' + question.answer : '⚠ 答案未标注';
      } else {
        answerHtml = question.answer || '⚠ 答案未解析';
      }
      const showAnswer = isDirectType || isRevealed;
      html += '<div class="' + C.Q_ANSWER + ' ' + (showAnswer ? C.VISIBLE : '') + '"><div class="' + C.LABEL + '">📝 参考答案</div>' +
        highlightText(answerHtml, appState.searchQuery) + '</div>';

      // 简答/实操/应急处理等题型默认显示答案，不需要显示/隐藏按钮
      if (!isDirectType) {
        html += '<button class="' + C.Q_SHOW_ANSWER_BTN + '" data-id="' + escAttr(question._id) + '">' +
          (isRevealed ? '隐藏答案' : '显示答案') + '</button>';
      }

      // 登录用户额外显示笔记和报错按钮
      if (isLoggedIn) {
        html += '<div class="' + C.Q_ACTIONS + '">' +
          '<button class="' + C.Q_ACTION_BTN + ' ' + C.Q_NOTE_BTN + '" data-id="' + escAttr(question._id) + '">' +
          (hasNote ? '📝✏️' : '📝') + ' 笔记</button>' +
          '<button class="' + C.Q_ACTION_BTN + ' ' + C.Q_REPORT_BTN + '" data-id="' + escAttr(question._id) + '">🐛 报错</button></div>';
      }

      html += '</div>';
      return html;
    }

    function renderChunk() {
      // 如果新一轮渲染已启动，取消本次未完成的旧渲染
      if (_renderVersion !== currentVersion) return;

      const end = Math.min(cardIndex + CHUNK_SIZE, questions.length);
      let chunkHtml = '';
      for (; cardIndex < end; cardIndex++) {
        chunkHtml += buildCardHtml(questions[cardIndex], cardIndex);
      }
      container.insertAdjacentHTML('beforeend', chunkHtml);

      if (cardIndex < questions.length) {
        requestAnimationFrame(renderChunk);
      } else {
        updateTopActions();
      }
    }

    requestAnimationFrame(renderChunk);
  }

  /** 更新顶部操作按钮的状态：错题数量、全部显示/全部隐藏按钮的可见性 */
  function updateTopActions() {
    const wrongCount = State.wrongCount();
    State.$('wrongBookBtn').textContent = '❌ 错题 (' + wrongCount + ')';
    const revealedCount = _currentQuestionList.filter(function (question) {
      return State.isRevealed(question._id);
    }).length;
    const totalQuestions = _currentQuestionList.length;
    State.$('revealAllBtn').style.display = revealedCount < totalQuestions ? 'inline-block' : 'none';
    State.$('hideAllBtn').style.display = revealedCount > 0 ? 'inline-block' : 'none';
  }

  function updateStats() {
    if (!State.data) {
      return;
    }
    State.$('welcomeStats').innerHTML =
      State.escapeHtml(State.get().version) +
      ' · ' +
      State.flatQs.length +
      ' 道题 · 错题 ' +
      State.wrongCount() +
      ' 道';
  }

  /** 使用 Chart.js 渲染答题统计饼图 */
  function renderStatsChart(cloudStats) {
    if (typeof window.Chart === 'undefined') {
      return;
    }
    const canvas = document.getElementById('statsPieChart');
    if (!canvas) {
      return;
    }
    // 销毁旧实例，防止多次打开弹窗时图表叠加
    if (canvas._chart) {
      canvas._chart.destroy();
    }
    const correctCount = (cloudStats && cloudStats.correct) || 0;
    const wrongCount = (cloudStats && cloudStats.wrong) || 0;
    if (correctCount === 0 && wrongCount === 0) {
      const context2d = canvas.getContext('2d');
      if (context2d) {
        context2d.clearRect(0, 0, canvas.width, canvas.height);
        context2d.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
        context2d.fillStyle = '#94a3b8';
        context2d.textAlign = 'center';
        context2d.fillText('暂无答题记录', canvas.width / 2, canvas.height / 2);
      }
      return;
    }
    canvas._chart = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['正确', '错误'],
        datasets: [
          { data: [correctCount, wrongCount], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 },
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
    renderCards: renderCardList,
    renderChapters: renderChapters,
    renderTypeFilters: renderTypeFilters,
    renderStatsChart: renderStatsChart,
    updateTopActions: updateTopActions,
    updateStats: updateStats,
    getCurrentQs: function () {
      return _currentQuestionList;
    },
    setCurrentQs: function (questions) {
      _currentQuestionList = questions;
    },
  };
})();
