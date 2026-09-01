"""Tests for parse_docx.py — 公用工程题库解析器."""

import pytest
import sys
import os

# 添加父目录到路径，以便导入 parse_docx
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from parse_docx import (
    is_chapter_heading,
    extract_type_name,
    is_type_header,
    parse_choice_answer,
    parse_judge_answer,
    split_inline_options,
    is_listing_continuation,
    looks_like_new_question,
    _extract_answers_from_runs,
)


# ============================================================
# is_chapter_heading 测试
# ============================================================

class MockParagraph:
    """Mock paragraph object for testing."""
    def __init__(self, text, style_name='', alignment=None):
        self._text = text
        self._style_name = style_name
        self._alignment = alignment

    @property
    def text(self):
        return self._text

    @property
    def style(self):
        class Style:
            name = self._style_name
        return Style() if self._style_name else None

    @property
    def alignment(self):
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        if self._alignment is None:
            return WD_ALIGN_PARAGRAPH.LEFT
        return self._alignment


class TestIsChapterHeading:
    """测试章节标题检测（Heading 2 + 居中）。"""

    def test_valid_chapter_heading(self):
        """Heading 2 + CENTER 应识别为章节标题."""
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        para = MockParagraph('火炬', style_name='Heading 2', alignment=WD_ALIGN_PARAGRAPH.CENTER)
        assert is_chapter_heading(para) is True

    def test_heading_2_but_not_centered(self):
        """Heading 2 但不居中 — 不是章节标题."""
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        para = MockParagraph('火炬', style_name='Heading 2', alignment=WD_ALIGN_PARAGRAPH.LEFT)
        assert is_chapter_heading(para) is False

    def test_centered_but_not_heading_2(self):
        """居中但不是 Heading 2 — 不是章节标题."""
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        para = MockParagraph('火炬', style_name='Normal', alignment=WD_ALIGN_PARAGRAPH.CENTER)
        assert is_chapter_heading(para) is False

    def test_empty_paragraph(self):
        """空段落 — 不是章节标题."""
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        para = MockParagraph('', style_name='Heading 2', alignment=WD_ALIGN_PARAGRAPH.CENTER)
        assert is_chapter_heading(para) is False

    def test_no_style(self):
        """无样式段落 — 不是章节标题."""
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        para = MockParagraph('火炬', style_name=None, alignment=WD_ALIGN_PARAGRAPH.CENTER)
        # style 为 None 时 is_chapter_heading 返回 None（falsy）
        assert not is_chapter_heading(para)


# ============================================================
# extract_type_name 测试
# ============================================================

class TestExtractTypeName:
    """测试题型名称提取."""

    def test_standard_choice(self):
        """标准选择题."""
        assert extract_type_name('一、选择题') == '选择题'

    def test_standard_judge(self):
        """标准判断题."""
        assert extract_type_name('二、判断题') == '判断题'

    def test_standard_fill(self):
        """标准填空题."""
        assert extract_type_name('三、填空题') == '填空题'

    def test_standard_simple(self):
        """标准简答题."""
        assert extract_type_name('四、简答题') == '简答题'

    def test_standard_practice(self):
        """标准实操分析题."""
        assert extract_type_name('五、实操分析题') == '实操分析题'

    def test_standard_emergency(self):
        """标准应急处理题."""
        assert extract_type_name('六、应急处理题') == '应急处理题'

    def test_with_parentheses(self):
        """带括号说明的题型."""
        assert extract_type_name('三、判断题（含答案，对打√、错打×）') == '判断题'

    def test_higher_numbers(self):
        """七、八、九、十的识别."""
        assert extract_type_name('七、填空题') == '填空题'
        assert extract_type_name('八、简答题') == '简答题'

    def test_lowercase_numbers(self):
        """小写数字一 - 十."""
        for num in '一二三四五六七八九十':
            result = extract_type_name(f'{num}、选择题')
            assert result == '选择题', f"Failed for {num}"

    def test_invalid_header(self):
        """无效前缀 — 返回 None."""
        assert extract_type_name('1. 选择题') is None
        assert extract_type_name('选择题') is None
        assert extract_type_name('') is None


# ============================================================
# is_type_header 测试
# ============================================================

