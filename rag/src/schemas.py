"""Pydantic models shared by every stage of the sceptic pipeline."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Criterion = Literal[
    "awards",
    "membership",
    "published_material",
    "judging",
    "original_contributions",
    "scholarly_articles",
    "critical_role",
    "high_salary",
]
CRITERIA: tuple[str, ...] = Criterion.__args__  # type: ignore[attr-defined]
REG_NUMBER = {c: i for i, c in enumerate(CRITERIA, 1)}  # awards -> 1 ... high_salary -> 8

Status = Literal["met", "met_not_reviewed", "not_met", "not_reached", "waived"]
Outcome = Literal["dismissed", "sustained", "remanded", "other"]
Visa = Literal["O-1A", "O-1B", "O-2", "O-3", "unknown"]


# ---------------------------------------------------------------- Stage 1 (LLM output)

class CriterionStatus(BaseModel):
    criterion: Criterion
    status: Status


class SectionSpan(BaseModel):
    """A criterion section, given as an inclusive line range of the numbered decision text.

    The LLM returns line numbers rather than copying text, so the stored section is
    guaranteed verbatim (code slices it) and output tokens stay small.
    """

    criterion: Criterion
    status: Status
    start_line: int
    end_line: int


class CardFields(BaseModel):
    field: str
    role: str
    employer_type: str
    location: str


class PreprocessLLM(BaseModel):
    date: str = Field(description="Decision date, YYYY-MM-DD")
    visa: Visa
    outcome: Outcome
    procedural_only: bool
    card: CardFields
    criteria: list[CriterionStatus]
    sections: list[SectionSpan]


# ---------------------------------------------------------------- Stage 1 (stored)

class Card(CardFields):
    criteria: dict[str, Status]


class Section(BaseModel):
    criterion: Criterion
    status: Status
    text: str


class CaseRecord(BaseModel):
    case_id: str
    date: str
    visa: Visa
    outcome: Outcome
    procedural_only: bool
    card: Card
    sections: list[Section]


# ---------------------------------------------------------------- Applicant input

class EvidenceItem(BaseModel):
    id: str
    criterion: Criterion
    medium: str
    description: str
    details: dict = Field(default_factory=dict)


class Applicant(BaseModel):
    applicant_id: str
    name: str
    field: str
    role: str
    employer: str
    location: str
    evidence: list[EvidenceItem]


# ---------------------------------------------------------------- Stage 2

class RankedCase(BaseModel):
    case_id: str
    reason: str


class FilterResult(BaseModel):
    cases: list[RankedCase]


# ---------------------------------------------------------------- Stage 3

class JudgeItem(BaseModel):
    failure_mode: str
    status: Literal["applies", "does_not_apply", "unknown"]
    reasoning: str
    case_id: str
    quote: str = Field(description="Verbatim AAO text, at most a few sentences")
    question_for_applicant: Optional[str] = None


class JudgeResult(BaseModel):
    items: list[JudgeItem]


# ---------------------------------------------------------------- Output queue

class Precedent(BaseModel):
    case_id: str
    quote: str


class QueueItem(BaseModel):
    evidence_id: str
    evidence_summary: str
    failure_mode: str
    status: Literal["applies", "unknown"]
    reasoning: str
    precedent: Precedent
    question_for_applicant: Optional[str] = None


class CriterionQueue(BaseModel):
    precedent_found: bool
    items: list[QueueItem] = Field(default_factory=list)


class Question(BaseModel):
    criterion: Criterion
    evidence_id: str
    question: str


class Summary(BaseModel):
    criteria_status: dict[str, Literal["flagged", "open", "clear"]]
    criteria_counted: int
    routing: Literal["to_lawyer", "needs_more_evidence"]
    questions_for_call: list[Question]


class Queue(BaseModel):
    applicant_id: str
    criteria: dict[str, CriterionQueue]
    summary: Summary
