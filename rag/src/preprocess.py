"""Stage 1: one fast-model call per decision -> case card + per-criterion sections.

The decision text is sent with numbered lines. The model returns line ranges per
criterion section; code slices the verbatim text. A regex over criterion citations
is passed to the model as a hint and used afterwards to sanity-check each section.

Usage: python src/preprocess.py [--limit N] [--since YEAR] [--workers 16] [--ids A B ...]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import llm
from schemas import CRITERIA, REG_NUMBER, Card, CaseRecord, PreprocessLLM, Section

ROOT = Path(__file__).resolve().parent.parent
TEXT = ROOT / "data" / "text"
CACHE = ROOT / "data" / "preprocessed"
LOGS = ROOT / "data" / "logs"
CASES = ROOT / "data" / "cases.json"
CARDS = ROOT / "data" / "cards.json"

# Both 214.2(o)(3)(iii)(B)(N) and the older 214.2(o)(3)(B)(iii)(N). OCR often renders 1 as ] l I | !
CITE_RE = re.compile(
    r"214\.2\s*\(\s*o\s*\)\s*\(\s*3\s*\)\s*\(\s*(?:iii\s*\)\s*\(\s*B|B\s*\)\s*\(\s*iii)\s*\)\s*\(\s*([1-8\]lI|!])\s*\)"
)
OCR_ONE = {"]": "1", "l": "1", "I": "1", "|": "1", "!": "1"}

SYSTEM = f"""You preprocess published USCIS Administrative Appeals Office (AAO) decisions on O-1 petitions into structured data for a legal-research tool.

The decision text is given with numbered lines ("L12| ..."). Return:

- date: the decision date as YYYY-MM-DD.
- visa: "O-1A" (sciences, education, business, athletics), "O-1B" (arts, motion picture, television), "O-2", "O-3", or "unknown".
- outcome: "dismissed", "sustained", "remanded", or "other" (e.g. rejected, withdrawn).
- procedural_only: true when the decision contains no analysis of the evidence at all - untimely or improperly filed appeals, moot cases, summary dismissals, or decisions resting only on a missing advisory opinion/consultation. A decision that analyses even one evidentiary criterion is NOT procedural_only.
- card: a short anonymised profile of the beneficiary - field (specific, e.g. "machine learning for FPGA / EDA software"), role, employer_type, location (US state or country; "unknown" if not stated). Names are redacted; never guess them.
- criteria: every O-1A evidentiary criterion that was claimed at any stage, with its status. Use these keys for 8 C.F.R. 214.2(o)(3)(iii)(B)(1)-(8) (older decisions write 214.2(o)(3)(B)(iii)(N); treat them as identical):
  (1) awards, (2) membership, (3) published_material, (4) judging, (5) original_contributions, (6) scholarly_articles, (7) critical_role, (8) high_salary.
  Statuses:
  - met: the AAO found it met and discussed why.
  - met_not_reviewed: the Director found it met, it was not disputed, and the AAO gave no reasoning.
  - not_met: the AAO itself found it not met (including when it agrees with the Director and explains why).
  - not_reached: the AAO declined to decide it (e.g. because three criteria were already impossible).
  - waived: claimed earlier but not pursued on appeal.
  Omit criteria never claimed. For a sustained or remanded case, a criterion the AAO finds met belongs as "met".
- sections: for each criterion the AAO actually analyses (any status except met_not_reviewed/waived where there is no analysis), the inclusive line range [start_line, end_line] of that analysis. Start at the heading or the regulation wording that opens the section (e.g. "Evidence of the alien's original scientific, scholarly, or business-related contributions..."), end at the last line before the next criterion or the conclusion. Include footnote lines only if they sit inside the range. If two criteria are discussed together in one passage, give the same range for both. If the AAO discusses the same criterion in two places, give two sections.

For O-1B, O-2, O-3 or procedural-only decisions, still fill date/visa/outcome/procedural_only and a best-effort card; criteria and sections may be empty.

