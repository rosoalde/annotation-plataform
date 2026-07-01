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
                Annotation.annotation_type.in_(["sentiment", "pillar", "field"]),
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
    mode: str   = "all",   # "judge" | "annotators" | "all"
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    import json, io, csv as _csv

    # ── 1. Cargar todos los records del proyecto con sus anotaciones ──────────
    rec_result = await db.execute(
        select(Record).where(Record.project_id == project_id)
    )
    all_records = {r.id: r for r in rec_result.scalars().all()}
    from backend.app.models.models import Project, Keyword
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_result.scalar_one_or_none()

    kw_result = await db.execute(select(Keyword).where(Keyword.project_id == project_id))
    keywords_list = kw_result.scalars().all()

    project_meta = {
        "project_id":        project_id,
        "project_name":      project.name if project else None,
        "project_tema":      project.tema if project else None,
        "project_desc_tema": project.desc_tema if project else None,
        "project_scope":     project.population_scope if project else None,
        "keywords_accepted": [k.keyword for k in keywords_list if k.accepted is True],
        "keywords_rejected": [k.keyword for k in keywords_list if k.accepted is False],
        "keywords_pending":  [k.keyword for k in keywords_list if k.accepted is None],
    }

    ann_result = await db.execute(
        select(Annotation)
        .options(selectinload(Annotation.annotator))
        .where(Annotation.project_id == project_id)
    )
    all_anns = ann_result.scalars().all()

    # Indexar anotaciones por record
    from collections import defaultdict
    anns_by_record: dict = defaultdict(list)
    for a in all_anns:
        anns_by_record[a.record_id].append(a)

    rows_judge: list = []
    rows_annotators: list = []

    for rec_id, rec in all_records.items():
        anns = anns_by_record.get(rec_id, [])

        # ── Datos base del record (LLM + metadata) ────────────────────────
        base = {
            "record_id":              rec.id,
            "external_id":            rec.external_id,
            "content":                rec.content,
            "platform":               rec.platform,
            "tipo":                   rec.tipo,
            "fecha":                  rec.fecha,
            "fuente":                 rec.fuente,
            "lang":                   rec.lang,
            "world_continent":        rec.world_continent,
            "world_country":          rec.world_country,
            "world_region":           rec.world_region,
            "world_city":             rec.world_city,
            "codigo_pais":            rec.codigo_pais,
            "url_post":               rec.url_post,
            "status":                 rec.status,
            # Valores LLM originales
            "sentiment_llm":          rec.sentiment_llm,
            "topic_llm":              rec.topic_llm,
            "pertinencia_llm":        rec.pertinencia,
            "posicion_llm":           rec.posicion,
            "legitimacion_llm":       rec.legitimacion,
            "efectividad_llm":        rec.efectividad,
            "justicia_equidad_llm":   rec.justicia_equidad,
            "confianza_inst_llm":     rec.confianza_institucional,
            **project_meta,
        }

        # ── Anotaciones humanas agrupadas por anotador ────────────────────
        # Sentimiento y topic (annotation_type="sentiment")
        sent_anns = [a for a in anns if a.annotation_type == "sentiment"]
        # Pilares (annotation_type="pillar")
        pillar_anns = [a for a in anns if a.annotation_type == "pillar"]
        # Campos de texto (annotation_type="field")
        field_anns = [a for a in anns if a.annotation_type == "field"]
        # Decisión del juez: último judge_final_value en anotaciones de sentimiento
        judge_ann = next((a for a in sent_anns if a.judge_final_value is not None), None)

        # ── Modo JUDGE: un row por record ─────────────────────────────────
        if mode in ("judge", "all"):
            # Recoger el topic humano consensuado (el del juez si existe, si no el primero disponible)
            human_topic = None
            for a in sent_anns:
                if a.corrected_topic:
                    human_topic = a.corrected_topic
                    break

            # Recoger pilares: si hay decisión del juez tomar ese anotador; si no, votar por mayoría
            pillar_values: dict = {}
            for p_ann in pillar_anns:
                key = p_ann.pillar
                if key not in pillar_values:
                    pillar_values[key] = []
                pillar_values[key].append(p_ann.corrected_value)
            pillar_consensus = {k: max(set(v), key=v.count) for k, v in pillar_values.items()}

            # Recoger campos de texto: último valor humano anotado para cada campo
            field_values: dict = {}
            for f_ann in field_anns:
                field_values[f_ann.field_name] = f_ann.corrected_text

            row = {
                **base,
                "export_mode":        "judge",
                "judge_final_value":  judge_ann.judge_final_value if judge_ann else None,
                "judge_annotator":    judge_ann.annotator.username if judge_ann and judge_ann.annotator else None,
                "human_topic":        human_topic,
                "human_pertinencia":  field_values.get("pertinencia"),
                "human_posicion":     field_values.get("posicion"),
                "human_lang":         field_values.get("lang"),
                "human_world_continent": field_values.get("world_continent"),
                "human_world_country":   field_values.get("world_country"),
                "human_world_region":    field_values.get("world_region"),
                "human_world_city":      field_values.get("world_city"),
                "human_codigo_pais":     field_values.get("codigo_pais"),
                "legitimacion_human":    pillar_consensus.get("legitimacion"),
                "efectividad_human":     pillar_consensus.get("efectividad"),
                "justicia_equidad_human": pillar_consensus.get("justicia_equidad"),
                "confianza_inst_human":  pillar_consensus.get("confianza_institucional"),
            }
            rows_judge.append(row)

        # ── Modo ANNOTATORS: un row por anotación de cada anotador ───────
        if mode in ("annotators", "all"):
            # Una fila por cada anotación de sentimiento (incluye topic)
            for a in sent_anns:
                rows_annotators.append({
                    **base,
                    "export_mode":       "annotator",
                    "annotator":          a.annotator.username if a.annotator else "?",
                    "annotation_type":    "sentiment",
                    "corrected_sentiment": a.corrected_sentiment,
                    "corrected_topic":     a.corrected_topic,
                    "is_correction":       a.is_correction,
                    "correction_reason":   a.correction_reason,
                    "reviewer_decision":   a.reviewer_decision,
                    "judge_final_value":   a.judge_final_value,
                    "pillar":             None,
                    "field_name":         None,
                    "corrected_value":    None,
                    "corrected_text":     None,
                })
            # Una fila por cada anotación de pilar
            for a in pillar_anns:
                rows_annotators.append({
                    **base,
                    "export_mode":       "annotator",
                    "annotator":          a.annotator.username if a.annotator else "?",
                    "annotation_type":    "pillar",
                    "corrected_sentiment": None,
                    "corrected_topic":    None,
                    "is_correction":      a.is_correction,
                    "correction_reason":  a.correction_reason,
                    "reviewer_decision":  a.reviewer_decision,
                    "judge_final_value":  a.judge_final_value,
                    "pillar":             a.pillar,
                    "field_name":         None,
                    "corrected_value":    a.corrected_value,
                    "corrected_text":     None,
                })
            # Una fila por cada anotación de campo de texto
            for a in field_anns:
                rows_annotators.append({
                    **base,
                    "export_mode":       "annotator",
                    "annotator":          a.annotator.username if a.annotator else "?",
                    "annotation_type":    "field",
                    "corrected_sentiment": None,
                    "corrected_topic":    None,
                    "is_correction":      a.is_correction,
                    "correction_reason":  a.correction_reason,
                    "reviewer_decision":  a.reviewer_decision,
                    "judge_final_value":  None,
                    "pillar":             None,
                    "field_name":         a.field_name,
                    "corrected_value":    None,
                    "corrected_text":     a.corrected_text,
                })

    all_rows = (rows_judge if mode == "judge"
                else rows_annotators if mode == "annotators"
                else rows_judge + rows_annotators)

    # ── Serializar ────────────────────────────────────────────────────────
    if format == "csv":
        if not all_rows:
            return {"data": "", "count": 0, "format": "csv", "mode": mode}
        out = io.StringIO()
        w   = _csv.DictWriter(out, fieldnames=list(all_rows[0].keys()), extrasaction="ignore")
        w.writeheader()
        w.writerows(all_rows)
        return {"data": out.getvalue(), "count": len(all_rows), "format": "csv", "mode": mode}

    lines = [json.dumps(r, ensure_ascii=False, default=str) for r in all_rows]
    return {"data": "\n".join(lines), "count": len(all_rows), "format": "jsonl", "mode": mode}