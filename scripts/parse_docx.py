"""Parse 公用工程题库 docx files into structured JSON.

Chapters are identified by Heading 2 paragraphs (centered).
Question types are identified by 一/二/三/... numbered headers.
"""
import re, json, os
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH


def is_chapter_heading(para):
    """True if this paragraph is a chapter heading (Heading 2 + CENTER)."""
    if not para.text.strip():
        return False
    style_ok = para.style and 'Heading 2' in para.style.name
    align_ok = para.alignment == WD_ALIGN_PARAGRAPH.CENTER
    return style_ok and align_ok


def extract_type_name(text):
    """Extract question type name from a numbered header like '一、选择题' -> '选择题'."""
    clean = re.sub(r'[（(].*?[）)]', '', text).strip()
    m = re.match(r'^[一二三四五六七八九十]、(.+)', clean)
    if not m:
        return None
    name = m.group(1)
    if '选择' in name:
        return '选择题'
    if '填空' in name:
        return '填空题'
    if '判断' in name:
        return '判断题'
    if '简答' in name:
        return '简答题'
    if '实操' in name:
        return '实操分析题'
    if '应急' in name:
        return '应急处理题'
    return name


def is_type_header(text):
    """Check if text matches a numbered question-type header pattern."""
    return bool(re.match(r'^[一二三四五六七八九十]、', text))


def parse_choice_answer(text):
    """Extract answer letter from '...（A）' or '...（B）' pattern."""
    m = re.search(r'[（(]\s*([A-D])\s*[）)]', text)
    if m:
        ans = m.group(1)
        q = re.sub(r'\s*[（(]\s*[A-D]\s*[）)].*', '', text, count=1).strip()
        return ans, q
    return '', text


def split_inline_options(text):
    """Split 'A. xxx B. xxx C. xxx D. xxx' into option list."""
    parts = re.split(r'(?=[A-D]\s*[.、．）])', text)
    return [o.strip() for o in parts if o.strip() and len(o.strip()) > 1]


def collect_choice_options(texts, i):
    """Gather consecutive A/B/C/D-prefixed paragraphs as options.

    Returns (list_of_options, last_index_consumed).
    Handles both inline options (外操版) and per-line options (内操版).
    """
    opts = []
    while i + 1 < len(texts) and re.match(r'[A-D]\s*[.、．）]', texts[i + 1]):
        nxt = texts[i + 1]
        if re.search(r'[A-D]\s*[.、．）].*[A-D]\s*[.、．）]', nxt):
            opts.extend(split_inline_options(nxt))
        else:
            opts.append(nxt)
        i += 1
    return opts, i


def parse_judge_answer(text):
    """Extract √/× answer from '...（√）' or '...（×）' pattern."""
    m = re.search(r'[（(]\s*([√×])\s*[）)]', text)
    if m:
        ans = '√' if m.group(1) == '√' else '×'
        q = re.sub(
            r'\s*[（(]\s*[√×]\s*[）)]\s*(答案[：:]\s*[×√])?\s*$', '', text
        ).strip()
        q = re.sub(r'\s*[×√]$', '', q).strip()
        return q, ans
    return text, ''


def is_listing_continuation(text):
    """Is this text just a continuation marker (numbered item, bullet, very short)?"""
    if not text:
        return True
    if re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩]', text):
        return True
    if re.match(r'^[（(]?\s*[1-9]\d*\s*[）).、]', text):
        return True
    if len(text) < 6:
        return True
    if re.match(r'^[\-\•\*]', text):
        return True
    return False


def looks_like_new_question(text):
    """Heuristic: does this paragraph start a new open-ended question?"""
    if not text:
        return False
    if is_listing_continuation(text):
        return False
    if text.endswith('？') or text.endswith('?'):
        return True
    if re.match(r'^(答案|答|解析|说明|参考)', text):
        return False
    if re.match(r'^\d+[.、)）]', text):
        return False
    if len(text) >= 20 and not text.startswith(('答案', '答', '解析', '说明')):
        return True
    return False


