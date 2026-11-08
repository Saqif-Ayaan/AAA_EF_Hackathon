"""Applicant JSON in, queue out.

Usage: python src/run.py input/applicant_test_01.json [--expect-case FEB142024_01D8101]
"""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import filter as case_filter
import judge
import llm
from schemas import (
    CRITERIA,
    Applicant,
    CaseRecord,
    CriterionQueue,
    Precedent,
    Queue,
    QueueItem,
    Question,
    Summary,
)

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "data" / "cases.json"
OUT = ROOT / "out"
LOGS = ROOT / "data" / "logs"


def load_cases() -> dict[str, CaseRecord]:
    return {r["case_id"]: CaseRecord.model_validate(r) for r in json.loads(CASES.read_text())}


def summarise(applicant: Applicant, criteria: dict[str, CriterionQueue]) -> Summary:
    """A criterion survives if at least one evidence item has no `applies` failure.

    flagged: no surviving evidence item.  clear: some surviving item has no open questions.
    open: every surviving item still has `unknown` questions.
    """
    status: dict[str, str] = {}
    for crit, q in criteria.items():
        ev_ids = [e.id for e in applicant.evidence if e.criterion == crit]
        applies = {i.evidence_id for i in q.items if i.status == "applies"}
        unknown = {i.evidence_id for i in q.items if i.status == "unknown"}
        surviving = [e for e in ev_ids if e not in applies]
        if not surviving:
            status[crit] = "flagged"
        elif any(e not in unknown for e in surviving):
            status[crit] = "clear"
        else:
            status[crit] = "open"
    counted = sum(s in ("clear", "open") for s in status.values())

    questions, seen = [], set()
    for crit in CRITERIA:
        for it in criteria.get(crit, CriterionQueue(precedent_found=False)).items:
            if it.status == "unknown" and it.question_for_applicant:
                key = re.sub(r"\W+", " ", it.question_for_applicant.lower()).strip()
                if key not in seen:
                    seen.add(key)
                    questions.append(Question(criterion=crit, evidence_id=it.evidence_id, question=it.question_for_applicant))
    return Summary(
        criteria_status=status,
        criteria_counted=counted,
        routing="to_lawyer" if counted >= 3 else "needs_more_evidence",
        questions_for_call=questions,
    )


def run(path: Path, expect_case: str | None = None) -> Queue:
    applicant = Applicant.model_validate_json(path.read_text())
    cases = load_cases()

    print(f"[{applicant.applicant_id}] Stage 2: ranking {len(json.loads(case_filter.CARDS.read_text()))} cards")
    ranked = case_filter.select(applicant)
    top = [cases[r.case_id] for r in ranked]
    if expect_case:
        pos = next((i for i, r in enumerate(ranked, 1) if r.case_id == expect_case), None)
        print(f"  expected case {expect_case}: {'rank ' + str(pos) if pos else 'NOT in top ' + str(len(ranked))}")

    claimed = [c for c in CRITERIA if any(e.criterion == c for e in applicant.evidence)]
    print(f"Stage 3: judging {len(applicant.evidence)} evidence items across {claimed}")
    log: list[str] = []

    def do(crit: str):
        ev = [e for e in applicant.evidence if e.criterion == crit]
        return crit, ev, judge.judge_criterion(applicant, crit, ev, top, log)

    criteria: dict[str, CriterionQueue] = {}
    with ThreadPoolExecutor(len(claimed) or 1) as pool:
        for crit, ev, (found, results) in pool.map(do, claimed):
            by_id = {e.id: e for e in ev}
            items = [
                QueueItem(
                    evidence_id=eid,
                    evidence_summary=by_id[eid].description,
                    failure_mode=it.failure_mode,
                    status=it.status,  # type: ignore[arg-type]
                    reasoning=it.reasoning,
                    precedent=Precedent(case_id=it.case_id, quote=it.quote),
                    question_for_applicant=it.question_for_applicant,
                )
                for eid in (e.id for e in ev)
                for it in results.get(eid, [])
            ]
            criteria[crit] = CriterionQueue(precedent_found=found, items=items)
            print(f"  {crit}: precedent={'yes' if found else 'none'}, items={len(items)}")

    queue = Queue(applicant_id=applicant.applicant_id, criteria=criteria, summary=summarise(applicant, criteria))
    OUT.mkdir(exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    out = OUT / f"queue_{applicant.applicant_id}.json"
    payload = queue.model_dump()
    payload["selected_cases"] = [r.model_dump() for r in ranked]
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    (LOGS / f"citation_check_{applicant.applicant_id}.log").write_text("\n".join(log))
    print(f"  citation check dropped {len(log)} items (data/logs/citation_check_{applicant.applicant_id}.log)")
    print(f"  summary: {queue.summary.criteria_status} -> {queue.summary.routing}")
    print(f"  wrote {out.relative_to(ROOT)}")
    print("token usage:\n" + llm.usage.report())
    return queue


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("applicant", type=Path)
    ap.add_argument("--expect-case")
    a = ap.parse_args()
    run(a.applicant, a.expect_case)
