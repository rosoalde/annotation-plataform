from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.core.security import require_role
from backend.app.models.models import User, Annotation
from backend.app.schemas.schemas import ReviewAnnotationOut, ReviewDecisionCreate

router = APIRouter(tags=["review"])


@router.get("/projects/{project_id}/review/pending", response_model=List[ReviewAnnotationOut])
async def pending_review(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "judge", "admin")),
):
    result = await db.execute(
        select(Annotation).options(selectinload(Annotation.annotator)).where(
            Annotation.project_id == project_id,
            Annotation.is_correction == True,
            Annotation.reviewer_decision == None,
            Annotation.annotation_type.in_(["sentiment", "pillar", "keyword","field"]),
        ).order_by(Annotation.created_at)
    )
    annotations = result.scalars().all()

    out = []
    for ann in annotations:
        annotator_name = ann.annotator.username if ann.annotator else "?"
        out.append(ReviewAnnotationOut(
            id=ann.id, record_id=ann.record_id, annotation_type=ann.annotation_type,
            annotator_name=annotator_name,
            field_name=ann.field_name, original_text=ann.original_text, corrected_text=ann.corrected_text,
            original_sentiment=ann.original_sentiment, corrected_sentiment=ann.corrected_sentiment,
            correction_reason=ann.correction_reason,
            original_topic=ann.original_topic, corrected_topic=ann.corrected_topic,
            original_value=ann.original_value, corrected_value=ann.corrected_value,
            pillar=ann.pillar, is_correction=ann.is_correction,
            reviewer_decision=ann.reviewer_decision, created_at=ann.created_at,
        ))
    return out


@router.post("/annotations/{annotation_id}/review")
async def decide_review(
    annotation_id: str,
    body: ReviewDecisionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "judge", "admin")),
):
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    ann    = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(404, "Annotation not found")
    if body.decision not in ("accept", "reject"):
        raise HTTPException(400, "decision must be 'accept' or 'reject'")

    ann.reviewer_decision = body.decision
    await db.commit()
    return {"ok": True, "decision": body.decision}