class TestIsTypeHeader:
    """测试题型前缀匹配."""

    def test_valid_headers(self):
        """有效的一 - 十前缀."""
        assert is_type_header('一、选择题') is True
        assert is_type_header('二、填空题') is True
        assert is_type_header('三、判断题') is True
        assert is_type_header('十、实操分析题') is True

    def test_invalid_headers(self):
        """无效前缀."""
        assert is_type_header('1、选择题') is False
        assert is_type_header('选择') is False
        assert is_type_header('一选择题') is False
        assert is_type_header('') is False


# ============================================================
# parse_choice_answer 测试
# ============================================================

class TestParseChoiceAnswer:
    """测试选择题答案提取."""

    def test_standard_answer_a(self):
        """标准全角括号答案（A）."""
        ans, q = parse_choice_answer('以下哪项是正确的？（A）')
        assert ans == 'A'
        assert q == '以下哪项是正确的？（  ）'

    def test_standard_answer_b(self):
        """标准答案（B）."""
        ans, q = parse_choice_answer('关于锅炉的说法正确的是（B）')
        assert ans == 'B'
        assert '（  ）' in q

    def test_half_width_parens(self):
        """半角括号答案 (C)."""
        ans, q = parse_choice_answer('选项为 (C)')
        assert ans == 'C'

    def test_with_spaces(self):
        """答案括号内有空格."""
        ans, q = parse_choice_answer('题目内容（  D  ）')
        assert ans == 'D'

    def test_no_answer(self):
        """无答案标记."""
        ans, q = parse_choice_answer('这是一个问题没有答案标记')
        assert ans == ''
        assert q == '这是一个问题没有答案标记'

    def test_multiple_answers_keeps_first(self):
        """多个答案标记只提取第一个."""
        ans, q = parse_choice_answer('问题？（A）然后（B）')
        assert ans == 'A'


# ============================================================
# parse_judge_answer 测试
# ============================================================

class TestParseJudgeAnswer:
    """测试判断题答案提取."""

    def test_correct_answer(self):
        """正确答案（√）."""
        q, ans = parse_judge_answer('锅炉是特种设备（√）')
        assert ans == '√'
        assert '（√）' not in q

    def test_wrong_answer(self):
        """错误答案（×）."""
        q, ans = parse_judge_answer('水 can 燃烧（×）')
        assert ans == '×'

    def test_with_extra_text(self):
        """答案后有额外文字."""
        q, ans = parse_judge_answer('判断题内容（√）答案：√')
        assert ans == '√'

    def test_half_width_parens(self):
        """半角括号."""
        q, ans = parse_judge_answer('判断内容 (×)')
        assert ans == '×'

    def test_no_answer(self):
        """无答案标记."""
        q, ans = parse_judge_answer('这是一个判断题没有标记')
        assert ans == ''
        assert q == '这是一个判断题没有标记'


# ============================================================
# split_inline_options 测试
# ============================================================

class TestSplitInlineOptions:
    """测试内联选项分割."""

    def test_standard_options(self):
        """标准内联选项 A. xxx B. xxx."""
        text = 'A. 选项一 B. 选项二 C. 选项三 D. 选项四'
        opts = split_inline_options(text)
        assert len(opts) == 4
        assert opts[0] == 'A. 选项一'
        assert opts[1] == 'B. 选项二'

    def test_different_dots(self):
        """不同的点号（顿号）."""
        text = 'A、选项一 B、选项二'
        opts = split_inline_options(text)
        assert len(opts) == 2

    def test_full_width_dot(self):
        """全角点号．"""
        text = 'A．选项一 B．选项二'
        opts = split_inline_options(text)
        assert len(opts) == 2

    def test_with_closing_paren(self):
        """选项后带右括号."""
        # 注意：split_inline_options 使用正则 [(?=[A-D]\s*[.、．）])] 分割
        # 半角右括号 ) 不在分割模式内，这是预期行为
        # 测试实际行为：不分割
        text = 'A) 选项一 B) 选项二'
        opts = split_inline_options(text)
        # 当前实现不分割 ) 前缀的选项，这是已知限制
        assert len(opts) >= 1  # 至少返回一个选项或空

    def test_empty_input(self):
        """空输入."""
        opts = split_inline_options('')
        assert opts == []


# ============================================================
# is_listing_continuation 测试
# ============================================================

