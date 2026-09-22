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

    def test_no_readonly_ping_fallback(self):
        """旧的只读保活必须彻底删干净，不能以任何降级/兜底形式残留。

        只读 SELECT 已实测无法重置 Supabase 不活跃计时器，
        留着降级路径只会静默掩盖故障。
        """
        wf = read(WORKFLOW)
        # 允许出现在注释里的「踩坑说明」，但不得出现在可执行命令里
        commands = [
            ln.strip()
            for ln in wf.splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        joined = "\n".join(commands)
        assert "select=id" not in joined, "残留只读 SELECT 保活命令"
        assert "/rest/v1/profiles" not in joined, "残留旧的 profiles 只读 ping"
        assert "Fallback read" not in joined, "残留只读降级路径"
        assert joined.count("curl") == 1, f"保活只应有一次 curl 调用，实际 {joined.count('curl')} 次"

    def test_failure_is_fatal_and_diagnosed(self):
        """失败必须非零退出并按状态码给出定位提示。"""
        wf = read(WORKFLOW)
        assert "exit 1" in wf
        for code in ("404", "401|403", "5??"):
            assert code in wf, f"缺少 HTTP {code} 的定位提示"

    def test_normalizes_http_code(self):
        """curl 失败时 -w 会输出 000，避免拼接出 000000 之类的脏值。"""
        wf = read(WORKFLOW)
        assert 'HTTP_CODE="${HTTP_CODE: -3}"' in wf

    def test_retry_defaults_are_unchanged(self):
        """测试用的重试开关不能把生产默认值改弱。"""
        wf = read(WORKFLOW)
        assert "${KEEPALIVE_CURL_RETRY:-3}" in wf
        assert "${KEEPALIVE_CURL_RETRY_DELAY:-10}" in wf

    def test_checks_response_body_not_just_status(self):
        wf = read(WORKFLOW)
        # Supabase 的 jsonb 返回带空格：{"ok": true, ...}，判断必须容忍空白字符。
        # 历史 bug：写成 '"ok":true'（无空格），导致写入成功却报失败。
        assert "grep -qE" in wf, "需要校验返回体，避免 200 但实际未写入"
        assert "[[:space:]]*:[[:space:]]*true" in wf, "正则必须容忍 jsonb 的空格"
        assert '"ok":true' not in wf, "不允许无空格的严格匹配"

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
# workflow 内嵌 shell 的端到端回归测试
#
# 背景：曾经用「紧凑 JSON」（{"ok":true}）做 mock，而 Supabase 的 jsonb
# 实际返回是带空格的（{"ok": true}），于是 `grep '"ok":true'` 永远不匹配 ——
# RPC 明明写入成功（HTTP 200 / ping_count 递增），workflow 却报失败。
# 所以这里必须用“真实际格式”的响应体来跑真实 shell。
# ============================================================

class TestWorkflowShellAgainstRealisticResponses:
    @staticmethod
    def _serve(body: str, status: int = 200):
        """起一个本地 HTTP mock，返回指定状态码与响应体。"""
        import http.server
        import threading

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(length)
                payload = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *_args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, server.server_address[1]

    @staticmethod
    def _run_workflow_step(port: int, supabase_url: str | None = None):
        import subprocess
        import tempfile

        wf = read(WORKFLOW)
        script = wf.split("run: |\n", 1)[1].split("\n      - name:", 1)[0]
        script = "\n".join(
            line[10:] if line.startswith("          ") else line
            for line in script.splitlines()
        )

        with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as f:
            f.write(script)
            path = f.name

        env = {
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "SUPABASE_URL": supabase_url or f"http://127.0.0.1:{port}",
            "SUPABASE_ANON_KEY": "test-key",
            # 关掉重试，否则失败用例要等 30s+
            "KEEPALIVE_CURL_RETRY": "0",
            "KEEPALIVE_CURL_RETRY_DELAY": "0",
        }
        return subprocess.run(
            ["bash", path], capture_output=True, text=True, timeout=120, env=env
        )

    @staticmethod
    def _require_tools():
        import shutil

        pytest = __import__("pytest")
        if not shutil.which("bash") or not shutil.which("curl"):
            pytest.skip("需要 bash 与 curl")

    def test_succeeds_on_realistic_spaced_json(self):
        """Supabase 真实返回格式（jsonb 带空格）必须判成功。"""
        self._require_tools()
        body = '{"ok": true, "throttled": false, "last_ping": "2026-09-22T11:32:17.349952+00:00", "ping_count": 2}'
        server, port = self._serve(body)
        try:
            result = self._run_workflow_step(port)
        finally:
            server.shutdown()
        assert result.returncode == 0, f"应判成功，实际退码 {result.returncode}\n{result.stdout}"
        assert "✅ Keepalive write succeeded" in result.stdout

    def test_succeeds_when_throttled(self):
        """命中 60 秒节流也是 ok:true（说明刚刚已有写入），应判成功。"""
        self._require_tools()
        body = '{"ok": true, "throttled": true, "last_ping": "2026-09-22T11:32:17+00:00", "ping_count": 2}'
        server, port = self._serve(body)
        try:
            result = self._run_workflow_step(port)
        finally:
            server.shutdown()
        assert result.returncode == 0, result.stdout

    def test_fails_on_ok_false(self):
        """HTTP 200 但 ok:false 必须判失败（不能只看状态码）。"""
        self._require_tools()
        server, port = self._serve('{"ok": false}')
        try:
            result = self._run_workflow_step(port)
        finally:
            server.shutdown()
        assert result.returncode == 1, result.stdout

    def test_fails_on_404_with_pointer_to_sql(self):
        self._require_tools()
        server, port = self._serve('{"message":"Not found"}', status=404)
        try:
            result = self._run_workflow_step(port)
        finally:
            server.shutdown()
        assert result.returncode == 1
        assert "keepalive.sql" in result.stdout

    def test_fails_on_5xx_with_resume_hint(self):
        self._require_tools()
        server, port = self._serve("boom", status=503)
        try:
            result = self._run_workflow_step(port)
        finally:
            server.shutdown()
        assert result.returncode == 1
        assert "Resume" in result.stdout

    def test_fails_when_unreachable(self):
        """连接失败应归一化为 000，而不是 000000 这类脏值。"""
        self._require_tools()
        result = self._run_workflow_step(0, supabase_url="http://127.0.0.1:1")
        assert result.returncode == 1
        assert "HTTP status: 000" in result.stdout, result.stdout


# ============================================================
# pg_cron 诊断示例 SQL 的正确性
#
# 背景：文档里写了一句 `SELECT jobname, status, start_time FROM
# cron.job_run_details`，用户直接拿去执行，报
#   42703: column "jobname" does not exist
# 官方 README 给出的 cron.job_run_details 列清单是：
#   jobid, runid, job_pid, database, username, command, status,
#   return_message, start_time, end_time  —— 根本没有 jobname。
# 要显示任务名必须 JOIN cron.job。文档里的 SQL 也得当代码测。
# ============================================================

class TestPgCronDiagnosticSql:
    FILES = (
        ROOT / "scripts" / "keepalive.sql",
        ROOT / "scripts" / "init_supabase.sql",
        ROOT / "AGENTS.md",
    )

    @staticmethod
    def _blocks(text, needle, before=6, after=8):
        """取包含 needle 的行及其上下文，作为一条语句来看。"""
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if needle in line:
                yield "\n".join(lines[max(0, i - before) : i + after + 1])

    def test_files_exist(self):
        for path in self.FILES:
            assert path.exists(), path

    def test_no_bare_jobname_selected_from_job_run_details(self):
        """不能直接 SELECT jobname FROM cron.job_run_details（会报 42703）。"""
        bad = re.compile(r"\bjobname\b[^;\n]*\bFROM\s+cron\.job_run_details", re.I)
        for path in self.FILES:
            for block in self._blocks(path.read_text(encoding="utf-8"), "job_run_details"):
                assert not bad.search(block), (
                    f"{path.name}: cron.job_run_details 没有 jobname 列，必须 JOIN cron.job\n{block}"
                )

    def test_documented_history_query_joins_cron_job(self):
        """查执行历史的示例必须 JOIN cron.job 才拿得到任务名。"""
        text = read(ROOT / "scripts" / "keepalive.sql")
        blocks = [b for b in self._blocks(text, "job_run_details")]
        assert blocks, "keepalive.sql 应保留一条查看 pg_cron 执行历史的示例"
        assert any(re.search(r"JOIN\s+cron\.job\b", b, re.I) for b in blocks), (
            "查看执行历史的示例需要 JOIN cron.job"
        )

    def test_documents_the_pitfall_inline(self):
        """把坑写在示例旁边，避免后来者再改回裸 jobname。"""
        text = read(ROOT / "scripts" / "keepalive.sql")
        assert "没有 jobname" in text


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
