"""
Records router.

  - GET /records computes `pending` server-side (never negative).
  - POST /records/{id}/lock acquires a pessimistic lock (30 min TTL).
    Returns 409 if another ACTIVE user holds the lock.
  - DELETE /records/{id}/lock releases the lock.
  - POST /records/import bulk-loads rows (now including lang + world_* columns
    produced by the LLM re-analysis pass).
"""
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct

from backend.app.core.database import get_db
from backend.app.core.security import get_current_user, require_role
from backend.app.models.models import User, Record, RecordLock, Annotation, Project
from backend.app.schemas.schemas import RecordOut, RecordListResponse, RecordImportItem

router   = APIRouter(tags=["records"])
LOCK_TTL = timedelta(minutes=30)


async def _clean_expired_locks(db: AsyncSession):
    now    = datetime.utcnow()
    result = await db.execute(select(RecordLock).where(RecordLock.expires_at < now))
    for lock in result.scalars().all():
        await db.delete(lock)
    await db.commit()


@router.get("/{project_id}/records", response_model=RecordListResponse)
async def list_records(
    project_id: str,
    platform: Optional[str]        = None,
    annotation_type: Optional[str] = None,
    limit: int                     = 20,
    offset: int                    = 0,
    db: AsyncSession                = Depends(get_db),
    current_user: User              = Depends(get_current_user),
):
    await _clean_expired_locks(db)

    q = select(Record).where(Record.project_id == project_id)
    if platform:
        q = q.where(Record.platform == platform)

    total_r = await db.execute(select(func.count()).select_from(q.subquery()))
    total   = total_r.scalar() or 0

    ann_q = select(distinct(Annotation.record_id)).where(
        Annotation.project_id   == project_id,
        Annotation.annotator_id == current_user.id,
    )
    if annotation_type:
        ann_q = ann_q.where(Annotation.annotation_type == annotation_type)

    done_r   = await db.execute(ann_q)
    done_ids = {row[0] for row in done_r.all()}
    done     = len(done_ids)
    pending  = max(0, total - done)   # ← never negative

    page_q  = q.order_by(Record.created_at).offset(offset).limit(limit)
    result  = await db.execute(page_q)
    records = result.scalars().all()

    out = []
    now = datetime.utcnow()
    for rec in records:
        lock_r = await db.execute(select(RecordLock).where(RecordLock.record_id == rec.id))
        lock   = lock_r.scalar_one_or_none()

        locked_by_other = False
        locked_until    = None
        if lock and lock.expires_at > now:
            locked_by_other = lock.user_id != current_user.id
            locked_until    = lock.expires_at

        out.append(RecordOut(
            id=rec.id, external_id=rec.external_id, content=rec.content,
            platform=rec.platform, tipo=rec.tipo, fecha=rec.fecha,
            fuente=rec.fuente, titulo_padre=rec.titulo_padre,
            cuerpo_padre=rec.cuerpo_padre, descripcion_padre=rec.descripcion_padre,
            tweet_anterior=rec.tweet_anterior, idioma_ia=rec.idioma_ia,
            lang=rec.lang, world_continent=rec.world_continent,
            world_country=rec.world_country, world_region=rec.world_region,
            world_city=rec.world_city,
            sentiment_llm=rec.sentiment_llm, topic_llm=rec.topic_llm,
            legitimacion=rec.legitimacion, efectividad=rec.efectividad,
            justicia_equidad=rec.justicia_equidad,
            confianza_institucional=rec.confianza_institucional,
            status=rec.status, locked_by_other=locked_by_other, locked_until=locked_until,
        ))

    return RecordListResponse(records=out, total=total, pending=pending, done=done, offset=offset, limit=limit)


@router.post("/{project_id}/records/{record_id}/lock")
async def acquire_lock(
    project_id: str,
    record_id:  str,
    db:         AsyncSession = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    await _clean_expired_locks(db)

    lock_r = await db.execute(select(RecordLock).where(RecordLock.record_id == record_id))
    lock   = lock_r.scalar_one_or_none()
    now    = datetime.utcnow()

    if lock and lock.expires_at > now and lock.user_id != current_user.id:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Este registro está bloqueado por otro usuario hasta {lock.expires_at.strftime('%H:%M')}",
                "locked_until": lock.expires_at.isoformat(),
            }
        )

    expires_at = now + LOCK_TTL
    if lock:
        lock.user_id, lock.locked_at, lock.expires_at = current_user.id, now, expires_at
    else:
        db.add(RecordLock(record_id=record_id, user_id=current_user.id, expires_at=expires_at))

    await db.commit()
    return {"locked": True, "expires_at": expires_at.isoformat()}


@router.delete("/{project_id}/records/{record_id}/lock")
async def release_lock(
    project_id: str,
    record_id:  str,
    db:         AsyncSession = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    lock_r = await db.execute(select(RecordLock).where(RecordLock.record_id == record_id))
    lock   = lock_r.scalar_one_or_none()
    if lock and lock.user_id == current_user.id:
        await db.delete(lock)
        await db.commit()
    return {"released": True}


@router.post("/{project_id}/records/import")
async def import_records(
    project_id: str,
    items:      List[RecordImportItem],
    db:         AsyncSession = Depends(get_db),
    current_user: User       = Depends(require_role("admin", "reviewer")),
):
    """Bulk-import records, including lang + world_* columns from the LLM CSV export."""
    proj_r = await db.execute(select(Project).where(Project.id == project_id))
    if not proj_r.scalar_one_or_none():
        raise HTTPException(404, "Project not found")

    added = 0
    for item in items:
        db.add(Record(project_id=project_id, **item.dict()))
        added += 1

    await db.commit()
    return {"imported": added}