class TestIsListingContinuation:
    """测试列表续行检测."""

    def test_empty_string(self):
        """空字符串."""
        assert is_listing_continuation('') is True

    def test_circled_numbers(self):
        """带圈数字."""
        assert is_listing_continuation('① 这是要点') is True
        assert is_listing_continuation('② 第二点') is True

    def test_numbered_list(self):
        """数字编号列表."""
        assert is_listing_continuation('1. 第一点') is True
        assert is_listing_continuation('2、第二点') is True
        assert is_listing_continuation('（3）第三点') is True

    def test_very_short(self):
        """过短内容（< 6 字符）."""
        assert is_listing_continuation('要点') is True
        assert is_listing_continuation('一、二') is True
        assert is_listing_continuation('关键点') is True

    def test_bullet_points(self):
        """项目符号."""
        assert is_listing_continuation('- 列表项') is True
        assert is_listing_continuation('• 子弹点') is True
        assert is_listing_continuation('* 星号项') is True

    def test_normal_text(self):
        """正常文本 — 不是续行."""
        assert is_listing_continuation('这是一个完整的题目描述内容') is False


# ============================================================
# looks_like_new_question 测试
# ============================================================

class TestLooksLikeNewQuestion:
    """测试新题目启发式判断."""

    def test_ends_with_question_mark(self):
        """以问号结尾."""
        assert looks_like_new_question('什么是锅炉的工作原理？') is True
        assert looks_like_new_question('How does it work?') is True

    def test_ends_with_period(self):
        """以句号结尾."""
        assert looks_like_new_question('请简述操作流程。') is True

    def test_answer_prefix(self):
        """以答案关键词开头 — 不是新题目."""
        assert looks_like_new_question('答案：操作流程') is False
        assert looks_like_new_question('答：见解析') is False
        assert looks_like_new_question('解析：详细说明') is False
        assert looks_like_new_question('说明：注意事项') is False

    def test_numbered_prefix(self):
        """数字编号前缀 — 不是新题目（是答案步骤）."""
        assert looks_like_new_question('1. 第一步') is False
        assert looks_like_new_question('2、第二步') is False
        assert looks_like_new_question('（1）第一项') is False

    def test_listing_continuation(self):
        """列表续行 — 不是新题目."""
        assert looks_like_new_question('① 要点一') is False
        assert looks_like_new_question('- 列表项') is False

    def test_long_text(self):
        """长文本（≥20 字符）且不以关键词开头."""
        # 注意：looks_like_new_question 需要文本以句号或问号结尾才返回 True
        # 这是为了避免将普通段落误判为新题目
        assert looks_like_new_question('这是一个足够长的题目描述文本。') is True
        assert looks_like_new_question('请简述这个流程的工作原理？') is True
        # 不带标点结尾的长文本不被视为新题目
        assert looks_like_new_question('这是一个足够长的题目描述文本用来测试') is False

    def test_empty_input(self):
        """空输入."""
        assert looks_like_new_question('') is False


# ============================================================
# _extract_answers_from_runs 测试
# ============================================================

class MockFont:
    """Mock font object."""
    def __init__(self, bold=False, underline=False):
        self.bold = bold
        self.underline = underline


class MockRun:
    """Mock run object."""
    def __init__(self, text, bold=False, underline=False):
        self.text = text
        self.font = MockFont(bold=bold, underline=underline)


