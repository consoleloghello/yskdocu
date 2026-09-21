"""Tests for Supabase 保活（防暂停）相关文件.

回归目的：防止有人把「写入式保活」改回「只读 SELECT 保活」。
历史事故：workflow 每天发只读 SELECT，返回 HTTP 200 且 job success，
但 Supabase 仍判定项目不活跃并发出暂停警告。
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

KEEPALIVE_SQL = ROOT / "scripts" / "keepalive.sql"
INIT_SQL = ROOT / "scripts" / "init_supabase.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "keepalive.yml"
SCRIPT_MJS = ROOT / "scripts" / "keepalive.mjs"
CRON_SH = ROOT / "scripts" / "keepalive-cron.sh"
PLIST = ROOT / "scripts" / "com.yskdocu.supabase-keepalive.plist"
PKG = ROOT / "package.json"


def read(path):
    return path.read_text(encoding="utf-8")


# ============================================================
# 数据库侧：keepalive.sql
# ============================================================

class TestKeepaliveSql:
    """数据库保活对象的结构与安全约束。"""

    def test_creates_single_row_table(self):
        sql = read(KEEPALIVE_SQL)
        assert re.search(r"CREATE TABLE IF NOT EXISTS public\.keepalive", sql, re.I)
        assert re.search(r"\bid\s+int\s+PRIMARY KEY", sql, re.I)

    def test_enables_rls(self):
        sql = read(KEEPALIVE_SQL)
        assert re.search(
            r"ALTER TABLE public\.keepalive ENABLE ROW LEVEL SECURITY", sql, re.I
        )

    def test_no_rls_policy_granting_direct_access(self):
        """不给 keepalive 表建任何策略 —— 只允许通过 RPC 间接写入。"""
        sql = read(KEEPALIVE_SQL)
        assert not re.search(r"CREATE POLICY[^;]*ON public\.keepalive", sql, re.I)

    def test_ping_function_is_security_definer(self):
        """SECURITY DEFINER 才能绕过 RLS（函数属主 postgres 是表属主）。"""
        sql = read(KEEPALIVE_SQL)
        fn = re.search(
            r"CREATE OR REPLACE FUNCTION public\.keepalive_ping.*?\$\$;", sql, re.S | re.I
        )
        assert fn, "未找到 keepalive_ping 函数定义"
        body = fn.group(0)
        assert re.search(r"SECURITY DEFINER", body, re.I)
        assert re.search(r"SET search_path = ''", body, re.I)

    def test_ping_function_performs_a_write(self):
        """核心：必须产生 UPDATE/INSERT，只读查询不足以保活。"""
        sql = read(KEEPALIVE_SQL)
        fn = re.search(
            r"CREATE OR REPLACE FUNCTION public\.keepalive_ping.*?\$\$;", sql, re.S | re.I
        ).group(0)
        assert re.search(r"\bUPDATE public\.keepalive\b", fn, re.I)
        assert re.search(r"\bSET\s+last_ping", fn, re.I), "应为真实写入而非 SELECT"

    def test_ping_function_is_throttled(self):
        """内置节流，防止公开 anon key 被滥用刷写。"""
        sql = read(KEEPALIVE_SQL)
        assert "interval '60 seconds'" in sql

    def test_permissions_lock_down_table_and_expose_only_rpc(self):
        sql = read(KEEPALIVE_SQL)
        assert re.search(r"REVOKE ALL ON public\.keepalive FROM anon, authenticated", sql, re.I)
        assert re.search(r"REVOKE ALL ON FUNCTION public\.keepalive_ping\(text\) FROM public", sql, re.I)
        assert re.search(
            r"GRANT EXECUTE ON FUNCTION public\.keepalive_ping\(text\) TO anon, authenticated",
            sql,
            re.I,
        )

    def test_optional_pg_cron_layer(self):
        sql = read(KEEPALIVE_SQL)
        assert re.search(r"CREATE EXTENSION IF NOT EXISTS pg_cron", sql, re.I)
        assert "supabase-keepalive" in sql

    def test_sql_is_idempotent(self):
        """可重复执行：关键对象均使用 IF NOT EXISTS / OR REPLACE / DO NOTHING。"""
        sql = read(KEEPALIVE_SQL)
        assert "ON CONFLICT (id) DO NOTHING" in sql
        assert re.search(r"CREATE OR REPLACE FUNCTION public\.keepalive_ping", sql)


class TestInitSqlIncludesKeepalive:
    """init_supabase.sql 也要包含保活对象（新环境一次建好）。"""

    def test_init_sql_has_keepalive_table_and_rpc(self):
        sql = read(INIT_SQL)
        assert "public.keepalive" in sql
        assert "public.keepalive_ping" in sql
        assert re.search(r"GRANT EXECUTE ON FUNCTION public\.keepalive_ping\(text\) TO anon", sql)


# ============================================================
# GitHub Actions workflow
# ============================================================

class TestKeepaliveWorkflow:
    def test_calls_write_rpc_not_only_select(self):
        wf = read(WORKFLOW)
        assert "/rest/v1/rpc/keepalive_ping" in wf, "必须调用写入式 RPC"

    def test_labels_rpc_call_as_post(self):
        """定位真正发起 RPC 的那段 curl，确认用的是 POST + apikey 头。

        注意：不要用带嵌套量词的正则去跨行匹配 shell 脚本，
        实测会触发灾难性回溯（ReDoS）把 pytest 挂死。
        """
        wf = read(WORKFLOW)
        block = []
        for line in wf.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if "curl" in stripped and not block:
                block.append(stripped)
            elif block:
                block.append(stripped)
                if "rpc/keepalive_ping" in stripped:
                    break

        joined = "\n".join(block)
        assert "curl" in joined, "未找到 curl 调用"
        assert re.search(r"-X\s+POST\b", joined), "RPC 必须以 POST 调用"
        assert "apikey: ${SUPABASE_ANON_KEY}" in joined
        assert "Authorization: Bearer ${SUPABASE_ANON_KEY}" in joined

    def test_runs_at_least_every_6_hours(self):
        wf = read(WORKFLOW)
        crons = re.findall(r"-\s+cron:\s*'([^']+)'", wf)
        assert crons, "未找到 cron 配置"
        assert crons[0] == "0 */6 * * *", f"保活频率过低：{crons[0]}（历史事故：1 次/天太贴近 7 天阈值）"

    def test_has_manual_dispatch(self):
        assert "workflow_dispatch" in read(WORKFLOW)

    def test_checks_response_body_not_just_status(self):
        wf = read(WORKFLOW)
        assert '"ok":true' in wf, "需要校验返回体，避免 200 但实际未写入"

    def test_alerts_on_failure(self):
        wf = read(WORKFLOW)
        assert "if: failure()" in wf
        assert "issues: write" in wf

    def test_closes_alert_issue_on_recovery(self):
        """恢复后自动关闭告警 Issue，避免遗留僵尸 Issue。"""
        wf = read(WORKFLOW)
        assert "if: success()" in wf
        assert re.search(r"state:\s*'closed'", wf), "成功后需关闭 keepalive 告警 Issue"

    def test_embedded_github_script_is_valid_javascript(self):
        """github-script 步骤里的 JS 无法被 lint 覆盖，这里做一次语法检查。"""
        import subprocess
        import tempfile

        wf = read(WORKFLOW)
        blocks = re.findall(r"\n          script: \|\n((?:            .*\n|\n)+)", wf)
        assert len(blocks) == 2, f"预期 2 个 github-script 步骤，实际 {len(blocks)}"

        for block in blocks:
            code = "\n".join(line[12:] for line in block.splitlines())
            with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as f:
                f.write(code)
                path = f.name
            result = subprocess.run(
                ["node", "--check", path], capture_output=True, text=True, timeout=30
            )
            assert result.returncode == 0, f"github-script 语法错误：{result.stderr}"

    def test_is_valid_yaml(self):
        yaml = __import__("pytest").importorskip("yaml")
        doc = yaml.safe_load(read(WORKFLOW))
        assert "ping" in doc["jobs"]


# ============================================================
# 本机 / 服务器定时通道
# ============================================================

class TestLocalKeepsAlive:
    def test_script_reads_config_from_single_source(self):
        """URL / key 从 js/supabase.js 解析，避免多处维护漂移。"""
        src = read(SCRIPT_MJS)
        assert "js" in src and "supabase.js" in src
        assert "SUPABASE_ANON_KEY" in src

    def test_script_supports_env_override(self):
        src = read(SCRIPT_MJS)
        assert "process.env.SUPABASE_URL" in src
        assert "process.env.SUPABASE_ANON_KEY" in src

    def test_script_hits_write_rpc(self):
        assert "/rest/v1/rpc/keepalive_ping" in read(SCRIPT_MJS)

    def test_script_exits_nonzero_on_failure(self):
        """cron 靠退出码告警。"""
        src = read(SCRIPT_MJS)
        assert "process.exit(1)" in src
        assert "process.exit(code)" in src

    def test_cron_wrapper_locates_node_and_logs(self):
        sh = read(CRON_SH)
        assert "command -v node" in sh
        assert ".keepalive.log" in sh
        assert "tail -n" in sh, "日志需要裁剪，避免无限增长"

    def test_launchd_plist_interval_is_6h(self):
        plist = read(PLIST)
        assert "<key>StartInterval</key>" in plist
        assert "<integer>21600</integer>" in plist
        assert "keepalive-cron.sh" in plist

    def test_npm_script_registered(self):
        pkg = json.loads(read(PKG))
        assert "keepalive" in pkg["scripts"]


# ============================================================
# 与前端配置保持一致
# ============================================================

class TestConfigConsistency:
    """workflow / 脚本 / 前端三处的 URL 与 anon key 必须一致。"""

    @staticmethod
    def _extract(supabase_js: str):
        url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", supabase_js)
        key = re.search(r"SUPABASE_ANON_KEY\s*=\s*\n?\s*'([^']+)'", supabase_js)
        assert url and key, "无法从 js/supabase.js 解析配置"
        return url.group(1), key.group(1)

    def test_workflow_matches_frontend_config(self):
        fe_url, fe_key = self._extract(read(ROOT / "js" / "supabase.js"))
        wf = read(WORKFLOW)
        assert fe_url in wf, "workflow 中的 SUPABASE_URL 与前端不一致"
        assert fe_key in wf, "workflow 中的 anon key 与前端不一致，可能已轮换未同步"
