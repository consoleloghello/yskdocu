"""Fixtures and helpers for parse_docx tests."""

import pytest
from docx.enum.text import WD_ALIGN_PARAGRAPH


class MockParagraph:
    """Mock paragraph object for testing."""

    def __init__(self, text, style_name='Normal', alignment=WD_ALIGN_PARAGRAPH.LEFT):
        self._text = text
        self._style_name = style_name
        self._alignment = alignment

    @property
    def text(self):
        return self._text

    @property
    def style(self):
        if self._style_name is None:
            return None
        class Style:
            name = self._style_name
        return Style()

    @property
    def alignment(self):
        return self._alignment


class MockRun:
    """Mock run object for testing font formatting."""

    def __init__(self, text, bold=False, underline=False, italic=False):
        self.text = text
        self._bold = bold
        self._underline = underline
        self._italic = italic

    @property
    def font(self):
        return type('Font', (), {
            'bold': self._bold,
            'underline': self._underline,
            'italic': self._italic,
        })()


@pytest.fixture
def mock_paragraph():
    """Create a mock paragraph."""
    def _create(text, style_name='Normal', alignment=WD_ALIGN_PARAGRAPH.LEFT):
        return MockParagraph(text, style_name, alignment)
    return _create


@pytest.fixture
def mock_run():
    """Create a mock run."""
    def _create(text, bold=False, underline=False):
        return MockRun(text, bold, underline)
    return _create


@pytest.fixture
def sample_chapter_heading():
    """Sample chapter heading paragraph."""
    return MockParagraph('火炬', style_name='Heading 2', alignment=WD_ALIGN_PARAGRAPH.CENTER)


@pytest.fixture
def sample_choice_question():
    """Sample choice question text."""
    return '以下哪项是正确的？（A）'


@pytest.fixture
def sample_judge_question():
    """Sample judge question text."""
    return '锅炉是特种设备（√）'