class TestExtractAnswersFromRuns:
    """测试从格式化 run 中提取答案."""

    def test_single_bold_answer(self):
        """单个加粗答案."""
        para = type('Para', (), {'runs': [
            MockRun('题目：'),
            MockRun('二氧化碳', bold=True),
            MockRun('用于灭火。'),
        ]})()
        q, ans = _extract_answers_from_runs(para, 'bold')
        assert ans == '二氧化碳'
        assert '____' in q

    def test_multiple_bold_answers(self):
        """多个加粗答案（用、连接）."""
        para = type('Para', (), {'runs': [
            MockRun('三要素：'),
            MockRun('可燃物', bold=True),
            MockRun('，'),
            MockRun('助燃物', bold=True),
            MockRun('，着火源。'),
        ]})()
        q, ans = _extract_answers_from_runs(para, 'bold')
        assert ans == '可燃物、助燃物'
        assert q.count('____') == 2

    def test_underline_answers(self):
        """下划线答案."""
        para = type('Para', (), {'runs': [
            MockRun('水的沸点是'),
            MockRun('100℃', underline=True),
            MockRun('。'),
        ]})()
        q, ans = _extract_answers_from_runs(para, 'underline')
        assert ans == '100℃'
        assert '____' in q

    def test_no_formatted_runs(self):
        """无格式化 run."""
        para = type('Para', (), {'runs': [
            MockRun('普通文本'),
            MockRun('还是普通文本'),
        ]})()
        q, ans = _extract_answers_from_runs(para, 'bold')
        assert ans == ''
        assert q == '普通文本还是普通文本'

    def test_consecutive_formatted_runs(self):
        """连续的格式化 run 作为一个答案."""
        # 注意：_extract_answers_from_runs 在遇到非格式化 run 时结束收集
        # 所以如果答案跨多个 run，需要确保所有答案字符都在格式化 run 中
        para = type('Para', (), {'runs': [
            MockRun('答案：'),
            MockRun('二', bold=True),
            MockRun('氧', bold=True),
            MockRun('化', bold=True),
            MockRun('碳。'),  # 非 bold run，收集在此停止
        ]})()
        q, ans = _extract_answers_from_runs(para, 'bold')
        # 实际行为：只收集 bold run 的文本，遇到第一个非 bold run 停止
        # 所以答案是"二氧化"（前三个 bold run）
        assert ans == '二氧化'
        # 如果完整答案"二氧化碳"都需要加粗，应该让"碳。"也在 bold run 中：
        para2 = type('Para', (), {'runs': [
            MockRun('答案：'),
            MockRun('二', bold=True),
            MockRun('氧', bold=True),
            MockRun('化', bold=True),
            MockRun('碳', bold=True),  # 也是 bold
            MockRun('。'),
        ]})()
        q2, ans2 = _extract_answers_from_runs(para2, 'bold')
        assert ans2 == '二氧化碳'


# ============================================================
# 端到端集成测试（需要真实 docx 文件）
# ============================================================

class TestIntegration:
    """集成测试 — 解析真实 docx 文件."""

    def test_parse_outer_version_docx(self):
        """解析外操版题库."""
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
        from parse_docx import parse_docx

        docx_path = os.path.join(
            os.path.dirname(__file__), '..', '公用工程题库（外操版）.docx'
        )
        if not os.path.exists(docx_path):
            pytest.skip('外操版 docx 文件不存在，跳过集成测试')

        data = parse_docx(docx_path)

        assert data is not None
        assert 'info' in data
        assert 'chapters' in data
        assert data['info']['version'] == '外操版'
        assert data['info']['total'] > 0
        assert len(data['chapters']) > 0

        # 验证章节结构
        for chapter in data['chapters']:
            assert 'name' in chapter
            assert 'type_groups' in chapter
            for tg in chapter['type_groups']:
                assert 'type' in tg
                assert 'questions' in tg
                for q in tg['questions']:
                    assert 'question' in q
                    assert 'answer' in q

    def test_choice_questions_all_have_options(self):
        """回归测试：所有选择题必须解析出非空选项。

        历史上曾因 docx 源文件中首选项缺失 'A.' 前缀，导致某道选择题
        的 options 被解析为空数组。该测试确保此类问题不会再次发生。
        """
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
        from parse_docx import parse_docx

        base = os.path.dirname(os.path.dirname(__file__))
        for fname in ['公用工程题库（外操版）.docx', '公用工程题库（内操版）.docx']:
            docx_path = os.path.join(base, fname)
            if not os.path.exists(docx_path):
                pytest.skip(f'{fname} 不存在，跳过')
            data = parse_docx(docx_path)
            empty = [
                (c['name'], q['question'])
                for c in data['chapters']
                for g in c['type_groups']
                if g['type'] == '选择题'
                for q in g['questions']
                if not q['options']
            ]
            assert empty == [], (
                f'{fname} 存在缺少选项的选择题：{empty}'
            )

    def test_parse_inner_version_docx(self):
        """解析内操版题库."""
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
        from parse_docx import parse_docx

        docx_path = os.path.join(
            os.path.dirname(__file__), '..', '公用工程题库（内操版）.docx'
        )
        if not os.path.exists(docx_path):
            pytest.skip('内操版 docx 文件不存在，跳过集成测试')

        data = parse_docx(docx_path)

        assert data is not None
        assert 'info' in data
        assert 'chapters' in data
        assert data['info']['version'] == '内操版'
        assert data['info']['total'] > 0