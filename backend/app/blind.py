"""景点名称脱敏，文案里去掉全名。

中文仍只露出两个字。英文按空格切词，保留每个词的首字母，再稳定地露出 1 到 2 个辅音，
其余字符换成 *。同一个名字多次运行得到同一个遮罩。
"""

import random
import re

from app.constants import BLIND_VISIBLE_CHARS

_MASK = "*"


def visible_chars(masked: str) -> str:
    return "".join(ch for ch in masked if ch != _MASK and not ch.isspace())


def is_english_name(full_name: str) -> bool:
    """字母里超过六成是英文字母时，按英文拼字规则遮罩。"""
    letters = [ch for ch in full_name if ch.isalpha()]
    if not letters:
        return False
    latin = sum(1 for ch in letters if ch.isascii())
    return latin / len(letters) >= 0.6


def assert_blind_name(full_name: str, blind_name: str) -> None:
    if len(blind_name) != len(full_name):
        raise ValueError(f"{full_name} 的 blind_name 长度应与全名一致")
    if is_english_name(full_name):
        _assert_english_mask(full_name, blind_name)
        return
    shown = visible_chars(blind_name)
    compact = [ch for ch in full_name if not ch.isspace()]
    if len(compact) > BLIND_VISIBLE_CHARS and len(shown) != BLIND_VISIBLE_CHARS:
        raise ValueError(f"{full_name} 的 blind_name 应只露出 {BLIND_VISIBLE_CHARS} 个字，实际是「{shown}」")
    for source, shown_ch in zip(full_name, blind_name):
        if source.isspace():
            if shown_ch != source:
                raise ValueError(f"{full_name} 的盲盒名应保留空格")
            continue
        if shown_ch not in {_MASK, source}:
            raise ValueError(f"{full_name} 的隐藏名含有原名中不存在的字「{shown_ch}」")


def _assert_english_mask(full_name: str, blind_name: str) -> None:
    """与按空格切词的确定性遮罩一致：首字母保留，其余只露出 1 到 2 个辅音。"""
    source_words = full_name.split(" ")
    masked_words = blind_name.split(" ")
    if source_words != [] and len(source_words) != len(masked_words):
        raise ValueError(f"{full_name} 的盲盒名应按空格保留词数")
    consonants = set("bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ")
    for source_word, masked_word in zip(source_words, masked_words):
        if len(source_word) <= 1:
            if masked_word != source_word:
                raise ValueError(f"{full_name} 的单字符单词应原样保留")
            continue
        if len(masked_word) != len(source_word) or masked_word[0] != source_word[0]:
            raise ValueError(f"{full_name} 的英文盲盒名应保留每个单词的首字母")
        rest = source_word[1:]
        shown = masked_word[1:]
        consonant_indexes = [index for index, ch in enumerate(rest) if ch in consonants]
        kept: list[int] = []
        for index, (source_ch, shown_ch) in enumerate(zip(rest, shown)):
            if shown_ch == _MASK:
                continue
            if shown_ch != source_ch or source_ch not in consonants:
                raise ValueError(f"{full_name} 的英文盲盒名只额外露出辅音")
            kept.append(index)
        available = len(consonant_indexes)
        if available >= 2 and len(kept) not in (1, 2):
            raise ValueError(f"{full_name} 的英文盲盒名应再露出 1 到 2 个辅音")
        if available < 2 and len(kept) != available:
            raise ValueError(f"{full_name} 的英文盲盒名应露出 {available} 个额外辅音")


def mask_name(full_name: str, rng: random.Random | None = None) -> str:
    """给入库生成盲盒名。英文结果只由全名决定，多次运行完全相同。"""
    if is_english_name(full_name):
        return _deterministic_english_mask(full_name)
    return _mask_short(full_name, rng or random.Random(full_name))


def _deterministic_english_mask(full_name: str) -> str:
    rng = random.Random(full_name)
    words = full_name.split(" ")
    blind_words = []
    consonants = set("bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ")
    for word in words:
        if len(word) <= 1:
            blind_words.append(word)
            continue
        rest = word[1:]
        consonants_indices = [index for index, ch in enumerate(rest) if ch in consonants]
        if len(consonants_indices) >= 2:
            keep_count = rng.choice([1, 2])
        else:
            keep_count = len(consonants_indices)
        keep_indices = set(rng.sample(consonants_indices, keep_count)) if consonants_indices else set()
        masked_rest = "".join(ch if index in keep_indices else "*" for index, ch in enumerate(rest))
        blind_words.append(word[0] + masked_rest)
    return " ".join(blind_words)


def _mask_short(full_name: str, rng: random.Random) -> str:
    chars = list(full_name)
    indexes = [index for index, ch in enumerate(chars) if not ch.isspace()]
    if len(indexes) <= BLIND_VISIBLE_CHARS:
        return full_name
    keep = set(rng.sample(indexes, BLIND_VISIBLE_CHARS))
    return "".join(ch if ch.isspace() or index in keep else _MASK for index, ch in enumerate(chars))


def redact_full_name(text: str | None, full_name: str) -> str | None:
    """介绍可以保留省、市，但不能出现景点全名。"""
    if text is None or not full_name:
        return text
    if full_name not in text:
        return text
    return text.replace(full_name, "该目的地")


def redact_fields(payload: dict, full_name: str, fields: tuple[str, ...]) -> dict:
    for key in fields:
        if key in payload:
            payload[key] = redact_full_name(payload[key], full_name)
    return payload


def contains_full_name(text: str | None, full_name: str) -> bool:
    if not text or not full_name:
        return False
    return full_name in text


_ALIAS_RE = re.compile(r"^(.+?)\((.+)\)$")


def match_forms(name: str) -> list[str]:
    """标签原名，以及括号前后的别称。例如 halal(清真) 也可被「清真」命中。"""
    forms = [name]
    matched = _ALIAS_RE.match(name)
    if matched:
        forms.append(matched.group(1).strip())
        forms.append(matched.group(2).strip())
    seen: list[str] = []
    for form in forms:
        if form and form not in seen:
            seen.append(form)
    return seen
