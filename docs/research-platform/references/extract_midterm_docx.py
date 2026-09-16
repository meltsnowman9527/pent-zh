#!/usr/bin/env python3
"""Extract a .docx document into a line-addressable Markdown reference file.

Every paragraph, table row and header/footer becomes exactly one text line, so
other documents can cite a requirement by line number against a pinned hash of
the extraction result.

Usage:
    python extract_midterm_docx.py <source.docx> <output.md>

Requires: python-docx (pip install python-docx)
The source document is opened read-only and is never modified. This script
contains no document content and no machine-specific paths.
"""

import sys
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


def iter_blocks(parent):
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, parent)
        elif child.tag.endswith("}tbl"):
            yield Table(child, parent)


def extract(source: Path) -> list[str]:
    doc = Document(str(source))
    lines: list[str] = []

    for block in iter_blocks(doc):
        if isinstance(block, Paragraph):
            text = block.text.strip()
            if not text:
                continue
            style = block.style.name if block.style else ""
            lines.append(f"[{style}] {text}")
        else:
            lines.append("\n[TABLE]")
            for row in block.rows:
                cells = [" ".join(cell.text.split()) for cell in row.cells]
                lines.append(" | ".join(cells))
            lines.append("[/TABLE]\n")

    for section_index, section in enumerate(doc.sections, start=1):
        for label, container in (("HEADER", section.header), ("FOOTER", section.footer)):
            text = " ".join(p.text.strip() for p in container.paragraphs if p.text.strip())
            if text:
                lines.append(f"[{label} {section_index}] {text}")

    return lines


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    source, output = Path(argv[1]), Path(argv[2])
    if not source.is_file():
        print(f"source document not found: {source}", file=sys.stderr)
        return 1

    lines = extract(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"lines={len(lines)} output={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
