"""
Annotations router.

After saving, the record lock is automatically released.
Record status:
  - 1st annotator → annotated_partial
  - 2nd annotator → annotated
  - Judge decides  → judged
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct

from backend.app.core.database import get_db
from backend.app.core.security import get_current_user, require_role
from backend.app.models.models import User, Record, Annotation, RecordLock, Keyword
from backend.app.schemas.schemas import (
    SentimentAnnotationCreate, PillarAnnotationCreate, KeywordDecisionCreate,
    AnnotationResponse, FieldAnnotationCreate
)

router = APIRouter(tags=["annotations"])


async def _release_lock(db: AsyncSession, record_id: str, user_id: str):
    lock_r = await db.execute(select(RecordLock).where(RecordLock.record_id == record_id))
    lock   = lock_r.scalar_one_or_none()
    if lock and lock.user_id == user_id:
        await db.delete(lock)


async def _update_record_status(db: AsyncSession, record_id: str):
    r = await db.execute(
        select(func.count(distinct(Annotation.annotator_id))).where(
            Annotation.record_id == record_id,
            Annotation.annotation_type.in_(["sentiment", "pillar"]),
        )
    )
    n      = r.scalar() or 0
    rec_r  = await db.execute(select(Record).where(Record.id == record_id))
    record = rec_r.scalar_one_or_none()
    if not record:
        return
    record.status = "annotated" if n >= 2 else "annotated_partial" if n == 1 else record.status


@router.post("/{project_id}/annotations/sentiment", response_model=AnnotationResponse)
async def save_sentiment(
    project_id: str,
    body: SentimentAnnotationCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = Annotation(
        record_id=body.record_id, project_id=project_id, annotator_id=current_user.id,
        annotation_type="sentiment",
        original_sentiment=body.original_sentiment, corrected_sentiment=body.corrected_sentiment,
        is_correction=body.is_correction, correction_reason=body.correction_reason,
        original_topic=body.original_topic, corrected_topic=body.corrected_topic,
        topic_reason=body.topic_reason,
    )
    db.add(ann)
    await _release_lock(db, body.record_id, current_user.id)
    await _update_record_status(db, body.record_id)
    await db.commit()
    await db.refresh(ann)
    return AnnotationResponse(id=ann.id, record_id=ann.record_id, annotation_type=ann.annotation_type,
                               is_correction=ann.is_correction, created_at=ann.created_at, version=ann.version)


@router.post("/{project_id}/annotations/pillar", response_model=AnnotationResponse)
async def save_pillar(
    project_id: str,
    body: PillarAnnotationCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = Annotation(
        record_id=body.record_id, project_id=project_id, annotator_id=current_user.id,
        annotation_type="pillar", pillar=body.pillar,
        original_value=body.original_value, corrected_value=body.corrected_value,
        is_correction=body.is_correction, correction_reason=body.correction_reason,
    )
    db.add(ann)
    await _release_lock(db, body.record_id, current_user.id)
    await _update_record_status(db, body.record_id)
    await db.commit()
    await db.refresh(ann)
    return AnnotationResponse(id=ann.id, record_id=ann.record_id, annotation_type=ann.annotation_type,
                               is_correction=ann.is_correction, created_at=ann.created_at, version=ann.version)


@router.post("/{project_id}/keywords")
async def save_keyword(
    project_id: str,
    body: KeywordDecisionCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Guarda la decisión sobre una keyword.
    NOTA: Las keywords no son registros anotables, así que aquí NO se crea
    una Annotation (que requeriría un record_id FK válido). La tabla Keyword
    es la fuente de verdad para estas decisiones.
    """
    kw = Keyword(
        project_id=project_id, keyword=body.keyword, type=body.type or "llm_generated",
        accepted=body.accepted, reason=body.reason, languages=body.languages,
    )
    db.add(kw)
    await db.commit()
    await db.refresh(kw)
    return {
        "id": kw.id,
        "keyword": kw.keyword,
        "accepted": kw.accepted,
        "project_id": kw.project_id,
    }


@router.get("/{project_id}/keywords")
async def list_keywords(
    project_id: str,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Keyword).where(Keyword.project_id == project_id))
    return [
        {"id": k.id, "keyword": k.keyword, "type": k.type, "accepted": k.accepted,
         "reason": k.reason, "languages": k.languages, "reviewer_decision": k.reviewer_decision}
        for k in result.scalars().all()
    ]

@router.post("/{project_id}/annotations/field", response_model=AnnotationResponse)
async def save_field(
    project_id: str,
    body: FieldAnnotationCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = Annotation(
        record_id=body.record_id, project_id=project_id, annotator_id=current_user.id,
        annotation_type="field", field_name=body.field_name,
        original_text=body.original_text, corrected_text=body.corrected_text,
        is_correction=body.is_correction, correction_reason=body.correction_reason,
    )
    db.add(ann)
    await _release_lock(db, body.record_id, current_user.id)
    await _update_record_status(db, body.record_id)
    await db.commit()
    await db.refresh(ann)
    return AnnotationResponse(id=ann.id, record_id=ann.record_id, annotation_type=ann.annotation_type,
                               is_correction=ann.is_correction, created_at=ann.created_at, version=ann.version)


@router.patch("/{project_id}/keywords/{keyword_id}")
async def decide_keyword(
    project_id: str, keyword_id: str,
    body: KeywordDecisionCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.accepted is False and not (body.reason or "").strip():
        raise HTTPException(400, "Se requiere un motivo para rechazar una keyword")
    kw_r = await db.execute(select(Keyword).where(Keyword.id == keyword_id))
    kw = kw_r.scalar_one_or_none()
    if not kw:
        raise HTTPException(404, "Keyword not found")
    kw.accepted, kw.reason = body.accepted, body.reason
    await db.commit()
    return {"id": kw.id, "accepted": kw.accepted}

@router.patch("/{project_id}/keywords/{keyword_id}/judge")
async def judge_keyword(
    project_id: str, keyword_id: str,
    body: KeywordDecisionCreate,
    db: AsyncSession   = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    """Decisión final del juez sobre una keyword. Escribe en reviewer_decision."""
    from backend.app.core.security import require_role  # ya importado arriba
    kw_r = await db.execute(select(Keyword).where(Keyword.id == keyword_id))
    kw = kw_r.scalar_one_or_none()
    if not kw:
        raise HTTPException(404, "Keyword not found")
    kw.reviewer_decision = "accept" if body.accepted else "reject"
    kw.reason = body.reason or kw.reason
    await db.commit()
    return {"id": kw.id, "reviewer_decision": kw.reviewer_decision}