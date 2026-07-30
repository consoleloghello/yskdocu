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
   * 分页获取全部行，避免 Supabase 默认行数限制截断数据
   * Supabase 单次查询默认最多返回 1000 行，通过 range() 分批拉取
   * 循环终止条件：某次返回的行数少于 batchSize，说明已是最后一批
   */
  async function fetchAll(queryFn, label, batchSize) {
    if (!batchSize) {
      batchSize = 1000;
    }
    let all = [];
    let from = 0;
    let to = batchSize - 1;
    let batch;
    do {
      batch = await silent(queryFn().range(from, to), label);
      if (batch && batch.length) {
        all = all.concat(batch);
      }
      from = to + 1;
      to = from + batchSize - 1;
    } while (batch && batch.length === batchSize);
    return all;
  }

  /** 获取统计数据 */
  async function getStats(version) {
    const c = client();
    const u = uid();
    if (!c || !u) {
      return null;
    }

    // 第一步：仅拉取 is_correct 字段计算总答题数和正确数
    // 分两次查询而非一次全字段查询，减少单次传输的数据量
    const countResult = await fetchAll(function () {
      return c.from('answer_history').select('is_correct').eq('user_id', u).eq('version', version);
    }, 'getStats.count');

    const total = countResult.length;
    const correct = countResult.filter(function (r) {
      return r.is_correct;
    }).length;

    // 第二步：拉取 chapter + is_correct 字段计算各章节统计
    const chapterResult = await fetchAll(function () {
      return c
        .from('answer_history')
        .select('chapter,is_correct')
        .eq('user_id', u)
        .eq('version', version);
    }, 'getStats.chapters');

    const byChapter = {};
    chapterResult.forEach(function (r) {
      if (!r.chapter) {
        return;
      }
      if (!byChapter[r.chapter]) {
        byChapter[r.chapter] = { total: 0, correct: 0 };
      }
      byChapter[r.chapter].total++;
      if (r.is_correct) {
        byChapter[r.chapter].correct++;
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
