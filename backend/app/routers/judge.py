from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.core.security import require_role
from backend.app.models.models import User, Record, Annotation
from backend.app.schemas.schemas import JudgeRecordOut, JudgeAnnotationOut, JudgeDecideCreate, RecordOut

router = APIRouter(tags=["judge"])


@router.get("/records", response_model=List[JudgeRecordOut])
async def judge_records(
    project_id:      str           = Query(...),
    annotation_type: Optional[str] = None,
    limit: int                     = 20,
    offset: int                    = 0,
    db: AsyncSession                = Depends(get_db),
    current_user: User              = Depends(require_role("judge", "admin")),
):
    rec_result = await db.execute(
        select(Record).where(Record.project_id == project_id, Record.status == "annotated")
        .offset(offset).limit(limit)
    )
    records = rec_result.scalars().all()

    out = []
    for rec in records:
        ann_q = (
            select(Annotation)
            .options(selectinload(Annotation.annotator))   # ← fix: eager load en async
            .where(
                Annotation.record_id == rec.id,
                Annotation.annotation_type.in_(["sentiment", "pillar"]),
            )
        )
        if annotation_type:
            ann_q = ann_q.where(Annotation.annotation_type == annotation_type)
        ann_r = await db.execute(ann_q)
        anns  = ann_r.scalars().all()

        ann_out = [
            JudgeAnnotationOut(
                id=a.id, annotator=a.annotator.username if a.annotator else "?",
                corrected_sentiment=a.corrected_sentiment, correction_reason=a.correction_reason,
                corrected_topic=a.corrected_topic, corrected_value=a.corrected_value,
                pillar=a.pillar, is_correction=a.is_correction, judge_final_value=a.judge_final_value,
            )
            for a in anns
        ]

        rec_out = RecordOut(
            id=rec.id, external_id=rec.external_id, content=rec.content,
            platform=rec.platform, tipo=rec.tipo, fecha=rec.fecha,
            fuente=rec.fuente, titulo_padre=rec.titulo_padre,
            cuerpo_padre=rec.cuerpo_padre, descripcion_padre=rec.descripcion_padre,
            tweet_anterior=rec.tweet_anterior, idioma_ia=rec.idioma_ia,
            lang=rec.lang, world_continent=rec.world_continent,
            world_country=rec.world_country, world_region=rec.world_region, world_city=rec.world_city,
            sentiment_llm=rec.sentiment_llm, topic_llm=rec.topic_llm,
            legitimacion=rec.legitimacion, efectividad=rec.efectividad,
            justicia_equidad=rec.justicia_equidad, confianza_institucional=rec.confianza_institucional,
            status=rec.status, locked_by_other=False,
        )
        out.append(JudgeRecordOut(record=rec_out, annotations=ann_out))

    return out


@router.post("/decide/{annotation_id}")
async def judge_decide(
    annotation_id: str,
    body: JudgeDecideCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    ann    = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(404, "Annotation not found")

    ann.judge_final_value = body.final_value

    rec_r  = await db.execute(select(Record).where(Record.id == ann.record_id))
    record = rec_r.scalar_one_or_none()
    if record:
        record.status = "judged"

    await db.commit()
    return {"ok": True, "final_value": body.final_value}


@router.get("/export/{project_id}")
async def export_judged(
    project_id: str,
    format: str = "jsonl",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    result = await db.execute(
        select(Annotation)
        .options(selectinload(Annotation.annotator))   # ← fix: eager load en async
        .where(
            Annotation.project_id == project_id,
            Annotation.judge_final_value != None,
            Annotation.reviewer_decision != "reject",
        )
    )
    annotations = result.scalars().all()

    records = []
    for ann in annotations:
        rec_r  = await db.execute(select(Record).where(Record.id == ann.record_id))
        record = rec_r.scalar_one_or_none()
        if not record:
            continue
        records.append({
            "instruction": f"Clasifica el sentimiento de esta publicación sobre '{record.topic_llm or ''}'.",
            "input": record.content,
            "output": str(ann.judge_final_value),
            "metadata": {
                "annotator": ann.annotator.username if ann.annotator else "?",
                "pillar": ann.pillar, "is_correction": ann.is_correction,
                "lang": record.lang, "world_country": record.world_country,
            }
        })

    import json, io, csv as _csv
    if format == "csv":
        out = io.StringIO()
        w   = _csv.DictWriter(out, fieldnames=["instruction", "input", "output"])
        w.writeheader()
        for r in records:
            w.writerow({k: r[k] for k in ["instruction", "input", "output"]})
        return {"data": out.getvalue(), "count": len(records), "format": "csv"}

    lines = [json.dumps(r, ensure_ascii=False) for r in records]
    return {"data": "\n".join(lines), "count": len(records), "format": "jsonl"}
