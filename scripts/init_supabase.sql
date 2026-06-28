-- ============================================================
-- 公用工程题库 Supabase 数据库初始化脚本
--
-- 使用方式：
--   1. 在 Supabase Dashboard → SQL Editor 中打开
--   2. 全选并执行（或逐段执行）
--   3. 执行完毕后检查 Tables 页面确认所有表已创建
--
-- 注意：
--   本脚本假定在 Supabase 环境中执行（auth.users 表已存在）
--   如果某个表已存在需要重建，请先 DROP TABLE IF EXISTS
-- ============================================================

-- ============================================================
-- 一、创建用户资料表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  nickname    text,
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- 二、创建错题本表
-- 记录用户做错的题目，每个用户每道题只保留一条记录
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wrong_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  version     text NOT NULL,           -- '外操版' 或 '内操版'
  question_id text NOT NULL,           -- 题目 _id，如 '火炬_选择题_0'
  chapter     text,                    -- 章节名（冗余存储，方便统计）
  type        text,                    -- 题型（冗余存储，方便统计）
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, version, question_id)
);

-- ============================================================
-- 三、创建答题历史表
-- 记录每次答题的对错，用于统计正确率
-- ============================================================
CREATE TABLE IF NOT EXISTS public.answer_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  version     text NOT NULL,
  question_id text NOT NULL,
  chapter     text,
  type        text,
  is_correct  boolean NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- 四、创建题目报错表
-- 用户提交的纠错反馈
-- ============================================================
CREATE TABLE IF NOT EXISTS public.question_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  version     text NOT NULL,
  question_id text NOT NULL,
  reason      text NOT NULL,           -- 报错原因分类
  detail      text,                    -- 详细说明
  status      text DEFAULT 'pending',  -- pending | reviewed | fixed
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- 五、创建题目笔记表
-- 用户对题目的私人笔记
-- ============================================================
CREATE TABLE IF NOT EXISTS public.question_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  version     text NOT NULL,
  question_id text NOT NULL,
  content     text NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, version, question_id)
);

-- ============================================================
-- 六、创建索引
-- ============================================================

-- 错题查询加速
CREATE INDEX IF NOT EXISTS idx_wrong_questions_user_version
  ON wrong_questions(user_id, version);

-- 统计查询加速
CREATE INDEX IF NOT EXISTS idx_answer_history_user_version
  ON answer_history(user_id, version);

CREATE INDEX IF NOT EXISTS idx_answer_history_chapter
  ON answer_history(user_id, version, chapter);

-- 按时间排序加速
CREATE INDEX IF NOT EXISTS idx_answer_history_created_at
  ON answer_history(user_id, created_at DESC);

-- 笔记查询加速
CREATE INDEX IF NOT EXISTS idx_question_notes_user_version
  ON question_notes(user_id, version);

-- 报错查询加速
CREATE INDEX IF NOT EXISTS idx_question_reports_user
  ON question_reports(user_id);

-- ============================================================
-- 七、启用 Row Level Security
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wrong_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 八、创建 RLS 策略（用户只能访问自己的数据）
-- ============================================================

-- profiles 表
DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;
CREATE POLICY "Users can manage own profile"
  ON public.profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- wrong_questions 表
DROP POLICY IF EXISTS "Users can manage own wrong questions" ON public.wrong_questions;
CREATE POLICY "Users can manage own wrong questions"
  ON public.wrong_questions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- answer_history 表
DROP POLICY IF EXISTS "Users can manage own answer history" ON public.answer_history;
CREATE POLICY "Users can manage own answer history"
  ON public.answer_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- question_reports 表
DROP POLICY IF EXISTS "Users can manage own reports" ON public.question_reports;
CREATE POLICY "Users can manage own reports"
  ON public.question_reports
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- question_notes 表
DROP POLICY IF EXISTS "Users can manage own notes" ON public.question_notes;
CREATE POLICY "Users can manage own notes"
  ON public.question_notes
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 九、创建自动创建 Profile 的触发器
-- 新用户注册时，自动在 profiles 表中插入记录
-- ============================================================

-- 触发器函数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nickname)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'nickname',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;

-- 触发器绑定
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 十、授予权限
-- ============================================================

-- 允许已认证用户访问 public schema 下的表
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.wrong_questions TO authenticated;
GRANT ALL ON public.answer_history TO authenticated;
GRANT ALL ON public.question_reports TO authenticated;
GRANT ALL ON public.question_notes TO authenticated;

-- 允许 anon key 通过 RLS 访问（RLS 策略限制访问范围）
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrong_questions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answer_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_notes TO anon;

-- ============================================================
-- 初始化完成
-- ============================================================
-- 验证：执行以下查询确认表已创建
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
--
-- 下一步：
--   1. Authentication → Settings → 关闭 "Enable Sign Up"
--   2. Authentication → Users → 手动添加白名单用户
--   3. 将 SUPABASE_URL 和 SUPABASE_ANON_KEY 填入 js/supabase.js
-- ============================================================
