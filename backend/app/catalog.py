"""解析标签词表正文。标题里的数量只作声明，入库以实际条目为准。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
CATALOG_PATH = DATA_DIR / "catalog.txt"

_HEADER = re.compile(r"^#\s+(\w+)\s+(.+?)\s+(\d+)\s*$")
_SPLIT = re.compile(r"[,，]")


@dataclass
class CatalogEntry:
    name: str
    dimension_key: str
    dimension_label: str
    name_en: str = ""


@dataclass
class DimensionStat:
    key: str
    label: str
    declared: int
    parsed: int


@dataclass
class Catalog:
    entries: list[CatalogEntry]
    dimensions: list[DimensionStat]
    tags: list[dict] = field(default_factory=list)

    @property
    def parsed_total(self) -> int:
        return sum(item.parsed for item in self.dimensions)

    @property
    def declared_total(self) -> int:
        return sum(item.declared for item in self.dimensions)

    @property
    def cross_dimension_names(self) -> list[str]:
        counts: dict[str, int] = {}
        for entry in self.entries:
            counts[entry.name] = counts.get(entry.name, 0) + 1
        return [name for name, count in counts.items() if count > 1]


def _clean_token(token: str) -> str:
    return token.strip().strip("。.").strip()


def parse_catalog(text: str) -> Catalog:
    entries: list[CatalogEntry] = []
    dimensions: list[DimensionStat] = []
    current: tuple[str, str, int] | None = None
    parsed_in_section = 0

    def close_section() -> None:
        nonlocal parsed_in_section, current
        if current is None:
            return
        key, label, declared = current
        dimensions.append(DimensionStat(key, label, declared, parsed_in_section))
        current = None
        parsed_in_section = 0

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        header = _HEADER.match(line)
        if header:
            close_section()
            current = (header.group(1), header.group(2), int(header.group(3)))
            continue
        if current is None:
            raise ValueError(f"标签出现在维度标题之前：{line}")
        key, label, _declared = current
        for token in _SPLIT.split(line):
            name = _clean_token(token)
            if not name:
                continue
            name_en = ""
            if "|" in name:
                name, name_en = (part.strip() for part in name.split("|", 1))
            if not name:
                continue
            entries.append(CatalogEntry(name, key, label, name_en))
            parsed_in_section += 1
    close_section()

    grouped: dict[str, dict] = {}
    order: list[str] = []
    for entry in entries:
        bucket = grouped.get(entry.name)
        if bucket is None:
            bucket = {"name": entry.name, "name_en": entry.name_en, "dimensions": []}
            grouped[entry.name] = bucket
            order.append(entry.name)
        elif entry.name_en and not bucket["name_en"]:
            bucket["name_en"] = entry.name_en
        dim = {"key": entry.dimension_key, "label": entry.dimension_label}
        if dim not in bucket["dimensions"]:
            bucket["dimensions"].append(dim)

    catalog = Catalog(entries=entries, dimensions=dimensions, tags=[grouped[name] for name in order])
    return catalog


def catalog_from_library() -> Catalog:
    """确认后的中英标签库。默认词表以这里为准，不再读旧的 catalog.txt。"""
    from app.data.tag_library import iter_entries

    entries = [
        CatalogEntry(name, key, label, name_en)
        for key, label, _declared, name, name_en in iter_entries()
    ]
    dimensions: list[DimensionStat] = []
    seen: dict[str, DimensionStat] = {}
    for key, label, declared, _name, _name_en in iter_entries():
        stat = seen.get(key)
        if stat is None:
            stat = DimensionStat(key, label, declared, 0)
            seen[key] = stat
            dimensions.append(stat)
        stat.parsed += 1
    return _group(entries, dimensions)


def _group(entries: list[CatalogEntry], dimensions: list[DimensionStat]) -> Catalog:
    grouped: dict[str, dict] = {}
    order: list[str] = []
    for entry in entries:
        bucket = grouped.get(entry.name)
        if bucket is None:
            bucket = {"name": entry.name, "name_en": entry.name_en, "dimensions": []}
            grouped[entry.name] = bucket
            order.append(entry.name)
        elif entry.name_en and not bucket["name_en"]:
            bucket["name_en"] = entry.name_en
        dim = {"key": entry.dimension_key, "label": entry.dimension_label}
        if dim not in bucket["dimensions"]:
            bucket["dimensions"].append(dim)
    return Catalog(entries=entries, dimensions=dimensions, tags=[grouped[name] for name in order])


def load_catalog(path: Path | None = None) -> Catalog:
    if path is None:
        return catalog_from_library()
    text = path.read_text(encoding="utf-8")
    parsed = parse_catalog(text)
    return _group(parsed.entries, parsed.dimensions)
