"""Stage 3: per-criterion, per-evidence judge against failing AAO precedent + citation check."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import llm
from schemas import Applicant, CaseRecord, EvidenceItem, JudgeItem, JudgeResult

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / "data" / "logs"

CRITERION_NAMES = {
    "awards": "nationally or internationally recognised prizes or awards for excellence (B)(1)",
    "membership": "membership in associations requiring outstanding achievement, judged by recognised experts (B)(2)",
    "published_material": "published material about the beneficiary in professional, major trade or major media publications (B)(3)",
    "judging": "participation as a judge of the work of others in the field (B)(4)",
    "original_contributions": "original scientific, scholarly or business-related contributions of major significance (B)(5)",
    "scholarly_articles": "authorship of scholarly articles in professional journals or major media (B)(6)",
    "critical_role": "employment in a critical or essential capacity for organisations with a distinguished reputation (B)(7)",
    "high_salary": "high salary or other remuneration for services (B)(8)",
}

INSTRUCTIONS = """You are the "sceptic" in an O-1A case-preparation tool. You compare ONE piece of an applicant's evidence against real reasoning the USCIS Administrative Appeals Office (AAO) used to find this same criterion NOT met in past decisions. The question you answer is: is what this applicant did, as described, substantively the same kind of evidence the AAO rejected, for the same reason? You never decide that evidence is good or that a criterion is met, and nothing you write is legal advice.

Take the applicant's description as true and as something they can document. You are not checking proof; you are checking substance.

Bias: be lax. Wrongly flagging strong evidence loses a client; wrongly passing weak evidence costs a lawyer a few minutes. Flag only weaknesses that the precedent actually names and that genuinely fit this evidence.

Method:
1. Read the precedent sections. Each states one or more failure modes - the specific substantive reason the AAO gave for rejecting that kind of evidence (for example: the award went to a team, not the person; the article is about a product, not the person; the organisation is a student club; the salary sits mid-range in the petitioner's own comparison data; letters predict future impact rather than describing impact already achieved).
2. Keep only failure modes relevant to this evidence item: a similar piece of evidence offered for a similar argument. Most will not be relevant. Returning no items is allowed and common.
3. For each relevant failure mode, decide:
   - "applies": what the applicant did, as described, clearly has the same substantive weakness.
   - "does_not_apply": it clearly does not.
   - "unknown": it might, but the description leaves out a fact about what the applicant did that decides it. Give the single question about that fact (e.g. "Was the prize awarded to you personally or to the team?"). Never ask for a document, certificate, letter or proof.
4. Ignore these failure modes entirely - they are about proof or process, not about what the applicant did:
   - procedural failures (evidence filed after the petition date, first submitted on appeal, missing translations, untimely filing);
   - corroboration and verification failures (no supporting document, no certificate, claim not corroborated, unsigned or undated material, assertions without evidence, missing title/date/author on an article, missing circulation figures).
5. Evidence whose nature is itself the weakness is NOT a corroboration failure and should be judged: e.g. if the evidence item IS only counsel's own statement, or a self-published profile, or an employer's marketing page, that is what the evidence is.
6. Merge duplicates: if several cases state the same failure mode, report it once, citing the clearest case.

For every item give:
- failure_mode: one short sentence naming the weakness in general terms.
- reasoning: one or two sentences tying it to this applicant's evidence.
- case_id: the case the quote comes from.
- quote: an EXACT, contiguous excerpt (one to three sentences) copied character-for-character from that case's section below, including any typos or OCR noise. Do not paraphrase, join separate passages, or add ellipses. Quotes are machine-checked against the source and dropped if they do not match.
- question_for_applicant: required for "unknown", null otherwise. Ask about a fact of what the applicant did, in plain language, no legal jargon. Never ask for documents.

You may include "does_not_apply" items when it helps show your reasoning, but they are discarded."""


def normalise(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def quote_found(quote: str, sections: list[str]) -> bool:
    q = normalise(quote)
    if len(q) < 20:
        return False
    return any(q in normalise(t) for t in sections)


def precedent_block(criterion: str, cases: list[CaseRecord]) -> tuple[str, dict[str, list[str]]]:
    """All not_met sections for `criterion` in `cases`, labelled with case ID and card."""
    parts, by_case = [], {}
    for c in cases:
        secs = [s.text for s in c.sections if s.criterion == criterion and s.status == "not_met"]
        if not secs:
            continue
        by_case[c.case_id] = secs
        card = c.card
        header = (
            f'<case id="{c.case_id}" date="{c.date}" outcome="{c.outcome}">\n'
            f"Card: field={card.field}; role={card.role}; employer={card.employer_type}; location={card.location}\n"
        )
        body = "\n\n".join(f"<section>\n{t}\n</section>" for t in secs)
        parts.append(header + body + "\n</case>")
    return "\n\n".join(parts), by_case


def evidence_prompt(applicant: Applicant, ev: EvidenceItem) -> str:
    details = json.dumps(ev.details, ensure_ascii=False) if ev.details else "{}"
    return (
        "<applicant>\n"
        f"Field: {applicant.field}\nRole: {applicant.role}\nEmployer: {applicant.employer}\nLocation: {applicant.location}\n"
        "</applicant>\n\n<evidence>\n"
        f"id: {ev.id}\ncriterion: {ev.criterion}\nmedium: {ev.medium}\ndescription: {ev.description}\ndetails: {details}\n"
        "</evidence>\n\nJudge this evidence item against the precedent."
    )


def judge_criterion(
    applicant: Applicant, criterion: str, evidence: list[EvidenceItem], cases: list[CaseRecord], log: list[str]
) -> tuple[bool, dict[str, list[JudgeItem]]]:
    block, by_case = precedent_block(criterion, cases)
    if not by_case:
        return False, {}
    system = [
        {"type": "text", "text": INSTRUCTIONS},
        {
            "type": "text",
            "text": f"Criterion: {criterion} - {CRITERION_NAMES[criterion]}\n\n<precedent>\n{block}\n</precedent>",
            "cache_control": {"type": "ephemeral"},
        },
    ]

    def one(ev: EvidenceItem) -> tuple[str, list[JudgeItem]]:
        out = llm.parse(
            model=llm.STRONG_MODEL, system=system, user=evidence_prompt(applicant, ev), schema=JudgeResult
        )
        kept = []
        for it in out.items:
            if it.status == "does_not_apply":
                continue
            if it.case_id not in by_case:
                log.append(f"{ev.id} [{criterion}] dropped: case {it.case_id} not in precedent | {it.failure_mode}")
                continue
            if not quote_found(it.quote, by_case[it.case_id]):
                log.append(f"{ev.id} [{criterion}] dropped: quote not found in {it.case_id} | {it.quote[:160]!r}")
                continue
            if it.status == "unknown" and not it.question_for_applicant:
                log.append(f"{ev.id} [{criterion}] unknown item had no question; kept with generic question")
                it.question_for_applicant = f"Can you tell us more about what you did for: {ev.description}?"
            if it.status == "applies":
                it.question_for_applicant = None
            kept.append(it)
        return ev.id, kept

    results: dict[str, list[JudgeItem]] = {}
    # First call warms the prompt cache for this criterion's precedent; the rest run concurrently.
    first, rest = evidence[0], evidence[1:]
    k, v = one(first)
    results[k] = v
    if rest:
        with ThreadPoolExecutor(min(llm.WORKERS, len(rest))) as pool:
            for k, v in pool.map(one, rest):
                results[k] = v
    return True, results
