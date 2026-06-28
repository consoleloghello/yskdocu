/**
 * Supabase 认证模块
 * 初始化客户端、管理登录/登出、监听认证状态变化
 * 暴露为 window.SupabaseAuth
 *
 * 使用前需将下方的 SUPABASE_URL 和 SUPABASE_ANON_KEY 替换为实际值
 */
(function(){
'use strict';

// ============================================================
// 配置 — 部署前替换为 Supabase 项目的实际值
// ============================================================
const SUPABASE_URL = 'https://fbzfcjvzivivupmnqqpp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZiemZjanZ6aXZpdnVwbW5xcXBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTgzMDIsImV4cCI6MjA5ODE5NDMwMn0.FsT5fLbAo2CjcERrNrzuWZmZmiiqXPSpZ80d9Ipf60w';

// ============================================================
// 初始化
// ============================================================
let supabase = null;
let currentUser = null;
const authChangeCallbacks = [];

try {
  if (typeof window.supabase === 'undefined') {
    console.warn('Supabase SDK 未加载，后端功能不可用');
  } else {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.error('Supabase 客户端初始化失败:', e);
}

// ============================================================
// 认证状态监听
// ============================================================
if (supabase) {
  supabase.auth.onAuthStateChange(function(event, session) {
    currentUser = session ? session.user : null;
    updateAuthUI();
    // 通知所有注册的回调
    authChangeCallbacks.forEach(function(cb) { cb(currentUser); });
  });
}

// ============================================================
// 公开方法
// ============================================================

/** 邮箱密码登录 */
async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase 未初始化');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** 登出 */
async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** 获取当前用户（null 表示未登录） */
function getUser() {
  return currentUser;
}

/** 注册认证状态变化回调，回调参数为 user 对象或 null */
function onAuthStateChange(cb) {
  authChangeCallbacks.push(cb);
}

/** 获取 supabase 客户端实例（供 sync.js 使用） */
function getClient() {
  return supabase;
}

/** 是否已登录 */
function isLoggedIn() {
  return !!currentUser;
}

// ============================================================
// UI 更新
// ============================================================
function updateAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const userName = document.getElementById('userName');

  if (!loginBtn || !userInfo) return;

  if (currentUser) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    if (userName) {
      // 优先显示用户自定义的 nickname（从 profiles 表），否则显示邮箱前缀
      userName.textContent = currentUser.user_metadata?.nickname ||
        (currentUser.email ? currentUser.email.split('@')[0] : '用户');
    }
  } else {
    loginBtn.style.display = '';
    userInfo.style.display = 'none';
  }
}

// ============================================================
// 登录弹窗事件绑定
// ============================================================
function initLoginModal() {
  var loginBtn = document.getElementById('loginBtn');
  var loginModal = document.getElementById('loginModal');
  var loginSubmit = document.getElementById('loginSubmit');
  var loginCancel = document.getElementById('loginCancel');
  var loginEmail = document.getElementById('loginEmail');
  var loginPassword = document.getElementById('loginPassword');
  var loginError = document.getElementById('loginError');

  if (!loginModal) return;

  // 点击登录按钮 → 显示弹窗
  if (loginBtn) {
    loginBtn.addEventListener('click', function() {
      loginModal.style.display = 'flex';
      if (loginEmail) loginEmail.focus();
    });
  }

  // 取消
  if (loginCancel) {
    loginCancel.addEventListener('click', function() {
      loginModal.style.display = 'none';
      if (loginError) loginError.textContent = '';
    });
  }

  // 点击遮罩关闭
  loginModal.addEventListener('click', function(e) {
    if (e.target === loginModal) {
      loginModal.style.display = 'none';
      if (loginError) loginError.textContent = '';
    }
  });

  // 提交登录
  if (loginSubmit) {
    loginSubmit.addEventListener('click', async function() {
      var email = loginEmail ? loginEmail.value.trim() : '';
      var password = loginPassword ? loginPassword.value.trim() : '';

      if (!email || !password) {
        if (loginError) loginError.textContent = '请输入邮箱和密码';
        return;
      }

      loginSubmit.disabled = true;
      loginSubmit.textContent = '登录中...';
      if (loginError) loginError.textContent = '';

      try {
        await signIn(email, password);
        loginModal.style.display = 'none';
        if (loginEmail) loginEmail.value = '';
        if (loginPassword) loginPassword.value = '';
      } catch (e) {
        if (loginError) {
          if (e.message.includes('Invalid login credentials')) {
            loginError.textContent = '邮箱或密码错误';
          } else if (e.message.includes('Email not confirmed')) {
            loginError.textContent = '邮箱未验证，请先验证邮箱';
          } else {
            loginError.textContent = '登录失败：' + e.message;
          }
        }
      } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = '登录';
      }
    });

    // 回车键提交
    if (loginPassword) {
      loginPassword.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && loginSubmit && !loginSubmit.disabled) {
          loginSubmit.click();
        }
      });
    }
  }

  // 登出按钮
  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
      try {
        await signOut();
      } catch (e) {
        console.error('登出失败:', e);
      }
    });
  }
}

// ============================================================
// 启动：页面加载后检查 session + 绑定事件
// ============================================================
if (supabase) {
  supabase.auth.getSession().then(function(result) {
    var session = result.data && result.data.session;
    currentUser = session ? session.user : null;
    updateAuthUI();
  });
}

// DOM 就绪后初始化弹窗事件
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginModal);
} else {
  initLoginModal();
}

// ============================================================
// 暴露 API
// ============================================================
window.SupabaseAuth = {
  signIn: signIn,
  signOut: signOut,
  getUser: getUser,
  isLoggedIn: isLoggedIn,
  getClient: getClient,
  onAuthStateChange: onAuthStateChange
};

})();
