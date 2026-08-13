/**
 * filter.js — 题目筛选纯函数
 * 暴露 window.Filter：searchIn / countByType / getCurrentQuestions
 *
 * 全部为无 DOM 副作用的纯函数（读取 State、返回新数组/对象），可独立单测。
 */
(function () {
  'use strict';
  if (typeof window.State === 'undefined') {
    throw new Error('state.js must be loaded before filter.js');
  }

  const S = window.State;

  /** 全字段模糊搜索：匹配题目文本、答案、章节名、题型和选项（大小写不敏感） */
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
   * 根据当前状态（模式/章节/题型/搜索词）筛选当前要显示的题目列表。
   * 优先级：错题模式 → 搜索 → 章节 → 题型。
   */
  function getCurrentQuestions() {
    const appState = S.get();
    const flatQuestionList = S.flatQs;
    if (appState.mode === 'wrong') {
      return flatQuestionList.filter(function (question) {
        return S.isWrong(question._id);
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

  window.Filter = {
    searchIn: searchIn,
    countByType: countByType,
    getCurrentQuestions: getCurrentQuestions,
  };
})();