def parse_docx(filepath):
    doc = Document(filepath)

    # Build structured paragraph list: (text, paragraph_object)
    paras = [(p.text.strip(), p) for p in doc.paragraphs if p.text.strip()]
    if not paras:
        return None

    # Handle multi-line first paragraph (rare edge case)
    text0, p0 = paras[0]
    if '\n' in text0:
        lines = [ln.strip() for ln in text0.split('\n') if ln.strip()]
        paras[0] = (lines[0], p0)
        for j, ln in enumerate(reversed(lines[1:]), 1):
            paras.insert(j, (ln, p0))

    # Detect version from first line
    version = '外操版' if '外操版' in paras[0][0] else '内操版'

    # Pre-extract text-only list for option collection
    texts = [t for t, _ in paras]

    chapters = []
    chapter = None
    cur_type = None
    questions = []
    in_answer = False

    start = 1 if '公用工程题库' in paras[0][0] else 0

    i = start
    while i < len(paras):
        text, p = paras[i]

        # --- Chapter boundary: Heading 2 + CENTER ---
        if is_chapter_heading(p):
            if chapter:
                if cur_type and questions:
                    chapter['type_groups'].append(
                        {'type': cur_type, 'questions': questions})
                chapters.append(chapter)
            chapter = {'name': text, 'type_groups': []}
            cur_type = None
            questions = []
            in_answer = False
            i += 1
            continue

        # Before first chapter — skip
        if chapter is None:
            i += 1
            continue

        # --- Question type header (一、选择题, 二、填空题, etc.) ---
        if is_type_header(text):
            if cur_type and questions:
                chapter['type_groups'].append(
                    {'type': cur_type, 'questions': questions})
            cur_type = extract_type_name(text)
            questions = []
            in_answer = False
            i += 1
            continue

        # Before first type header in this chapter — skip
        if cur_type is None:
            i += 1
            continue

        # --- Question body ---
        if cur_type == '选择题':
            if re.search(r'[（(]\s*[A-D]\s*[）)]', text):
                ans, q = parse_choice_answer(text)
                opts, i = collect_choice_options(texts, i)
                questions.append(
                    {'question': q or text, 'options': opts, 'answer': ans})
            elif i + 1 < len(paras) and re.match(
                    r'[A-D]\s*[.、．）]', texts[i + 1]):
                opts, i = collect_choice_options(texts, i)
                questions.append(
                    {'question': text, 'options': opts, 'answer': ''})

        elif cur_type == '判断题':
            q, ans = parse_judge_answer(text)
            if ans:
                questions.append({'question': q, 'answer': ans})

        elif cur_type == '填空题':
            questions.append({'question': text, 'answer': text})

        elif cur_type in ('简答题', '实操分析题', '应急处理题'):
            if text.startswith('答案') or text.startswith('答'):
                in_answer = True
                if questions:
                    sep = '\n' if questions[-1]['answer'] else ''
                    questions[-1]['answer'] += sep + text
            elif in_answer and questions and questions[-1]['answer']:
                if looks_like_new_question(text):
                    questions.append({'question': text, 'answer': ''})
                    in_answer = False
                else:
                    questions[-1]['answer'] += '\n' + text
            else:
                questions.append({'question': text, 'answer': ''})
                in_answer = False

        i += 1

    # Finalize last chapter
    if chapter:
        if cur_type and questions:
            chapter['type_groups'].append(
                {'type': cur_type, 'questions': questions})
        chapters.append(chapter)

    # Remove empty chapters
    chapters = [c for c in chapters
                if any(g['questions'] for g in c['type_groups'])]

    total = sum(len(g['questions'])
                for c in chapters for g in c['type_groups'])
    return {
        'info': {
            'title': f'公用工程题库（{version}）',
            'version': version,
            'total': total
        },
        'chapters': chapters
    }


if __name__ == '__main__':
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for fname in ['公用工程题库（外操版）.docx', '公用工程题库（内操版）.docx']:
        path = os.path.join(base, fname)
        if not os.path.exists(path):
            print(f'Skip: {fname} not found')
            continue
        data = parse_docx(path)
        version = data['info']['version']
        out = os.path.join(base, 'data', f'{version}.json')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'{version}: {data["info"]["total"]} -> data/{version}.json')
        for c in data['chapters']:
            cnt = sum(len(g['questions']) for g in c['type_groups'])
            print(f'  {c["name"]}: {cnt}')
            for g in c['type_groups']:
                print(f'    {g["type"]}: {len(g["questions"])}')