Precision matters more than recall: never invent a criterion that the text does not discuss."""


def numbered(text: str) -> tuple[list[str], str]:
    lines = text.splitlines()
    return lines, "\n".join(f"L{i}| {ln}" for i, ln in enumerate(lines, 1))


def citation_hints(lines: list[str]) -> dict[int, list[int]]:
    """criterion number -> line numbers where its citation appears."""
    hits: dict[int, list[int]] = {}
    for i, ln in enumerate(lines, 1):
        for m in CITE_RE.finditer(ln):
            n = int(OCR_ONE.get(m.group(1), m.group(1)))
            hits.setdefault(n, []).append(i)
    return hits


def process(case_id: str) -> tuple[CaseRecord | None, list[str]]:
    cached = CACHE / f"{case_id}.json"
    if cached.exists():
        return CaseRecord.model_validate_json(cached.read_text()), []

    text = (TEXT / f"{case_id}.txt").read_text()
    if len(text.strip()) < 200:
        return None, [f"{case_id}: skipped, extracted text is near-empty ({len(text.strip())} chars)"]
    lines, body = numbered(text)
    hints = citation_hints(lines)
    hint_txt = "\n".join(
        f"  ({n}) {CRITERIA[n - 1]}: lines {', '.join(map(str, ls[:12]))}" for n, ls in sorted(hints.items())
    ) or "  (none found - text may be OCR-damaged)"

    user = (
        f"Case ID: {case_id}\n\nRegex hint - lines where each criterion's regulation citation appears:\n{hint_txt}\n\n"
        f"<decision>\n{body}\n</decision>"
    )
    try:
        out = llm.parse(model=llm.FAST_MODEL, system=SYSTEM, user=user, schema=PreprocessLLM)
    except llm.CallFailed as e:
        return None, [f"{case_id}: call failed ({e})"]

    warnings: list[str] = []
    sections: list[Section] = []
    for s in out.sections:
        a, b = max(1, s.start_line), min(len(lines), s.end_line)
        if b < a:
            warnings.append(f"{case_id}: {s.criterion} empty range {s.start_line}-{s.end_line}")
            continue
        n = REG_NUMBER[s.criterion]
        # Sanity check: the criterion's citation should appear in (or just before) the section.
        if hints and not any(a - 3 <= ln <= b for ln in hints.get(n, [])):
            warnings.append(f"{case_id}: {s.criterion} lines {a}-{b} contain no ({n}) citation")
        sections.append(Section(criterion=s.criterion, status=s.status, text="\n".join(lines[a - 1 : b])))

    rec = CaseRecord(
        case_id=case_id,
        date=out.date,
        visa=out.visa,
        outcome=out.outcome,
        procedural_only=out.procedural_only,
        card=Card(**out.card.model_dump(), criteria={c.criterion: c.status for c in out.criteria}),
        sections=sections,
    )
    cached.write_text(rec.model_dump_json(indent=2))
    return rec, warnings


def year_of(case_id: str) -> int:
    m = re.match(r"[A-Za-z]{3}\d{2}(\d{4})_", case_id)
    return int(m.group(1)) if m else 0


# O-1B (arts / motion picture) regulation language. Used to catch O-1B decisions the model labelled O-1A.
O1B_RE = re.compile(
    r"214\.2\s*\(\s*o\s*\)\s*\(\s*3\s*\)\s*\(\s*(?:iv|v)\s*\)|extraordinary ability in the arts"
    r"|distinguished reputation as evidenced by critical reviews|lead, starring, or critical role in productions"
    r"|motion picture or television",
    re.I,
)
O1A_RE = re.compile(r"\(\s*iii\s*\)\s*\(\s*B\s*\)|\(\s*B\s*\)\s*\(\s*iii\s*\)")


def visa_check(rec: CaseRecord) -> CaseRecord:
    """Relabel O-1A -> O-1B when O-1B regulation markers outnumber O-1A criterion citations."""
    if rec.visa != "O-1A":
        return rec
    text = (TEXT / f"{rec.case_id}.txt").read_text()
    o1b, o1a = len(O1B_RE.findall(text)), len(O1A_RE.findall(text))
    if o1b >= 2 and o1b > o1a:
        print(f"  visa check: {rec.case_id} relabelled O-1B ({o1b} O-1B markers vs {o1a} O-1A citations)")
        rec = rec.model_copy(update={"visa": "O-1B"})
    return rec


def write_outputs() -> None:
    recs = [visa_check(CaseRecord.model_validate_json(p.read_text())) for p in sorted(CACHE.glob("*.json"))]
    CASES.write_text(json.dumps([r.model_dump() for r in recs], indent=1))
    keep = [r for r in recs if r.visa == "O-1A" and not r.procedural_only]
    CARDS.write_text(json.dumps([{"case_id": r.case_id, "card": r.card.model_dump()} for r in keep], indent=1))
    by_visa: dict[str, int] = {}
    for r in recs:
        by_visa[r.visa] = by_visa.get(r.visa, 0) + 1
    print(f"cases.json: {len(recs)} decisions {by_visa}; procedural_only={sum(r.procedural_only for r in recs)}")
    print(f"cards.json: {len(keep)} O-1A non-procedural cards")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--since", type=int, default=0)
    ap.add_argument("--workers", type=int, default=llm.WORKERS)
    ap.add_argument("--ids", nargs="*")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    ids = args.ids or sorted(
        (p.stem for p in TEXT.glob("*.txt") if year_of(p.stem) >= args.since),
        key=year_of,
        reverse=True,
    )
    if args.limit:
        ids = ids[: args.limit]

    warnings: list[str] = []
    failed: list[str] = []
    with ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(process, cid): cid for cid in ids}
        for i, f in enumerate(as_completed(futs), 1):
            cid = futs[f]
            try:
                rec, w = f.result()
                warnings += w
                if rec:
                    print(f"[{i}/{len(ids)}] {cid} {rec.visa} {rec.outcome} sections={len(rec.sections)}")
            except Exception as e:  # keep going; failures are listed at the end
                failed.append(f"{cid}: {type(e).__name__}: {e}")
                print(f"[{i}/{len(ids)}] {cid} FAILED {e}", file=sys.stderr)

    (LOGS / "preprocess_warnings.log").write_text("\n".join(warnings + failed))
    print(f"\n{len(warnings)} warnings, {len(failed)} failures (see data/logs/preprocess_warnings.log)")
    print("token usage:\n" + llm.usage.report())
    write_outputs()


if __name__ == "__main__":
    main()
