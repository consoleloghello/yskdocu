(function () {
  'use strict';
  const _deps = [];
  if (typeof window.State === 'undefined') {
    _deps.push('state.js');
  }
  if (typeof window.Render === 'undefined') {
    _deps.push('renderer.js');
  }
  if (_deps.length) {
    throw new Error('Missing: ' + _deps.join(', '));
  }

  const S = window.State;
  const R = window.Render;
  const C = S.CSS;
  const questionListEl = S.$('questionList');
  const $ = S.getEl;
  const state = S.get();
  let data = null;
  let flatQs = [];
  let revealed = S.getRevealed();
  const localNotes = S.getLocalNotes();
  const reportedQuestions = S.getReportedQuestions();
  /** 安全读取 localStorage JSON，解析失败返回 null */
  const safeLoadJSON = function (storageKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey));
    } catch (e) {
      // 数据损坏时静默处理
    }
    return null;
  };
  const loadState = S.load;
  const saveState = S.save;
  const esc = S.escapeHtml;
  const renderStatsChart = R.renderStatsChart;

  /**
   * 加载指定版本的题库数据
   * 优先尝试 gzip 压缩版（.json.gz），失败时降级到未压缩版
   * 加载完成后构建展平列表、恢复本地错题本、拉取云端数据，然后渲染
   */
  async function loadData(versionName) {
    try {
      if (window.Decompress) {
        // 使用浏览器原生 DecompressionStream 解压 .json.gz
        data = await window.Decompress.fetchJSON('data/' + versionName);
      } else {
        const response = await fetch('data/' + versionName + '.json');
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        data = await response.json();
      }
      S.data = data;
      buildFlat();
      // 新版本加载后默认显示所有题目的答案（便于快速浏览）
      revealed.clear();
      flatQs.forEach((question) => revealed.add(question._id));
      state.version = versionName;
      if (versionName === '外操版') {
        $('verWaic').classList.add(C.ACTIVE);
        $('verNei').classList.remove(C.ACTIVE);
      } else {
        $('verNei').classList.add(C.ACTIVE);
        $('verWaic').classList.remove(C.ACTIVE);
      }
      // 恢复该版本的本地错题本
      const wrongBookData = safeLoadJSON('ysk_wrong_' + versionName);
      if (wrongBookData) {
        state.wrongBook = wrongBookData;
      } else {
        state.wrongBook = {};
      }
      // 如果之前选中的章节在新版本中不存在（跨版本章节差异），回退到「全部」
      if (state.chapter !== 'all' && !data.chapters.find((chapter) => chapter.name === state.chapter)) {
        state.chapter = 'all';
      }
      saveState();
      // 登录状态下拉取云端错题和笔记
      await pullCloudData(versionName);
      render();
    } catch (error) {
      $('welcomeStats').textContent = '加载失败，请检查网络连接后刷新页面重试';
      console.error('loadData error:', error);
    }
  }

  // ============================================================
  // 云端数据同步（登录用户）
  // ============================================================

  /** 拉取云端错题本和笔记，合并到本地 */
  async function pullCloudData(versionName) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    try {
      // 拉取云端错题
      const cloudWrong = await window.Sync.getWrongQuestions(versionName);
      if (cloudWrong && cloudWrong.length) {
        cloudWrong.forEach(function (questionId) {
          state.wrongBook[questionId] = true;
        });
        saveState();
      }
      // 拉取云端笔记
      const notes = await window.Sync.getNotes(versionName);
      if (notes) {
        for (const noteKey in notes) {
          localNotes[noteKey] = notes[noteKey];
        }
      }
    } catch (error) {
      console.error('pullCloudData error:', error);
    }
  }

  /** 直接更新笔记按钮图标，避免全量分帧重渲染 */
  function updateNoteIcon(questionId) {
    const card = document.querySelector('#questionList .' + C.Q_CARD + '[data-id="' + questionId + '"]');
    if (!card) return;
    const noteBtn = card.querySelector('.' + C.Q_NOTE_BTN);
    if (!noteBtn) return;
    noteBtn.textContent = (localNotes[questionId] ? '📝✏️' : '📝') + ' 笔记';
  }

  /** 监听认证状态变化 */
  function initAuthSync() {
    if (typeof window.SupabaseAuth === 'undefined') {
      return;
    }

    window.SupabaseAuth.onAuthStateChange(function (user) {
      if (user) {
        // 登录：合并云端数据
        pullCloudData(state.version).then(function () {
          render();
        });
      } else {
        // 登出：清除笔记缓存，保留本地错题
        for (const noteKey in localNotes) {
          delete localNotes[noteKey];
        }
        R.render();
      }
    });

    // 页面初始化时检查是否已登录
    if (window.SupabaseAuth.isLoggedIn()) {
      pullCloudData(state.version).then(function () {
        render();
      });
    }
  }

  /**
   * 将嵌套的题库结构（章节→题型→题目）展平为扁平数组
   * 每道题附加合成 ID：章节_题型_序号，便于定位和筛选
   * flatQs 同时挂载到 State.flatQs 供 renderer 使用
   */
  function buildFlat() {
    flatQs = [];
    let questionIdCounter = 0;
    S.data.chapters.forEach(function (chapter) {
      chapter.type_groups.forEach((typeGroup) => {
        typeGroup.questions.forEach((question) => {
          question._id = chapter.name + '_' + typeGroup.type + '_' + questionIdCounter++;
          question._chapter = chapter.name;
          question._type = typeGroup.type;
          flatQs.push(question);
        });
      });
    });
    S.flatQs = flatQs;
  }

  function render() {
    if (!data) {
      return;
    }
    R.render();
    _currentQuestions = R.getCurrentQs();
  }

  // 当前渲染的题目列表引用（供 revealAll/hideAll/笔记刷新等快速操作使用）
  let _currentQuestions = [];
  /** 渲染卡片并更新当前列表引用 */
  function renderCards(questions) {
    _currentQuestions = questions;
    R.renderCards(questions);
  }

  /** 云端记录答题结果（仅登录用户） */
  function logAnswer(question, isCorrect) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    const questionId = question._id;
    window.Sync.recordAnswer(state.version, questionId, question._chapter, question._type, isCorrect);
    if (!isCorrect) {
      window.Sync.addWrongQuestion(state.version, questionId, question._chapter, question._type);
    } else if (state.wrongBook[questionId]) {
      window.Sync.removeWrongQuestion(state.version, questionId);
    }
  }

  // ============================================================
  // 笔记弹窗
  // ============================================================
  function openNoteModal(questionId) {
    const modal = $('noteModal');
    const textarea = $('noteTextarea');
    const saveBtn = $('noteSaveBtn');
    const deleteBtn = $('noteDeleteBtn');
    if (!modal || !textarea) {
      return;
    }

    // 填充已有内容
    textarea.value = localNotes[questionId] || '';
    modal.dataset.questionId = questionId;
    modal.style.display = 'flex';

    // 保存
    saveBtn.onclick = async function () {
      const content = textarea.value.trim();
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';
      if (deleteBtn) {
        deleteBtn.disabled = true;
      }
      try {
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
        updateNoteIcon(questionId);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 保存';
        if (deleteBtn) {
          deleteBtn.disabled = false;
        }
      }
    };

    // 删除
    if (deleteBtn) {
      deleteBtn.onclick = async function () {
        saveBtn.disabled = true;
        deleteBtn.disabled = true;
        deleteBtn.textContent = '删除中...';
        try {
          delete localNotes[questionId];
          if (window.Sync && window.SupabaseAuth && window.SupabaseAuth.isLoggedIn()) {
            await window.Sync.deleteNote(state.version, questionId);
          }
          modal.style.display = 'none';
          updateNoteIcon(questionId);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 保存';
          deleteBtn.disabled = false;
          deleteBtn.textContent = '🗑 删除';
        }
      };
    }
  }

  // 关闭笔记弹窗
  (function () {
    const modal = $('noteModal');
    if (!modal) {
      return;
    }
    $('noteClose').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    $('noteCancel').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  })();

  // ============================================================
  // 报错弹窗
  // ============================================================
  function openReportModal(questionId) {
    const modal = $('reportModal');
    if (!modal) {
      return;
    }

    // 本次会话已成功反馈过，不允许重复提交
    if (reportedQuestions[questionId]) {
      alert('该题目您已提交过反馈，感谢参与！');
      return;
    }

    modal.dataset.questionId = questionId;
    modal.style.display = 'flex';
    // 清除上次选择
    modal.querySelectorAll('input[name="reportReason"]').forEach(function (radioBtn) {
      radioBtn.checked = false;
    });
    $('reportDetail').value = '';
    $('reportMsg').textContent = '';
    $('reportSubmit').disabled = false;
    $('reportSubmit').textContent = '提交';
  }

  (function () {
    const modal = $('reportModal');
    if (!modal) {
      return;
    }
    $('reportClose').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    $('reportCancel').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });

    $('reportSubmit').addEventListener('click', async function () {
      const questionId = modal.dataset.questionId;
      const reasonEl = modal.querySelector('input[name="reportReason"]:checked');
      const detail = $('reportDetail').value.trim();
      const msgEl = $('reportMsg');

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

      const result = await window.Sync.submitReport(
        state.version,
        questionId,
        reasonEl.value,
        detail
      );
      if (result !== null) {
        msgEl.textContent = '✅ 反馈已提交，感谢！';
        reportedQuestions[questionId] = true;
        // 按钮保持禁用，防止重复提交
        $('reportSubmit').textContent = '已提交';
        setTimeout(function () {
          modal.style.display = 'none';
        }, 1500);
      } else {
        msgEl.textContent = '提交失败，请稍后重试';
        $('reportSubmit').disabled = false;
        $('reportSubmit').textContent = '提交';
      }
    });
  })();

  // ============================================================
  // Changelog Modal
  // ============================================================
  (function () {
    const modal = $('changelogModal');
    const closeBtn = $('changelogClose');
    const body = $('changelogBody');
    if (!modal || !closeBtn || !body) {
      return;
    }

    let pendingHash = null;

    function closeChangelog() {
      modal.style.display = 'none';
      if (pendingHash) {
        try {
          localStorage.setItem('ysk_changelog_seen', pendingHash);
        } catch (e) {
          /* silent */
        }
        pendingHash = null;
      }
    }
    closeBtn.addEventListener('click', closeChangelog);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeChangelog();
      }
    });

    fetch('data/changelog.json')
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function (changelogData) {
        const commits = changelogData && changelogData.commits;
        if (!commits || !commits.length) {
          return;
        }

        let html = '';
        for (let i = 0; i < commits.length; i++) {
          const commit = commits[i];
          html +=
            '<div class="changelog-entry">' +
            '<div class="changelog-date">' +
            esc(commit.date) +
            '</div>' +
            '<div class="changelog-msg">' +
            esc(commit.message) +
            '</div>' +
            '</div>';
        }
        body.innerHTML = html;

        const latestHash = commits[0].hash;
        let seenHash = null;
        try {
          seenHash = localStorage.getItem('ysk_changelog_seen');
        } catch (e) {
          /* silent */
        }
        if (seenHash !== latestHash) {
          pendingHash = latestHash;
          modal.style.display = 'flex';
        }
      })
      .catch(function (err) {
        console.warn('Changelog unavailable:', err.message);
      });
  })();

  // ============================================================
  // Search
  // ============================================================
  let _isComposing = false;
  $('searchInput').addEventListener('compositionstart', function () {
    _isComposing = true;
  });
  $('searchInput').addEventListener('compositionend', function () {
    _isComposing = false;
    doSearch();
  });
  const doSearch = S.debounce(function () {
    const searchValue = $('searchInput').value.trim();
    $('searchClear').style.display = searchValue ? 'inline' : 'none';
    state.searchQuery = searchValue;
    state.mode = searchValue ? 'search' : 'browse';
    if (searchValue) {
      state.chapter = 'all';
    }
    state.type = 'all';
    saveState();
    render();
  }, 300);
  $('searchInput').addEventListener('input', function () {
    if (!_isComposing) {
      doSearch();
    }
  });
  $('searchClear').addEventListener('click', () => {
    $('searchInput').value = '';
    $('searchClear').style.display = 'none';
    state.searchQuery = '';
    state.mode = 'browse';
    state.type = 'all';
    saveState();
    render();
  });

  // ============================================================
  // Stats modal（支持登录用户拉取云端统计 + Chart.js 图表）
  // ============================================================
  $('statsBtn').addEventListener('click', async function () {
    const totalQuestions = flatQs.length;
    const wrongCount = Object.keys(state.wrongBook).length;
    const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();

    let statsHtml = `
    <div class="stat-row"><span class="stat-label">题库版本</span><span class="stat-value">${state.version}</span></div>
    <div class="stat-row"><span class="stat-label">总题数</span><span class="stat-value">${totalQuestions}</span></div>
    <div class="stat-row"><span class="stat-label">章节数</span><span class="stat-value">${data.chapters.length}</span></div>
    <div class="stat-row"><span class="stat-label">错题数</span><span class="stat-value">${wrongCount}</span></div>
    <div class="stat-row"><span class="stat-label">已显示答案</span><span class="stat-value">${revealed.size}</span></div>
  `;

    // 登录用户：显示云端统计和图表
    if (isLoggedIn && window.Sync) {
      const cloudStats = await window.Sync.getStats(state.version);
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
  $('statsClose').addEventListener('click', () => {
    $('statsModal').style.display = 'none';
  });
  $('statsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.style.display = 'none';
    }
  });

  // Top action buttons
  $('wrongBookBtn').addEventListener('click', () => {
    state.mode = 'wrong';
    state.chapter = 'all';
    state.type = 'all';
    state.searchQuery = '';
    $('searchInput').value = '';
    saveState();
    render();
  });

  function revealAllCards() {
    _currentQuestions.forEach(function (question) { revealed.add(question._id); });
    // 直接操作已渲染的 DOM 卡片，避免全量重渲染
    document.querySelectorAll('#questionList .' + C.Q_CARD).forEach(function (cardEl) {
      let cardId = cardEl.dataset.id;
      if (!cardId) return;
      let answerDiv = cardEl.querySelector('.' + C.Q_ANSWER);
      if (answerDiv) answerDiv.classList.add(C.VISIBLE);
      let answerBtn = cardEl.querySelector('.' + C.Q_SHOW_ANSWER_BTN);
      if (answerBtn) answerBtn.textContent = '隐藏答案';
      // 标记正确选项
      let question = flatQs.find(function (x) { return x._id === cardId; });
      if (question && question.options && question.options.length > 0 && question.answer) {
        cardEl.querySelectorAll('.' + C.OPT_ROW).forEach(function (optionRow) {
          if (optionRow.dataset.letter && question.answer.toUpperCase() === optionRow.dataset.letter) {
            optionRow.classList.add(C.REVEALED);
          }
        });
      }
    });
    saveState();
    R.updateTopActions();
  }
  $('revealAllBtn').addEventListener('click', revealAllCards);
  function hideAllCards() {
    _currentQuestions.forEach(function (question) { revealed.delete(question._id); });
    // 直接操作已渲染的 DOM 卡片，避免全量重渲染
    document.querySelectorAll('#questionList .' + C.Q_CARD).forEach(function (cardEl) {
      let cardId = cardEl.dataset.id;
      if (!cardId) return;
      let answerDiv = cardEl.querySelector('.' + C.Q_ANSWER);
      if (answerDiv) answerDiv.classList.remove(C.VISIBLE);
      let answerBtn = cardEl.querySelector('.' + C.Q_SHOW_ANSWER_BTN);
      if (answerBtn) answerBtn.textContent = '显示答案';
      cardEl.querySelectorAll('.' + C.OPT_ROW).forEach(function (optionRow) {
        optionRow.classList.remove(C.REVEALED, C.WRONG);
      });
    });
    saveState();
    R.updateTopActions();
  }
  $('hideAllBtn').addEventListener('click', hideAllCards);

  // Shared helper: reset all view filters (used by both entry paths)
  function resetViewState() {
    state.chapter = 'all';
    state.type = 'all';
    state.searchQuery = '';
    state.mode = 'browse';
    $('searchInput').value = '';
  }

  // 版本切换（顶部导航栏按钮），重置所有筛选条件后加载新版本
  function switchVersion(versionName) {
    if (state.version === versionName) {
      return;  // 已经是该版本，无需切换
    }
    resetViewState();
    loadData(versionName);
  }

  $('verWaic').addEventListener('click', function () {
    switchVersion('外操版');
  });
  $('verNei').addEventListener('click', function () {
    switchVersion('内操版');
  });
  // ============================================================
  // 入口遮罩：首次访问时显示版本选择界面
  // ============================================================
  (function initOverlay() {
    const overlay = document.getElementById('entryOverlay');
    if (!overlay) {
      return;
    }

    const overlayCards = overlay.querySelectorAll('.overlay-card');

    function handleVersionSelect(versionName) {
      state.version = versionName;
      resetViewState();

      overlay.classList.add(C.EXIT);
      overlay.querySelectorAll('.' + C.OVERLAY_CARD).forEach((cardEl) => (cardEl.style.pointerEvents = 'none'));

      setTimeout(() => {
        loadData(versionName);
      }, 100);

      setTimeout(() => {
        overlay.classList.add(C.HIDE);
        overlay.classList.remove(C.EXIT);
      }, 650);
    }

    overlayCards.forEach((cardEl) => {
      cardEl.addEventListener('click', function (e) {
        if (this.classList.contains(C.CLICKED)) {
          return;
        }
        this.classList.add(C.CLICKED);

        const rect = this.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = C.RIPPLE;
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = e.clientX - rect.left - size / 2 + 'px';
        ripple.style.top = e.clientY - rect.top - size / 2 + 'px';
        this.style.position = 'relative';
        this.style.overflow = 'hidden';
        this.appendChild(ripple);

        handleVersionSelect(this.dataset.ver);
      });
    });
  })();

  // ============================================================
  // 事件委托：卡片内交互（避免全量重渲染）
  // ============================================================
  questionListEl.addEventListener('click', function (e) {
    // 显示/隐藏答案按钮
    const showAnswerBtn = e.target.closest('.' + C.Q_SHOW_ANSWER_BTN);
    if (showAnswerBtn) {
      e.stopPropagation();
      const questionId = showAnswerBtn.dataset.id;
      const card = showAnswerBtn.closest('.' + C.Q_CARD);
      const answerDiv = card.querySelector('.' + C.Q_ANSWER);
      if (revealed.has(questionId)) {
        revealed.delete(questionId);
        answerDiv.classList.remove(C.VISIBLE);
        showAnswerBtn.textContent = '显示答案';
      } else {
        revealed.add(questionId);
        answerDiv.classList.add(C.VISIBLE);
        showAnswerBtn.textContent = '隐藏答案';
      }
      saveState();
      R.updateTopActions();
      return;
    }

    // 选择题选项点击
    const optionRow = e.target.closest('.' + C.OPT_ROW);
    if (optionRow) {
      const card = optionRow.closest('.' + C.Q_CARD);
      const questionId = card.dataset.id;
      if (revealed.has(questionId)) {
        return;  // 已显示答案，忽略选项点击
      }
      const selectedLetter = optionRow.dataset.letter;
      const question = flatQs.find(function (x) {
        return x._id === questionId;
      });
      if (!question) {
        return;
      }
      const hasAnswer = question.answer && question.answer.trim() !== '';
      const isCorrect = hasAnswer && question.answer.toUpperCase() === selectedLetter;
      card.querySelectorAll('.' + C.OPT_ROW).forEach(function (optionRowEl) {
        const optionLetter = optionRowEl.dataset.letter;
        if (hasAnswer && optionLetter === question.answer) {
          optionRowEl.classList.add(C.REVEALED);
        } else if (optionRowEl === optionRow && !isCorrect) {
          optionRowEl.classList.add(C.WRONG);
        }
      });
      card.querySelector('.' + C.Q_ANSWER).classList.add(C.VISIBLE);
      revealed.add(questionId);
      if (hasAnswer) {
        if (!isCorrect) {
          state.wrongBook[questionId] = true;
        } else {
          delete state.wrongBook[questionId];
        }
      }
      saveState();
      R.updateTopActions();
      logAnswer(question, isCorrect);
      return;
    }

    // 笔记按钮
    const noteBtn = e.target.closest('.' + C.Q_NOTE_BTN);
    if (noteBtn) {
      e.stopPropagation();
      openNoteModal(noteBtn.dataset.id);
      return;
    }

    // 报错按钮
    const reportBtn = e.target.closest('.' + C.Q_REPORT_BTN);
    if (reportBtn) {
      e.stopPropagation();
      openReportModal(reportBtn.dataset.id);
      return;
    }
  });

  // ============================================================
  // 初始化：恢复上次状态 + 启动认证监听
  // ============================================================
  loadState();
  // loadState() 可能从 localStorage 重建了 _revealed Set，需同步引用
  revealed = S.getRevealed();
  // 启动认证状态监听
  initAuthSync();
})();
