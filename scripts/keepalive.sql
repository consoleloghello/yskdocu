-- ============================================================
-- Supabase 免费版「防暂停」保活脚本
--
-- 使用方式：
--   1. 打开 Supabase Dashboard → SQL Editor
--   2. 粘贴本文件全部内容并执行（幂等，可重复执行）
--   3. 执行后访问 /.github/workflows/keepalive.yml 手动触发一次验证
--
-- 为什么不能只做 SELECT 保活？
--   Supabase 官方文档：免费项目「在一周内没有足够的用户数据库活动」会被暂停，
--   并且明确说「每天对数据库发几次用户请求」才够。
--   实测与社区反馈都表明：对 PostgREST 发只读 SELECT（尤其是 RLS 过滤后返回空
--   数组、或请求 /rest/v1/ 根路径）不足以重置不活跃计时器 —— 项目仍会收到
--   暂停警告邮件。真正保险的做法是产生一次「写入」（INSERT/UPDATE），
--   让数据库产生 WAL / xact_commit 级别的真实用户事务。
--
-- 本脚本提供：
--   public.keepalive        单行表，记录最后一次保活时间与累计次数
--   public.keepalive_ping() SECURITY DEFINER 的 UPSERT 函数，anon 可调用
--
-- 安全说明：
--   anon key 是公开密钥，任何人都能调用 keepalive_ping()。
--   该函数只会 UPSERT 固定 id=1 的那一行（表永远只有 1 行），
--   并内置 60 秒节流，无法被用来放大数据量或消耗配额。
-- ============================================================

-- ------------------------------------------------------------
-- 一、保活表（永远只有 id = 1 这一行）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.keepalive (
  id         int PRIMARY KEY,
  last_ping  timestamptz NOT NULL DEFAULT now(),
  ping_count bigint      NOT NULL DEFAULT 0,
  source     text
);

-- 启用 RLS 且不创建任何策略 → anon / authenticated 都无法直接读写该表，
-- 只能通过下面的 SECURITY DEFINER 函数间接产生一次写入。
ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.keepalive FROM anon, authenticated;

-- 初始化唯一的那一行
INSERT INTO public.keepalive (id, last_ping, ping_count, source)
VALUES (1, now(), 0, 'init')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 二、保活函数（anon 可调用，产生一次真实写入）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.keepalive_ping(p_source text DEFAULT 'unknown')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last  timestamptz;
  v_count bigint;
BEGIN
  -- 节流：60 秒内的重复调用只读不写，防止公开 anon key 被滥用刷写
  SELECT last_ping, ping_count
    INTO v_last, v_count
    FROM public.keepalive
   WHERE id = 1
     AND last_ping > now() - interval '60 seconds';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'throttled', true,
      'last_ping', v_last,
      'ping_count', v_count
    );
  END IF;

  UPDATE public.keepalive
     SET last_ping  = now(),
         ping_count = ping_count + 1,
         source     = coalesce(p_source, 'unknown')
   WHERE id = 1
  RETURNING last_ping, ping_count INTO v_last, v_count;

  RETURN jsonb_build_object(
    'ok', true,
    'throttled', false,
    'last_ping', v_last,
    'ping_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.keepalive_ping(text) FROM public;
GRANT EXECUTE ON FUNCTION public.keepalive_ping(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 三、可选：数据库内部自唤醒（pg_cron）
--
-- 额外一层保险：即使外部定时任务（GitHub Actions / 本机 cron）全部失效，
-- 数据库自己每 6 小时也会跑一次 keepalive_ping()。
-- 免费版即可使用 pg_cron。若不需要，跳过这一节即可。
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('supabase-keepalive')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'supabase-keepalive');

SELECT cron.schedule(
  'supabase-keepalive',
  '17 */6 * * *',
  $$SELECT public.keepalive_ping('pg_cron');$$
);

-- ------------------------------------------------------------
-- 四、验证
-- ------------------------------------------------------------
-- 1) 直接调用一次，应返回 ok=true 的 JSON：
--    SELECT public.keepalive_ping('manual-test');
--
-- 2) 查看保活记录（谁在保活、多久没跑）：
--    SELECT id, last_ping, ping_count, source, now() - last_ping AS ago
--    FROM public.keepalive;
--
-- 3) 查看 pg_cron 任务是否已注册（应返回 1 行，active = true）：
--    SELECT jobid, jobname, schedule, active, command
--    FROM cron.job
--    WHERE jobname = 'supabase-keepalive';
--
-- 4) 查看 pg_cron 执行历史。
--    注意：cron.job_run_details 只有 jobid，【没有 jobname 列】，
--    想显示任务名必须 JOIN cron.job，否则报 42703:
--      column "jobname" does not exist
--    刚建完任务是查不到记录的（下一次触发在 UTC 0:17 / 6:17 / 12:17 / 18:17）。
--    SELECT j.jobname, d.status, d.start_time, d.end_time, d.return_message
--    FROM cron.job_run_details d
--    LEFT JOIN cron.job j ON j.jobid = d.jobid
--    ORDER BY d.start_time DESC
--    LIMIT 10;
--
-- 5) 若确认 pg_cron 没有生效，可删掉该任务（不影响其余两层保活）：
--    SELECT cron.unschedule('supabase-keepalive');
-- ------------------------------------------------------------
