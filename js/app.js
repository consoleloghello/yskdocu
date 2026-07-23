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
  const qList = S.$('questionList');
  const $ = S.getEl;
  const state = S.get();
  let data = null;
  let flatQs = [];
  const revealed = S.getRevealed();
  const localNotes = S.getLocalNotes();
  const reportedQuestions = S.getReportedQuestions();
  const ls = function (k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      /* silent */
    }
    return null;
  };
  const loadState = S.load;
  const saveState = S.save;
  const esc = S.escapeHtml;
  const renderStatsChart = R.renderStatsChart;

  async function loadData(ver) {
    try {
      const r = await fetch('data/' + ver + '.json');
      if (!r.ok) {
        throw new Error('HTTP ' + r.status);
      }
      data = await r.json();
      S.data = data;
      buildFlat();
      revealed.clear();
      flatQs.forEach((q) => revealed.add(q._id));
      state.version = ver;
      if (ver === '外操版') {
        $('verWaic').classList.add(C.ACTIVE);
        $('verNei').classList.remove(C.ACTIVE);
      } else {
        $('verNei').classList.add(C.ACTIVE);
        $('verWaic').classList.remove(C.ACTIVE);
      }
      const wb = ls('ysk_wrong_' + ver);
      if (wb) {
        state.wrongBook = wb;
      } else {
        state.wrongBook = {};
      }
      if (state.chapter !== 'all' && !data.chapters.find((c) => c.name === state.chapter)) {
        state.chapter = 'all';
      }
      saveState();
      // 登录状态下拉取云端错题和笔记
      await pullCloudData(ver);
      render();
    } catch (e) {
      $('welcomeStats').textContent = '加载失败，请检查网络连接后刷新页面重试';
      console.error('loadData error:', e);
    }
  }

  // ============================================================
  // 云端数据同步（登录用户）
  // ============================================================

  /** 拉取云端错题本和笔记，合并到本地 */
  async function pullCloudData(ver) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    try {
      // 拉取云端错题
      const cloudWrong = await window.Sync.getWrongQuestions(ver);
      if (cloudWrong && cloudWrong.length) {
        cloudWrong.forEach(function (id) {
          state.wrongBook[id] = true;
        });
        saveState();
      }
      // 拉取云端笔记
      const notes = await window.Sync.getNotes(ver);
      if (notes) {
        for (const k in notes) {
          localNotes[k] = notes[k];
        }
      }
    } catch (e) {
      console.error('pullCloudData error:', e);
    }
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
        for (const k in localNotes) {
          delete localNotes[k];
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

  function buildFlat() {
    flatQs = [];
    let qid = 0;
    S.data.chapters.forEach(function (ch) {
      ch.type_groups.forEach((tg) => {
        tg.questions.forEach((q) => {
          q._id = ch.name + '_' + tg.type + '_' + qid++;
          q._chapter = ch.name;
          q._type = tg.type;
          flatQs.push(q);
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
    _currentQs = R.getCurrentQs();
  }

  let _currentQs = [];
  function renderCards(qs) {
    _currentQs = qs;
    R.renderCards(qs);
  }

  /** 云端记录答题结果（仅登录用户） */
  function logAnswer(q, isCorrect) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    const id = q._id;
    window.Sync.recordAnswer(state.version, id, q._chapter, q._type, isCorrect);
    if (!isCorrect) {
      window.Sync.addWrongQuestion(state.version, id, q._chapter, q._type);
    } else if (state.wrongBook[id]) {
      window.Sync.removeWrongQuestion(state.version, id);
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
        renderCards(_currentQs); // 刷新笔记图标
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
          renderCards(_currentQs);
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
    modal.querySelectorAll('input[name="reportReason"]').forEach(function (r) {
      r.checked = false;
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
      .then(function (r) {
        if (!r.ok) {
          throw new Error('HTTP ' + r.status);
        }
        return r.json();
      })
      .then(function (data) {
        const commits = data && data.commits;
        if (!commits || !commits.length) {
          return;
        }

        let html = '';
        for (let i = 0; i < commits.length; i++) {
          const c = commits[i];
          html +=
            '<div class="changelog-entry">' +
            '<div class="changelog-date">' +
            esc(c.date) +
            '</div>' +
            '<div class="changelog-msg">' +
            esc(c.message) +
            '</div>' +
            '</div>';
        }
        body.innerHTML = html;

        const latestHash = commits[0].hash;
        let seen = null;
        try {
          seen = localStorage.getItem('ysk_changelog_seen');
        } catch (e) {
          /* silent */
        }
        if (seen !== latestHash) {
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
    const v = $('searchInput').value.trim();
    $('searchClear').style.display = v ? 'inline' : 'none';
    state.searchQuery = v;
    state.mode = v ? 'search' : 'browse';
    if (v) {
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
    const total = flatQs.length;
    const wrong = Object.keys(state.wrongBook).length;
    const isLoggedIn = window.SupabaseAuth && window.SupabaseAuth.isLoggedIn();

    let statsHtml = `
    <div class="stat-row"><span class="stat-label">题库版本</span><span class="stat-value">${state.version}</span></div>
    <div class="stat-row"><span class="stat-label">总题数</span><span class="stat-value">${total}</span></div>
    <div class="stat-row"><span class="stat-label">章节数</span><span class="stat-value">${data.chapters.length}</span></div>
    <div class="stat-row"><span class="stat-label">错题数</span><span class="stat-value">${wrong}</span></div>
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

  $('revealAllBtn').addEventListener('click', () => {
    _currentQs.forEach((q) => revealed.add(q._id));
    saveState();
    renderCards(_currentQs);
  });
  $('hideAllBtn').addEventListener('click', () => {
    _currentQs.forEach((q) => revealed.delete(q._id));
    saveState();
    renderCards(_currentQs);
  });

  // Shared helper: reset all view filters (used by both entry paths)
  function resetViewState() {
    state.chapter = 'all';
    state.type = 'all';
    state.searchQuery = '';
    state.mode = 'browse';
    $('searchInput').value = '';
  }

  // Version switch (header buttons)
  function switchVersion(ver) {
    if (state.version === ver) {
      return;
    }
    resetViewState();
    loadData(ver);
  }

  $('verWaic').addEventListener('click', function () {
    switchVersion('外操版');
  });
  $('verNei').addEventListener('click', function () {
    switchVersion('内操版');
  });
  // ===== Entry Overlay =====
  (function initOverlay() {
    const overlay = document.getElementById('entryOverlay');
    if (!overlay) {
      return;
    }

    const cards = overlay.querySelectorAll('.overlay-card');

    function handleVersionSelect(ver) {
      state.version = ver;
      resetViewState();

      overlay.classList.add(C.EXIT);
      overlay.querySelectorAll('.' + C.OVERLAY_CARD).forEach((c) => (c.style.pointerEvents = 'none'));

      setTimeout(() => {
        loadData(ver);
      }, 100);

      setTimeout(() => {
        overlay.classList.add(C.HIDE);
        overlay.classList.remove(C.EXIT);
      }, 650);
    }

    cards.forEach((card) => {
      card.addEventListener('click', function (e) {
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
  qList.addEventListener('click', function (e) {
    // 显示/隐藏答案按钮
    const btn = e.target.closest('.' + C.Q_SHOW_ANSWER_BTN);
    if (btn) {
      e.stopPropagation();
      const id = btn.dataset.id;
      const card = btn.closest('.' + C.Q_CARD);
      const answerDiv = card.querySelector('.' + C.Q_ANSWER);
      if (revealed.has(id)) {
        revealed.delete(id);
        answerDiv.classList.remove(C.VISIBLE);
        btn.textContent = '显示答案';
      } else {
        revealed.add(id);
        answerDiv.classList.add(C.VISIBLE);
        btn.textContent = '隐藏答案';
      }
      saveState();
      R.updateTopActions();
      return;
    }

    // 选择题选项点击
    const opt = e.target.closest('.' + C.OPT_ROW);
    if (opt) {
      const card = opt.closest('.' + C.Q_CARD);
      const id = card.dataset.id;
      if (revealed.has(id)) {
        return;
      }
      const letter = opt.dataset.letter;
      const q = flatQs.find(function (x) {
        return x._id === id;
      });
      if (!q) {
        return;
      }
      const hasAnswer = q.answer && q.answer.trim() !== '';
      const correct = hasAnswer && q.answer.toUpperCase() === letter;
      card.querySelectorAll('.' + C.OPT_ROW).forEach(function (o) {
        const l = o.dataset.letter;
        if (hasAnswer && l === q.answer) {
          o.classList.add(C.REVEALED);
        } else if (o === opt && !correct) {
          o.classList.add(C.WRONG);
        }
      });
      card.querySelector('.' + C.Q_ANSWER).classList.add(C.VISIBLE);
      revealed.add(id);
      if (hasAnswer) {
        if (!correct) {
          state.wrongBook[id] = true;
        } else {
          delete state.wrongBook[id];
        }
      }
      saveState();
      R.updateTopActions();
      logAnswer(q, correct);
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

  // Init
  loadState();
  // 启动认证状态监听
  initAuthSync();
})();
