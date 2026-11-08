"""Stage 2: rank case cards by criteria overlap with the applicant; keep top K.

Deterministic (no model call). Field, role and employer are deliberately ignored: the
corpus is dominated by athletes and most failure modes do not depend on field.

Sort key, highest first:
  1. shared_claimed  - criteria both the applicant and the case claimed
  2. shared_not_met  - of those, how many the AAO found not_met (only these give the judge reasoning)
  3. decision date   - more recent first
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from schemas import Applicant, RankedCase

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "data" / "cards.json"
CASES = ROOT / "data" / "cases.json"
TOP_K = 40
# Pre-2015 decisions often apply criterion-stage tests USCIS has since dropped (e.g. citation counts
# for scholarly articles). Only decisions issued in or after this year are used.
MIN_YEAR = int(os.environ.get("RAG_MIN_YEAR", "2015"))


def year_of(case_id: str) -> int:
    m = re.match(r"[A-Za-z]{3}\d{2}(\d{4})_", case_id)
    return int(m.group(1)) if m else 0


def load_cards() -> list[dict]:
    return json.loads(CARDS.read_text())


def select(applicant: Applicant, k: int = TOP_K) -> list[RankedCase]:
    claimed = {e.criterion for e in applicant.evidence}
    dates = {r["case_id"]: r["date"] for r in json.loads(CASES.read_text())}

    scored = []
    for c in load_cards():
        if year_of(c["case_id"]) < MIN_YEAR:
            continue
        crit = c["card"]["criteria"]
        shared = claimed & set(crit)
        failed = sorted(x for x in shared if crit[x] == "not_met")
        if not failed:
            continue  # nothing this case could teach the judge about this applicant
        scored.append((len(shared), len(failed), dates.get(c["case_id"], ""), c["case_id"], failed, sorted(shared)))

    scored.sort(key=lambda s: (s[0], s[1], s[2]), reverse=True)
    return [
        RankedCase(
            case_id=cid,
            reason=f"shares {n_shared}/{len(claimed)} claimed criteria ({', '.join(shared)}); not met: {', '.join(failed)}",
        )
        for n_shared, _, _, cid, failed, shared in scored[:k]
    ]
