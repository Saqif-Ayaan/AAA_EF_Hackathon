"""Stage 0b: PDF -> text. pdfplumber first; OCR (tesseract) for pages with almost no text."""

from __future__ import annotations

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pdfplumber
import pytesseract

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
TEXT = ROOT / "data" / "text"
MIN_CHARS = 80  # a page with less than this is treated as a scanned image


def extract(pdf: Path) -> tuple[str, int, int]:
    out = TEXT / f"{pdf.stem}.txt"
    if out.exists() and out.stat().st_size > 0:
        return pdf.stem, -1, -1
    pages, ocr_pages = [], 0
    with pdfplumber.open(pdf) as doc:
        for page in doc.pages:
            text = page.extract_text() or ""
            if len(text.strip()) < MIN_CHARS:
                img = page.to_image(resolution=300).original
                text = pytesseract.image_to_string(img)
                ocr_pages += 1
            pages.append(text)
    out.write_text("\n".join(pages))
    return pdf.stem, len(pages), ocr_pages


def main() -> None:
    TEXT.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(RAW.glob("*.pdf"))
    with ProcessPoolExecutor() as pool:
        for cid, n, ocr in pool.map(extract, pdfs):
            if n >= 0:
                print(f"{cid}: {n} pages" + (f", {ocr} OCR" if ocr else ""))
    print(f"done: {len(list(TEXT.glob('*.txt')))} text files", file=sys.stderr)


if __name__ == "__main__":
    main()
