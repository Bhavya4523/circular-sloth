from __future__ import annotations

import re
from datetime import date as Date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ItemType = Literal["wear", "bring", "pay", "sign", "attend", "holiday", "deadline", "info"]


class ExtractedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    type: ItemType
    title: str = Field(min_length=1, max_length=240)
    details: str = Field(default="", max_length=1200)
    date: Date | None = None
    end_date: Date | None = None
    time: str | None = Field(default=None, max_length=40)
    amount: int | None = Field(default=None, ge=0)
    audience: str = Field(default="all", max_length=120)
    confidence: float = Field(ge=0, le=1)
    source_text: str = Field(max_length=2000)

    @model_validator(mode="after")
    def recover_explicit_amount_and_date(self):
        # Recover only literal, unambiguous values the model retained in its
        # source text but omitted from the structured fields.
        source = " ".join(part for part in (self.title, self.details, self.source_text) if part)
        if self.amount is None:
            match = re.search(r"(?:₹|\bRs\.?|\bINR\b)\s*([0-9][0-9,]*(?:\.\d{1,2})?)", source, re.I)
            if match:
                self.amount = int(float(match.group(1).replace(",", "")))
        if self.date is None:
            candidates = re.findall(
                r"\b(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b",
                source,
            )
            formats = ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%B %d, %Y", "%b %d %Y", "%b %d, %Y", "%Y-%m-%d")
            for candidate in candidates:
                for fmt in formats:
                    try:
                        self.date = datetime.strptime(candidate, fmt).date()
                        break
                    except ValueError:
                        continue
                if self.date is not None:
                    break
        return self


class ReadResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ExtractedItem]
    warnings: list[str]


class Chunk(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1)


class ReadRequest(BaseModel):
    today: Date
    language_hint: str | None = Field(default=None, max_length=40)
    chunks: list[Chunk] = Field(min_length=1, max_length=30)


class SummaryItem(BaseModel):
    type: str
    title: str
    date: Date | None = None
    amount: int | None = None


class SummaryRequest(BaseModel):
    language: str = Field(min_length=2, max_length=30)
    week_start: Date
    items: list[SummaryItem] = Field(max_length=200)


class SummaryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[str] = Field(min_length=3, max_length=3)


class ReplyRequest(BaseModel):
    language: Literal["english", "hindi", "marathi", "hinglish"]
    intent: str = Field(min_length=1, max_length=1000)
    child_label: str | None = Field(default=None, max_length=100)
    teacher_label: str | None = Field(default=None, max_length=100)


class ReplyResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=1200)

