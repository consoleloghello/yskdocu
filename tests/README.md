# 测试文档

## 运行测试

```bash
# 运行所有测试
pytest tests/

# 运行测试并生成覆盖率报告
pytest tests/ --cov=scripts --cov-report=term-missing

# 运行特定测试文件
pytest tests/test_parse_docx.py -v

# 运行特定测试用例
pytest tests/test_parse_docx.py::TestExtractTypeName::test_standard_choice -v
```

## 测试覆盖

### 核心函数测试

`parse_docx.py` 的核心解析函数都有单元测试覆盖：

| 函数 | 测试类 | 测试用例数 |
|------|--------|-----------|
| `is_chapter_heading()` | `TestIsChapterHeading` | 5 |
| `extract_type_name()` | `TestExtractTypeName` | 10 |
| `is_type_header()` | `TestIsTypeHeader` | 2 |
| `parse_choice_answer()` | `TestParseChoiceAnswer` | 6 |
| `parse_judge_answer()` | `TestParseJudgeAnswer` | 5 |
| `split_inline_options()` | `TestSplitInlineOptions` | 4 |
| `is_listing_continuation()` | `TestIsListingContinuation` | 6 |
| `looks_like_new_question()` | `TestLooksLikeNewQuestion` | 7 |
| `_extract_answers_from_runs()` | `TestExtractAnswersFromRuns` | 5 |
| `parse_docx()` | `TestIntegration` | 2（集成测试） |

### 覆盖率

当前覆盖率：**83%**

未覆盖的代码主要是：
- 命令行输出逻辑（`if __name__ == '__main__'`）
- 边界情况处理（如罕见的 docx 格式）

### 集成测试

集成测试需要真实的 `.docx` 文件：
- `公用工程题库（外操版）.docx`
- `公用工程题库（内操版）.docx`

如果文件不存在，集成测试会自动跳过（`pytest.skip`）。

## 添加新测试

1. 在 `tests/` 目录下创建 `test_*.py` 文件
2. 使用 `MockParagraph` 和 `MockRun` 创建测试数据
3. 运行 `pytest` 验证

示例：

```python
from tests.conftest import MockParagraph, MockRun
from parse_docx import extract_type_name

def test_custom_type():
    result = extract_type_name('七、自定义题型')
    assert result == '自定义题型'
```

## 测试工具

- **pytest**: 测试框架
- **pytest-cov**: 覆盖率报告
- **python-docx**: docx 文件解析（测试中用到 `WD_ALIGN_PARAGRAPH`）