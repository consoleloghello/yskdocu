"""Parse 公用工程题库 docx files into structured JSON."""
import re, json, os
from docx import Document

KNOWN_CHAPTERS = ['火炬', '给水加压泵站', '罐区', '锅炉', '空压站',
                  '污水预处理', '循环水站', '制冷站', '制氮站', '新增题库']


def is_chapter_title(text):
    if len(text) > 10 or not text:
        return False
    return text.strip() in KNOWN_CHAPTERS


def extract_question_type(text):
    clean = re.sub(r'[（(].*?[）)]', '', text).strip()
    m = re.match(r'^[一二三四五]、(.+)', clean)
    if not m:
        return None
    name = m.group(1)
    if '选择' in name: return '选择题'
    if '填空' in name: return '填空题'
    if '判断' in name: return '判断题'
    if '简答' in name: return '简答题'
    if '实操' in name: return '实操分析题'
    if '应急' in name: return '应急处理题'
    return name


def is_question_type(text):
    return any(text.startswith(p) for p in ['一、', '二、', '三、', '四、', '五、'])


def parse_choice_answer(text):
    m = re.search(r'[（(]\s*([A-D])\s*[）)]', text)
    if m:
        return m.group(1), re.sub(r'\s*[（(]\s*[A-D]\s*[）)].*', '', text, count=1).strip()
    return '', text


def parse_options(inline_text):
    if re.search(r'A\s*[.、）]\s', inline_text) and re.search(r'B\s*[.、）]\s', inline_text):
        parts = re.split(r'(?=[A-D]\s*[.、）])', inline_text)
        return [o.strip() for o in parts if o.strip() and len(o.strip()) > 1]
    return [inline_text]


def parse_judge_answer(text):
    m = re.search(r'[（(]\s*([√×])\s*[）)]', text)
    if m:
        ans = '√' if m.group(1) == '√' else '×'
        q = re.sub(r'\s*[（(]\s*[√×]\s*[）)]\s*(答案[：:]\s*[×√])?\s*$', '', text).strip()
        q = re.sub(r'\s*[×√]$', '', q).strip()
        return q, ans
    return text, ''


def is_generic_continuation(text):
    if not text: return True
    if re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩]', text): return True
    if re.match(r'^[（(]?\s*[1-9]\s*[）)]', text): return True
    if len(text) < 8: return True
    if re.match(r'^[\-\•\*]', text): return True
    return False


def looks_like_new_question(text):
    if not text: return False
    if is_generic_continuation(text): return False
    if text.endswith('？') or text.endswith('?'): return True
    if len(text) >= 14 and not text.endswith('：'): return True
    return False


def parse_docx(filepath):
    doc = Document(filepath)
    raw = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    if not raw: return None

    if '\n' in raw[0]:
        parts = [p for p in raw[0].split('\n') if p.strip()]
        raw[0] = parts[0]
        for p in reversed(parts[1:]):
            raw.insert(1, p)

    version = '外操版' if '外操版' in raw[0] else '内操版'
    start = 1 if '公用工程题库' in raw[0] else 0

    chapters = []
    chapter = {'name': '火炬', 'type_groups': []}
    cur_type = None
    questions = []
    in_answer = False

    i = start
    while i < len(raw):
        text = raw[i]

        if '第二部分' in text:
            i += 1
            continue

        if is_chapter_title(text):
            if cur_type and questions:
                chapter['type_groups'].append({'type': cur_type, 'questions': questions})
            chapters.append(chapter)
            chapter = {'name': text, 'type_groups': []}
            cur_type = None; questions = []; in_answer = False
            i += 1
            continue

        if is_question_type(text):
            if cur_type and questions:
                chapter['type_groups'].append({'type': cur_type, 'questions': questions})
            cur_type = extract_question_type(text)
            questions = []; in_answer = False
            i += 1
            continue

        if cur_type is None:
            i += 1
            continue

        if cur_type == '选择题':
            if re.search(r'[（(]\s*[A-D]\s*[）)]', text):
                ans, q = parse_choice_answer(text)
                opts = []
                if i + 1 < len(raw):
                    nxt = raw[i + 1]
                    if re.match(r'[A-D]\s*[.、）]', nxt):
                        opts = parse_options(nxt)
                        i += 1
                questions.append({'question': q or text, 'options': opts, 'answer': ans})

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

    if cur_type and questions:
        chapter['type_groups'].append({'type': cur_type, 'questions': questions})
    chapters.append(chapter)
    chapters = [c for c in chapters if any(g['questions'] for g in c['type_groups'])]
    total = sum(len(g['questions']) for c in chapters for g in c['type_groups'])
    return {'info': {'title': f'公用工程题库（{version}）', 'version': version, 'total': total},
            'chapters': chapters}

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
