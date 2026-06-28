-- ============================================================
-- 清空应用数据表（测试用）
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================================

-- 1. 先清空子表（引用 profiles 的表）
DELETE FROM wrong_questions;
DELETE FROM answer_history;
DELETE FROM question_reports;
DELETE FROM question_notes;

-- 2. 清空用户资料表
DELETE FROM profiles;

-- 3. 如需清空注册用户（auth.users），取消下面这行注释：
-- DELETE FROM auth.users;
-- 注意：执行后需要去 Supabase Dashboard → Authentication → Users
--       手动删除，上面的 SQL 可能因权限不足而失败

-- ============================================================
-- 验证清空结果
-- ============================================================
SELECT 'wrong_questions' AS 表名, count(*) AS 剩余行数 FROM wrong_questions
UNION ALL
SELECT 'answer_history', count(*) FROM answer_history
UNION ALL
SELECT 'question_reports', count(*) FROM question_reports
UNION ALL
SELECT 'question_notes', count(*) FROM question_notes
UNION ALL
SELECT 'profiles', count(*) FROM profiles;
