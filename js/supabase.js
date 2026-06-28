/**
 * Supabase 认证模块
 * 初始化客户端、管理登录/登出/注册、监听认证状态变化
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

/** 邮箱密码注册 */
async function signUp(email, password, nickname) {
  if (!supabase) throw new Error('Supabase 未初始化');
  var options = {};
  if (nickname) options.data = { nickname: nickname };
  const { data, error } = await supabase.auth.signUp({ email, password, options });
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
// 登录/注册弹窗事件绑定
// ============================================================
function initLoginModal() {
  var loginBtn = document.getElementById('loginBtn');
  var loginModal = document.getElementById('loginModal');
  var loginSubmit = document.getElementById('loginSubmit');
  var loginCancel = document.getElementById('loginCancel');
  var loginEmail = document.getElementById('loginEmail');
  var loginPassword = document.getElementById('loginPassword');
  var loginError = document.getElementById('loginError');
  var authTitle = document.getElementById('authTitle');
  var regNickname = document.getElementById('regNickname');
  var authToggle = document.getElementById('authToggle');
  var authToggleText = document.getElementById('authToggleText');

  if (!loginModal) return;

  // 当前模式：'login' | 'register'
  var mode = 'login';

  function setMode(m) {
    mode = m;
    if (authTitle) {
      authTitle.textContent = m === 'login' ? '🔐 登录' : '📝 注册';
    }
    if (regNickname) {
      regNickname.style.display = m === 'register' ? '' : 'none';
    }
    if (loginSubmit) {
      loginSubmit.textContent = m === 'login' ? '登录' : '注册';
    }
    if (authToggleText) {
      authToggleText.textContent = m === 'login' ? '没有账号？注册' : '已有账号？登录';
    }
    if (loginError) loginError.textContent = '';
  }

  // 点击登录按钮 → 显示弹窗（默认登录模式）
  if (loginBtn) {
    loginBtn.addEventListener('click', function() {
      setMode('login');
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

  // 登录/注册切换
  if (authToggle) {
    authToggle.addEventListener('click', function(e) {
      e.preventDefault();
      setMode(mode === 'login' ? 'register' : 'login');
    });
  }

  // 提交（登录或注册）
  if (loginSubmit) {
    loginSubmit.addEventListener('click', async function() {
      var email = loginEmail ? loginEmail.value.trim() : '';
      var password = loginPassword ? loginPassword.value.trim() : '';

      if (!email || !password) {
        if (loginError) loginError.textContent = '请输入邮箱和密码';
        return;
      }

      loginSubmit.disabled = true;
      loginSubmit.textContent = mode === 'login' ? '登录中...' : '注册中...';
      if (loginError) loginError.textContent = '';

      try {
        if (mode === 'login') {
          await signIn(email, password);
          loginModal.style.display = 'none';
          if (loginEmail) loginEmail.value = '';
          if (loginPassword) loginPassword.value = '';
          if (regNickname) regNickname.value = '';
        } else {
          var nickname = regNickname ? regNickname.value.trim() : '';
          var result = await signUp(email, password, nickname);
          // 检查是否需要邮箱验证
          if (result.user && result.user.identities && result.user.identities.length === 0) {
            // identities 为空表示用户已存在但未确认，或已注册
            if (loginError) loginError.textContent = '该邮箱已注册，请直接登录';
          } else if (result.session) {
            // 邮箱验证已关闭，注册后直接登录
            loginModal.style.display = 'none';
            if (loginEmail) loginEmail.value = '';
            if (loginPassword) loginPassword.value = '';
            if (regNickname) regNickname.value = '';
          } else {
            // 需要邮箱验证
            if (loginError) loginError.textContent = '注册成功！请检查邮箱并点击验证链接';
            loginSubmit.disabled = false;
            loginSubmit.textContent = '注册';
            return; // 不要恢复按钮状态
          }
        }
      } catch (e) {
        if (loginError) {
          var msg = e.message || '';
          if (msg.includes('Invalid login credentials')) {
            loginError.textContent = '邮箱或密码错误';
          } else if (msg.includes('Email not confirmed')) {
            loginError.textContent = '邮箱未验证，请先验证邮箱';
          } else if (msg.includes('User already registered')) {
            loginError.textContent = '该邮箱已注册，请直接登录';
          } else if (msg.includes('Password should be')) {
            loginError.textContent = '密码长度至少6位';
          } else {
            loginError.textContent = (mode === 'login' ? '登录' : '注册') + '失败：' + msg;
          }
        }
      } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = mode === 'login' ? '登录' : '注册';
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
    if (regNickname) {
      regNickname.addEventListener('keydown', function(e) {
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
  signUp: signUp,
  signOut: signOut,
  getUser: getUser,
  isLoggedIn: isLoggedIn,
  getClient: getClient,
  onAuthStateChange: onAuthStateChange
};

})();
