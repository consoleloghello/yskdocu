/**
 * Supabase 认证模块
 * 初始化客户端、管理登录/登出/注册、监听认证状态变化
 * 暴露为 window.SupabaseAuth
 *
 * 使用前需将下方的 SUPABASE_URL 和 SUPABASE_ANON_KEY 替换为实际值
 */
(function () {
  'use strict';

  // ============================================================
  // 配置 — 部署前替换为 Supabase 项目的实际值
  // ============================================================
  const SUPABASE_URL = 'https://fbzfcjvzivivupmnqqpp.supabase.co';
  const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZiemZjanZ6aXZpdnVwbW5xcXBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTgzMDIsImV4cCI6MjA5ODE5NDMwMn0.FsT5fLbAo2CjcERrNrzuWZmZmiiqXPSpZ80d9Ipf60w';

  // ============================================================
  // 初始化
  // ============================================================
  let supabase = null;
  let currentUser = null;
  let pendingEmail = ''; // 注册后等待验证的邮箱
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
    supabase.auth.onAuthStateChange(function (event, session) {
      currentUser = session ? session.user : null;
      updateAuthUI();
      // 通知所有注册的回调
      authChangeCallbacks.forEach(function (cb) {
        cb(currentUser);
      });
    });
  }

  // ============================================================
  // 公开方法
  // ============================================================

  /** 邮箱密码登录 */
  async function signIn(email, password) {
    if (!supabase) {
      throw new Error('Supabase 未初始化');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
    return data;
  }

  /**
   * 邮箱密码注册
   * 注册后根据 Supabase 设置可能直接登录（session 存在）
   * 或进入邮箱验证流程（identities 为空表示用户已存在）
   */
  async function signUp(email, password, nickname) {
    if (!supabase) {
      throw new Error('Supabase 未初始化');
    }
    const options = {};
    if (nickname) {
      options.data = { nickname: nickname };
    }
    const { data, error } = await supabase.auth.signUp({ email, password, options });
    if (error) {
      throw error;
    }
    return data;
  }

  /** 登出 */
  async function signOut() {
    if (!supabase) {
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }

  /** 发送邮箱验证码 OTP */
  async function sendOtp(email) {
    if (!supabase) {
      throw new Error('Supabase 未初始化');
    }
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      throw error;
    }
    return data;
  }

  /** 验证邮箱 OTP Token（注册确认） */
  async function verifyOtpToken(email, token) {
    if (!supabase) {
      throw new Error('Supabase 未初始化');
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });
    if (error) {
      throw error;
    }
    return data;
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

    if (!loginBtn || !userInfo) {
      return;
    }

    if (currentUser) {
      loginBtn.style.display = 'none';
      userInfo.style.display = 'flex';
      if (userName) {
        // 显示用户信息：优先 nickname（注册时可选填），再取邮箱 @ 前缀，最后 fallback 为「用户」
        userName.textContent =
          currentUser.user_metadata?.nickname ||
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
    const loginBtn = document.getElementById('loginBtn');
    const loginModal = document.getElementById('loginModal');
    const loginSubmit = document.getElementById('loginSubmit');
    const loginCancel = document.getElementById('loginCancel');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginError = document.getElementById('loginError');
    const authTitle = document.getElementById('authTitle');
    const regNickname = document.getElementById('regNickname');
    const authToggle = document.getElementById('authToggle');
    const authToggleText = document.getElementById('authToggleText');

    if (!loginModal) {
      return;
    }

    // 当前模式：'login' | 'register'
    let mode = 'login';

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
      if (loginError) {
        loginError.textContent = '';
      }
    }

    // 点击登录按钮 → 显示弹窗（有待验证邮箱则恢复验证界面）
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        if (pendingEmail) {
          showVerifyUI();
        } else {
          setMode('login');
        }
        loginModal.style.display = 'flex';
        if (loginEmail && !pendingEmail) {
          loginEmail.focus();
        }
      });
    }

    // 取消 / 关闭 (处理验证状态的清理)
    // 以下变量供上方闭包及验证 UI 函数引用，提前声明
    const authFields = document.getElementById('authFields');
    const verifySection = document.getElementById('verifySection');
    const verifyToken = document.getElementById('verifyToken');
    const verifyError = document.getElementById('verifyError');
    const verifyHint = document.getElementById('verifyHint');
    const verifySubmitBtn = document.getElementById('verifySubmitBtn');
    const resendToken = document.getElementById('resendToken');
    const verifyBack = document.getElementById('verifyBack');

    if (loginCancel) {
      loginCancel.addEventListener('click', function () {
        loginModal.style.display = 'none';
        if (loginError) {
          loginError.textContent = '';
        }
        if (verifyError) {
          verifyError.textContent = '';
        }
      });
    }

    // 点击遮罩关闭
    loginModal.addEventListener('click', function (e) {
      if (e.target === loginModal) {
        loginModal.style.display = 'none';
        if (loginError) {
          loginError.textContent = '';
        }
        if (verifyError) {
          verifyError.textContent = '';
        }
      }
    });

    // 登录/注册切换
    if (authToggle) {
      authToggle.addEventListener('click', function (e) {
        e.preventDefault();
        setMode(mode === 'login' ? 'register' : 'login');
      });
    }

    // 提交（登录或注册）
    if (loginSubmit) {
      loginSubmit.addEventListener('click', async function () {
        const email = loginEmail ? loginEmail.value.trim() : '';
        const password = loginPassword ? loginPassword.value.trim() : '';

        if (!email || !password) {
          if (loginError) {
            loginError.textContent = '请输入邮箱和密码';
          }
          return;
        }

        loginSubmit.disabled = true;
        loginSubmit.textContent = mode === 'login' ? '登录中...' : '注册中...';
        if (loginError) {
          loginError.textContent = '';
        }

        try {
          if (mode === 'login') {
            await signIn(email, password);
            loginModal.style.display = 'none';
            if (loginEmail) {
              loginEmail.value = '';
            }
            if (loginPassword) {
              loginPassword.value = '';
            }
            if (regNickname) {
              regNickname.value = '';
            }
          } else {
            const nickname = regNickname ? regNickname.value.trim() : '';
            const result = await signUp(email, password, nickname);
            // 检查是否需要邮箱验证
            if (result.user && result.user.identities && result.user.identities.length === 0) {
              // identities 为空表示用户已存在但未确认，或已注册
              if (loginError) {
                loginError.textContent = '该邮箱已注册，请直接登录';
              }
            } else if (result.session) {
              // 邮箱验证已关闭，注册后直接登录
              loginModal.style.display = 'none';
              if (loginEmail) {
                loginEmail.value = '';
              }
              if (loginPassword) {
                loginPassword.value = '';
              }
              if (regNickname) {
                regNickname.value = '';
              }
            } else {
              // 需要邮箱验证 → signUp 已发送确认邮件（含 Token），直接显示验证码输入区
              pendingEmail = email;
              showVerifyUI();
              loginSubmit.disabled = false;
              loginSubmit.textContent = '注册';
              return; // 保持弹窗打开，等待验证
            }
          }
        } catch (e) {
          if (loginError) {
            const msg = e.message || '';
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
        loginPassword.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && loginSubmit && !loginSubmit.disabled) {
            loginSubmit.click();
          }
        });
      }
      if (regNickname) {
        regNickname.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && loginSubmit && !loginSubmit.disabled) {
            loginSubmit.click();
          }
        });
      }
    }

    // 登出按钮
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        try {
          await signOut();
        } catch (e) {
          console.error('登出失败:', e);
        }
      });
    }

    function showVerifyUI() {
      if (authFields) {
        authFields.style.display = 'none';
      }
      if (verifySection) {
        verifySection.style.display = '';
      }
      if (loginCancel) {
        loginCancel.textContent = '关闭';
      }
      if (authTitle) {
        authTitle.textContent = '📧 验证邮箱';
      }
      if (loginError) {
        loginError.textContent = '';
      }
      if (verifyError) {
        verifyError.textContent = '';
      }
      if (verifyToken) {
        verifyToken.value = '';
        verifyToken.focus();
      }
      if (verifyHint) {
        verifyHint.textContent =
          '验证码已发送至 ' + pendingEmail + '，请查收注册确认邮件并输入验证码';
      }
    }

    function hideVerifyUI(keepPending) {
      if (authFields) {
        authFields.style.display = '';
      }
      if (verifySection) {
        verifySection.style.display = 'none';
      }
      if (loginError) {
        loginError.textContent = '';
      }
      if (verifyError) {
        verifyError.textContent = '';
      }
      if (verifyToken) {
        verifyToken.value = '';
      }
      if (loginCancel) {
        loginCancel.textContent = '取消';
      }
      if (!keepPending) {
        pendingEmail = '';
      }
    }

    // 提交验证码
    if (verifySubmitBtn) {
      verifySubmitBtn.addEventListener('click', async function () {
        const token = verifyToken ? verifyToken.value.trim() : '';
        if (!token || token.length < 8) {
          if (verifyError) {
            verifyError.textContent = '请输入8位验证码';
          }
          return;
        }
        if (!pendingEmail) {
          if (verifyError) {
            verifyError.textContent = '验证信息已过期，请重新注册';
          }
          return;
        }

        verifySubmitBtn.disabled = true;
        verifySubmitBtn.textContent = '验证中...';
        if (verifyError) {
          verifyError.textContent = '';
        }

        try {
          await verifyOtpToken(pendingEmail, token);
          // 验证成功 → 关闭弹窗
          hideVerifyUI();
          loginModal.style.display = 'none';
          if (loginEmail) {
            loginEmail.value = '';
          }
          if (loginPassword) {
            loginPassword.value = '';
          }
          if (regNickname) {
            regNickname.value = '';
          }
        } catch (e) {
          if (verifyError) {
            const msg = e.message || '';
            if (msg.includes('Token has expired') || msg.includes('expired')) {
              verifyError.textContent = '验证码已过期，请重新发送';
            } else if (msg.includes('Invalid')) {
              verifyError.textContent = '验证码错误，请检查后重试';
            } else {
              verifyError.textContent = '验证失败：' + msg;
            }
          }
        } finally {
          verifySubmitBtn.disabled = false;
          verifySubmitBtn.textContent = '验证邮箱';
        }
      });

      // 回车提交验证码
      if (verifyToken) {
        verifyToken.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && verifySubmitBtn && !verifySubmitBtn.disabled) {
            verifySubmitBtn.click();
          }
        });
      }
    }

    // 重新发送验证码
    if (resendToken) {
      resendToken.addEventListener('click', async function (e) {
        e.preventDefault();
        if (!pendingEmail) {
          return;
        }
        resendToken.textContent = '发送中...';
        resendToken.style.pointerEvents = 'none';
        try {
          await supabase.auth.resend({ type: 'signup', email: pendingEmail });
          if (verifyHint) {
            verifyHint.textContent = '验证码已重新发送至 ' + pendingEmail;
          }
          if (verifyError) {
            verifyError.textContent = '';
          }
        } catch (otpErr) {
          if (verifyError) {
            verifyError.textContent = '发送失败：' + (otpErr.message || '请稍后重试');
          }
        } finally {
          resendToken.textContent = '重新发送';
          resendToken.style.pointerEvents = '';
        }
      });
    }

    // 返回登录（清除待验证状态）
    if (verifyBack) {
      verifyBack.addEventListener('click', function (e) {
        e.preventDefault();
        hideVerifyUI();
        setMode('login');
      });
    }
  }

  // ============================================================
  // 启动：页面加载后检查 session + 绑定事件
  // ============================================================
  if (supabase) {
    supabase.auth.getSession().then(function (result) {
      const session = result.data && result.data.session;
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
    sendOtp: sendOtp,
    verifyOtpToken: verifyOtpToken,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    getClient: getClient,
    onAuthStateChange: onAuthStateChange,
  };
})();
