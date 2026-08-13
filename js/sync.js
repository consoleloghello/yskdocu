/**
 * 云端数据同步模块
 * 封装 Supabase 数据库的 CRUD 操作
 * 暴露为 window.Sync
 *
 * 依赖 window.SupabaseAuth，需在其后加载
 */
(function () {
  'use strict';

  // ============================================================
  // 内部辅助
  // ============================================================

  /** 获取 supabase 客户端，未初始化时静默失败 */
  function client() {
    if (!window.SupabaseAuth || !window.SupabaseAuth.getClient) {
      return null;
    }
    return window.SupabaseAuth.getClient();
  }

  /** 获取当前用户 ID */
  function uid() {
    if (!window.SupabaseAuth || !window.SupabaseAuth.getUser) {
      return null;
    }
    const user = window.SupabaseAuth.getUser();
    return user ? user.id : null;
  }

  /** 静默执行：成功返回 data（或 true），失败返回 null 并记录日志 */
  async function silent(promise, label) {
    try {
      const result = await promise;
      if (result.error) {
        console.error('Sync.' + label + ' 错误:', result.error.message || result.error);
        return null;
      }
      // insert/upsert/delete 默认不返回数据，data 为 null 表示操作成功
      return result.data !== null ? result.data : true;
    } catch (e) {
      console.error('Sync.' + label + ' 网络异常:', e.message || e);
      return null;
    }
  }

  // ============================================================
  // 错题本
  // ============================================================

  /** 添加错题 */
  async function addWrongQuestion(version, questionId, chapter, type) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c.from('wrong_questions').upsert(
        {
          user_id: u,
          version: version,
          question_id: questionId,
          chapter: chapter || '',
          type: type || '',
        },
        { onConflict: 'user_id,version,question_id' }
      ),
      'addWrongQuestion'
    );
  }

  /** 移除错题（答对后） */
  async function removeWrongQuestion(version, questionId) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c
        .from('wrong_questions')
        .delete()
        .eq('user_id', u)
        .eq('version', version)
        .eq('question_id', questionId),
      'removeWrongQuestion'
    );
  }

  /** 获取当前版本的全部错题（返回 question_id 集合） */
  async function getWrongQuestions(version) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return [];
    }

    const data = await silent(
      c.from('wrong_questions').select('question_id').eq('user_id', u).eq('version', version),
      'getWrongQuestions'
    );
    if (!data) {
      return [];
    }
    return data.map(function (row) {
      return row.question_id;
    });
  }

  // ============================================================
  // 答题统计
  // ============================================================

  /** 记录一次答题结果 */
  async function recordAnswer(version, questionId, chapter, type, isCorrect) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c.from('answer_history').insert({
        user_id: u,
        version: version,
        question_id: questionId,
        chapter: chapter || '',
        type: type || '',
        is_correct: isCorrect,
      }),
      'recordAnswer'
    );
  }

  /**
   * 获取统计数据（数据库端聚合，避免分页拉全表）。
   * 依赖 init_supabase.sql 中创建的 RPC get_answer_stats(text)，
   * 返回按章节分组的 { chapter, total, correct } 行，前端累加得到总量。
   */
  async function getStats(version) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    const rows = await silent(c.rpc('get_answer_stats', { p_version: version }), 'getStats');
    if (!rows) {
      return { total: 0, correct: 0, wrong: 0, accuracy: 0, byChapter: {} };
    }

    let total = 0;
    let correct = 0;
    const byChapter = {};
    rows.forEach(function (r) {
      const chapterTotal = Number(r.total) || 0;
      const chapterCorrect = Number(r.correct) || 0;
      total += chapterTotal;
      correct += chapterCorrect;
      if (r.chapter) {
        byChapter[r.chapter] = { total: chapterTotal, correct: chapterCorrect };
      }
    });

    return {
      total: total,
      correct: correct,
      wrong: total - correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      byChapter: byChapter,
    };
  }

  // ============================================================
  // 题目笔记
  // ============================================================

  /** 保存/更新笔记 */
  async function saveNote(version, questionId, content) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c.from('question_notes').upsert(
        {
          user_id: u,
          version: version,
          question_id: questionId,
          content: content,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,version,question_id' }
      ),
      'saveNote'
    );
  }

  /** 删除笔记 */
  async function deleteNote(version, questionId) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c
        .from('question_notes')
        .delete()
        .eq('user_id', u)
        .eq('version', version)
        .eq('question_id', questionId),
      'deleteNote'
    );
  }

  /** 获取当前版本的全部笔记（返回 { questionId: content } 映射） */
  async function getNotes(version) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return {};
    }

    const data = await silent(
      c
        .from('question_notes')
        .select('question_id,content')
        .eq('user_id', u)
        .eq('version', version),
      'getNotes'
    );
    if (!data) {
      return {};
    }

    const map = {};
    data.forEach(function (row) {
      map[row.question_id] = row.content;
    });
    return map;
  }

  // ============================================================
  // 纠错反馈
  // ============================================================

  /** 提交题目纠错报告 */
  async function submitReport(version, questionId, reason, detail) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    return silent(
      c.from('question_reports').upsert(
        {
          user_id: u,
          version: version,
          question_id: questionId,
          reason: reason,
          detail: detail || '',
          status: 'pending',
        },
        { onConflict: 'user_id,version,question_id' }
      ),
      'submitReport'
    );
  }

  // ============================================================
  // 暴露 API
  // ============================================================
  window.Sync = {
    // 错题
    addWrongQuestion: addWrongQuestion,
    removeWrongQuestion: removeWrongQuestion,
    getWrongQuestions: getWrongQuestions,
    // 统计
    recordAnswer: recordAnswer,
    getStats: getStats,
    // 笔记
    saveNote: saveNote,
    deleteNote: deleteNote,
    getNotes: getNotes,
    // 报错
    submitReport: submitReport,
  };
})();
