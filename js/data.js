/**
 * data.js — 题库数据加载与展平
 * 暴露 window.Data：loadData / buildFlat / pullCloudData
 *
 * 负责：fetch gzip/json → buildFlat（稳定 _id + 旧 ID 迁移映射）→
 *       恢复/迁移本地错题本 → 拉取云端错题与笔记 → 触发渲染。
 */
(function () {
  'use strict';
  if (typeof window.State === 'undefined') {
    throw new Error('state.js must be loaded before data.js');
  }

  const S = window.State;
  const R = window.Render;
  const state = S.get();
  const $ = S.getEl;
  const C = S.CSS;

  /** 安全读取 localStorage JSON，解析失败返回 null */
  function safeLoadJSON(storageKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey));
    } catch (e) {
      // 数据损坏时静默处理
    }
    return null;
  }

  /**
   * 将嵌套的题库结构（章节→题型→题目）展平为扁平数组，并挂载到 State.flatQs。
   * 同时生成旧版 ID → 稳定 ID 的迁移映射 State.legacyIdMap。
   */
  function buildFlat() {
    const flatQs = [];
    // 旧版 ID（章节_题型_全局自增序号）→ 新版稳定 ID（章节_题型_本题型内序号）的迁移映射。
    // 旧版全局自增导致题库任一处增删题都会让后续所有 _id 漂移，进而串掉错题/笔记/报错。
    // 新版按「本题型内序号」命名，插入新题只影响本题型，跨题型不再串位。
    const legacyIdMap = {};
    let legacyCounter = 0;
    S.data.chapters.forEach(function (chapter) {
      chapter.type_groups.forEach(function (typeGroup) {
        typeGroup.questions.forEach(function (question, typeIndex) {
          const legacyId = chapter.name + '_' + typeGroup.type + '_' + legacyCounter++;
          question._id = chapter.name + '_' + typeGroup.type + '_' + typeIndex;
          question._chapter = chapter.name;
          question._type = typeGroup.type;
          legacyIdMap[legacyId] = question._id;
          flatQs.push(question);
        });
      });
    });
    S.flatQs = flatQs;
    S.legacyIdMap = legacyIdMap;
  }

  /**
   * 将 localStorage 中旧版（全局自增）错题 ID 迁移为稳定 ID。
   * 通过 buildFlat() 生成的 legacyIdMap（旧 ID → 新 ID）翻译，幂等且不丢数据。
   */
  function migrateLocalWrongBook(versionName) {
    const map = S.legacyIdMap || {};
    const wrongBookData = safeLoadJSON('ysk_wrong_' + versionName);
    if (!wrongBookData) {
      return;
    }
    let changed = false;
    const migrated = {};
    for (const key in wrongBookData) {
      const newId = map[key] !== undefined ? map[key] : key;
      if (newId !== key) {
        changed = true;
      }
      migrated[newId] = true;
    }
    state.wrongBook = migrated;
    if (changed) {
      S.save();
    }
  }

  /** 拉取云端错题本和笔记，合并到本地（旧版 ID 迁移为稳定 ID） */
  async function pullCloudData(versionName) {
    if (!window.Sync || !window.SupabaseAuth || !window.SupabaseAuth.isLoggedIn()) {
      return;
    }
    try {
      const map = S.legacyIdMap || {};
      const localNotes = S.getLocalNotes();
      // 拉取云端错题
      const cloudWrong = await window.Sync.getWrongQuestions(versionName);
      if (cloudWrong && cloudWrong.length) {
        for (const questionId of cloudWrong) {
          const newId = map[questionId] !== undefined ? map[questionId] : questionId;
          state.wrongBook[newId] = true;
          if (newId !== questionId) {
            // 云端旧 ID 行 → 重写为稳定 ID，并删除旧行，避免孤儿数据
            const q = S.flatQs.find((x) => x._id === newId);
            await window.Sync.addWrongQuestion(versionName, newId, q ? q._chapter : '', q ? q._type : '');
            await window.Sync.removeWrongQuestion(versionName, questionId);
          }
        }
        S.save();
      }
      // 拉取云端笔记
      const notes = await window.Sync.getNotes(versionName);
      if (notes) {
        for (const noteKey in notes) {
          const newKey = map[noteKey] !== undefined ? map[noteKey] : noteKey;
          localNotes[newKey] = notes[noteKey];
          if (newKey !== noteKey) {
            await window.Sync.saveNote(versionName, newKey, notes[noteKey]);
            await window.Sync.deleteNote(versionName, noteKey);
          }
        }
      }
    } catch (error) {
      console.error('pullCloudData error:', error);
    }
  }

  /**
   * 加载指定版本的题库数据。
   * 优先尝试 gzip 压缩版（.json.gz），失败时降级到未压缩版。
   * 加载完成后构建展平列表、恢复本地错题本、拉取云端数据，然后渲染。
   */
  async function loadData(versionName) {
    try {
      let data;
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
      // 每个版本默认收起选择/判断题答案，由用户主动展开（简答/实操/应急等题型始终展示）
      S.getRevealed().clear();
      state.version = versionName;
      if (versionName === '外操版') {
        $('verWaic').classList.add(C.ACTIVE);
        $('verNei').classList.remove(C.ACTIVE);
      } else {
        $('verNei').classList.add(C.ACTIVE);
        $('verWaic').classList.remove(C.ACTIVE);
      }
      // 恢复该版本的本地错题本，并将旧版（全局自增）ID 迁移为稳定 ID
      state.wrongBook = {};
      migrateLocalWrongBook(versionName);
      // 如果之前选中的章节在新版本中不存在（跨版本章节差异），回退到「全部」
      if (state.chapter !== 'all' && !data.chapters.find((chapter) => chapter.name === state.chapter)) {
        state.chapter = 'all';
      }
      S.save();
      // 登录状态下拉取云端错题和笔记
      await pullCloudData(versionName);
      R.render();
    } catch (error) {
      $('welcomeStats').textContent = '加载失败，请检查网络连接后刷新页面重试';
      console.error('loadData error:', error);
    }
  }

  window.Data = {
    loadData: loadData,
    buildFlat: buildFlat,
    pullCloudData: pullCloudData,
  };
})();
