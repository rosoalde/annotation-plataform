from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.core.security import require_role
from backend.app.models.models import User, Record, Annotation
from backend.app.schemas.schemas import JudgeRecordOut, JudgeAnnotationOut, JudgeDecideCreate, JudgeDecideNewCreate, RecordOut

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
        select(Record).where(Record.project_id == project_id, Record.status.in_(["annotated", "annotated_partial", "judged"]))
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
                Annotation.annotation_type.in_(["sentiment", "pilar", "field"]),
            )
        )
        if annotation_type:
            ann_q = ann_q.where(Annotation.annotation_type == annotation_type)
        ann_r = await db.execute(ann_q)
        anns  = ann_r.scalars().all()

        ann_out = [
            JudgeAnnotationOut(
                id=a.id, annotator=a.annotator.username if a.annotator else "?",
                annotation_type=a.annotation_type,
                corrected_sentiment=a.corrected_sentiment, correction_reason=a.correction_reason,
                corrected_topic=a.corrected_topic, topic_reason=a.topic_reason, corrected_value=a.corrected_value,
                pilar=a.pilar, field_name=a.field_name, corrected_text=a.corrected_text,
                is_correction=a.is_correction, judge_final_value=a.judge_final_value,
                judge_final_text=a.judge_final_text, judge_reason=a.judge_reason,
                reviewer_decision=a.reviewer_decision,
            )
            for a in anns
        ]

        rec_out = RecordOut(
            id=rec.id, external_id=rec.external_id, content=rec.content,
            platform=rec.platform, tipo=rec.tipo, fecha=rec.fecha,
            fuente=rec.fuente, titulo_padre=rec.titulo_padre,
            cuerpo_padre=rec.cuerpo_padre, descripcion_padre=rec.descripcion_padre,
            tweet_anterior=rec.tweet_anterior, #idioma=rec.idioma,
            lang=rec.lang, world_continent=rec.world_continent,
            world_country=rec.world_country, world_region=rec.world_region,
            world_city=rec.world_city, #codigo_pais=rec.codigo_pais,
            url_post=rec.url_post,
            pertinencia=rec.pertinencia, justif_pertinencia=rec.justif_pertinencia,
            posicion=rec.posicion, justif_posicion=rec.justif_posicion,
            sentiment_llm=rec.sentiment_llm, justif_sentimiento=rec.justif_sentimiento,
            topic_llm=rec.topic_llm, justif_topic=rec.justif_topic,
            legitimacion=rec.legitimacion, justif_legitimacion=rec.justif_legitimacion,
            efectividad=rec.efectividad, justif_efectividad=rec.justif_efectividad,
            justicia_equidad=rec.justicia_equidad, justif_justicia_equidad=rec.justif_justicia_equidad,
            confianza_institucional=rec.confianza_institucional,
            justif_confianza_institucional=rec.justif_confianza_institucional,
            justif_lang=rec.justif_lang, justif_continente=rec.justif_continente,
            justif_pais=rec.justif_pais, justif_region=rec.justif_region,
            justif_ciudad=rec.justif_ciudad,
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

    if body.final_value is not None:
        ann.judge_final_value = body.final_value
    if body.final_text is not None:
        ann.judge_final_text = body.final_text
    if body.reason is not None:
        ann.judge_reason = body.reason
    await db.flush()   # persiste el valor actual antes de contar 

    # Solo marca como "judged" cuando TODAS las correcciones del registro
    # tienen una decisión final del juez.
    pending_r = await db.execute(
        select(func.count()).where(
            Annotation.record_id == ann.record_id,
            Annotation.is_correction == True,
            Annotation.judge_final_value == None,
        )
    )
    pending = pending_r.scalar() or 0

    if pending == 0:
        rec_r = await db.execute(select(Record).where(Record.id == ann.record_id))
        record = rec_r.scalar_one_or_none()
        if record:
            record.status = "judged"

    await db.commit()
    return {"ok": True, "final_value": body.final_value, "pending_decisions": pending}

@router.post("/decide-new")
async def judge_decide_new(
    body: JudgeDecideNewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    """
    Upsert: si ya existe una anotación del juez para este record+tipo+campo,
    la actualiza. Si no, la crea. Evita duplicados en ediciones sucesivas.
    """
    q = select(Annotation).where(
        Annotation.record_id       == body.record_id,
        Annotation.annotation_type == body.annotation_type,
        Annotation.annotator_id    == current_user.id,
    )
    if body.pilar:
        q = q.where(Annotation.pilar == body.pilar)
    if body.field_name:
        q = q.where(Annotation.field_name == body.field_name)
    if body.annotation_type == "sentiment":
        q = q.where(Annotation.pilar == None, Annotation.field_name == None)

    result = await db.execute(q)
    ann    = result.scalar_one_or_none()

    if ann:
        # Ya existe: actualiza en vez de insertar
        if body.final_value is not None:
            ann.judge_final_value = body.final_value
        if body.final_text is not None:
            ann.judge_final_text = body.final_text
        if body.reason is not None:
            ann.judge_reason = body.reason
    else:
        ann = Annotation(
            record_id=body.record_id, project_id=body.project_id,
            annotator_id=current_user.id, annotation_type=body.annotation_type,
            pilar=body.pilar, field_name=body.field_name,
            is_correction=False, judge_reason=body.reason,
            judge_final_value=body.final_value, judge_final_text=body.final_text,
        )
        db.add(ann)

    await db.commit()
    return {"ok": True, "id": ann.id}

@router.delete("/reset/{project_id}")
async def reset_judge_decisions(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("judge", "admin")),
):
    """Borra todas las decisiones del juez y devuelve los registros a status=annotated."""
    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(Annotation)
        .where(Annotation.project_id == project_id, Annotation.judge_final_value != None)
        .values(judge_final_value=None)
    )
    await db.execute(
        sa_update(Record)
        .where(Record.project_id == project_id, Record.status == "judged")
        .values(status="annotated")
    )
    await db.commit()
    return {"ok": True, "message": "Decisiones del juez eliminadas"}
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
        # "keywords_accepted": [k.keyword for k in keywords_list if k.accepted is True],
        # "keywords_rejected": [k.keyword for k in keywords_list if k.accepted is False],
        # "keywords_pending":  [k.keyword for k in keywords_list if k.accepted is None],
        # "keywords_judge_accepted": [k.keyword for k in keywords_list if k.reviewer_decision == "accept"],
        # "keywords_judge_rejected": [k.keyword for k in keywords_list if k.reviewer_decision == "reject"],
        # "keywords_judge_pending":  [k.keyword for k in keywords_list if k.reviewer_decision is None],
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
            # "codigo_pais":            rec.codigo_pais,
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
            "idioma_llm":              rec.lang,
            "justif_sentimiento":         rec.justif_sentimiento,
            "justif_topic":               rec.justif_topic,
            "justif_pertinencia":         rec.justif_pertinencia,
            "justif_posicion":            rec.justif_posicion,
            "justif_legitimacion":        rec.justif_legitimacion,
            "justif_efectividad":         rec.justif_efectividad,
            "justif_justicia_equidad":    rec.justif_justicia_equidad,
            "justif_confianza_institucional": rec.justif_confianza_institucional,
            "justif_lang":                rec.justif_lang,
            "justif_continente":          rec.justif_continente,
            "justif_pais":                rec.justif_pais,
            "justif_region":              rec.justif_region,
            "justif_ciudad":              rec.justif_ciudad,
            **project_meta,
        }

        # ── Anotaciones humanas agrupadas por anotador ────────────────────
        # Sentimiento y topic (annotation_type="sentiment")
        sent_anns = [a for a in anns if a.annotation_type == "sentiment"]
        # Pilares (annotation_type="pilar")
        pilar_anns = [a for a in anns if a.annotation_type == "pilar"]
        # Campos de texto (annotation_type="field")
        field_anns = [a for a in anns if a.annotation_type == "field"]
        # Decisión del juez: último judge_final_value en anotaciones de sentimiento
        judge_ann = next((a for a in sent_anns if a.judge_final_value is not None), None)

        # ── Modo JUDGE: un row por record ─────────────────────────────────
        # ── Modo JUDGE: un row por record ─────────────────────────────────
        if mode in ("judge", "all"):
            # ── Sentiment ──────────────────────────────────────────────────
            judge_sent_ann = next(
                (a for a in sent_anns if a.judge_final_value is not None), None
            )
            sent_final       = judge_sent_ann.judge_final_value if judge_sent_ann else rec.sentiment_llm
            sent_judge_reason = judge_sent_ann.judge_reason if judge_sent_ann else None

            # ── Topic (stored as field annotation with field_name="topic") ─
            judge_topic_ann = next(
                (a for a in field_anns if a.field_name == "topic" and a.judge_final_text is not None), None
            )
            topic_final       = judge_topic_ann.judge_final_text if judge_topic_ann else rec.topic_llm
            topic_judge_reason = judge_topic_ann.judge_reason if judge_topic_ann else None

            # ── Pilars ────────────────────────────────────────────────────
            PILAR_KEYS = [
                "legitimacion", "efectividad",
                "justicia_equidad", "confianza_institucional",
            ]
            pilar_llm_map = {
                "legitimacion":            rec.legitimacion,
                "efectividad":             rec.efectividad,
                "justicia_equidad":        rec.justicia_equidad,
                "confianza_institucional": rec.confianza_institucional,
            }
            pilar_final   = {}
            pilar_reasons = {}
            for key in PILAR_KEYS:
                judge_a = next(
                    (a for a in pilar_anns if a.pilar == key and a.judge_final_value is not None), None
                )
                if judge_a:
                    pilar_final[key]   = judge_a.judge_final_value
                    pilar_reasons[key] = judge_a.judge_reason
                else:
                    pilar_final[key]   = pilar_llm_map[key]   # LLM fallback
                    pilar_reasons[key] = None

            # ── Text fields ────────────────────────────────────────────────
            TEXT_FIELD_KEYS = [
                "pertinencia", "posicion", "lang",
                "world_continent", "world_country", "world_region",
                "world_city", #"codigo_pais",
            ]
            llm_field_map = {
                "pertinencia":     rec.pertinencia,
                "posicion":        rec.posicion,
                "lang":            rec.lang,
                "world_continent": rec.world_continent,
                "world_country":   rec.world_country,
                "world_region":    rec.world_region,
                "world_city":      rec.world_city,
                #"codigo_pais":     rec.codigo_pais,
            }
            field_final   = {}
            field_reasons = {}
            for key in TEXT_FIELD_KEYS:
                judge_a = next(
                    (a for a in field_anns
                     if a.field_name == key and a.judge_final_text is not None), None
                )
                if judge_a:
                    field_final[key]   = judge_a.judge_final_text
                    field_reasons[key] = judge_a.judge_reason
                else:
                    field_final[key]   = llm_field_map[key]   # LLM fallback
                    field_reasons[key] = None

            # ── Judge username ─────────────────────────────────────────────
            judge_user = None
            for _a in sent_anns + pilar_anns + field_anns:
                if _a.judge_final_value is not None or _a.judge_final_text is not None:
                    judge_user = _a.annotator.username if _a.annotator else None
                    break

            judge_made_correction = (
                judge_sent_ann is not None
                or judge_topic_ann is not None
                or any(field_reasons[k] is not None for k in TEXT_FIELD_KEYS)
                or any(pilar_reasons[k] is not None for k in PILAR_KEYS)
            )

            row = {
                # ── Identity & metadata ───────────────────────────────────
                "record_id":   rec.id,
                "external_id": rec.external_id,
                "content":     rec.content,
                "platform":    rec.platform,
                "tipo":        rec.tipo,
                "fecha":       rec.fecha,
                "fuente":      rec.fuente,
                "url_post":    rec.url_post,
                "status":      rec.status,
                # ── LLM original values (audit trail) ─────────────────────
                # "sentiment_llm":        rec.sentiment_llm,
                # "topic_llm":            rec.topic_llm,
                # "pertinencia_llm":      rec.pertinencia,
                # "posicion_llm":         rec.posicion,
                # "lang_llm":             rec.lang,
                # "world_continent_llm":  rec.world_continent,
                # "world_country_llm":    rec.world_country,
                # "world_region_llm":     rec.world_region,
                # "world_city_llm":       rec.world_city,
                # "codigo_pais_llm":      rec.codigo_pais,
                # "legitimacion_llm":     rec.legitimacion,
                # "efectividad_llm":      rec.efectividad,
                # "justicia_equidad_llm": rec.justicia_equidad,
                # "confianza_inst_llm":   rec.confianza_institucional,
                # ── GOLD-STANDARD final values (judge OR LLM fallback) ─────
                "sentiment_final":        sent_final,
                "topic_final":            topic_final,
                "pertinencia_final":      field_final["pertinencia"],
                "posicion_final":         field_final["posicion"],
                "lang_final":             field_final["lang"],
                "world_continent_final":  field_final["world_continent"],
                "world_country_final":    field_final["world_country"],
                "world_region_final":     field_final["world_region"],
                "world_city_final":       field_final["world_city"],
                #"codigo_pais_final":      field_final["codigo_pais"],
                "legitimacion_final":     pilar_final["legitimacion"],
                "efectividad_final":      pilar_final["efectividad"],
                "justicia_equidad_final": pilar_final["justicia_equidad"],
                "confianza_inst_final":   pilar_final["confianza_institucional"],
                # ── Judge justifications (null = kept LLM value as-is) ─────
                "judge_sentiment_reason":        sent_judge_reason,
                "judge_topic_reason":            topic_judge_reason,
                "judge_pertinencia_reason":      field_reasons["pertinencia"],
                "judge_posicion_reason":         field_reasons["posicion"],
                "judge_lang_reason":             field_reasons["lang"],
                "judge_world_continent_reason":  field_reasons["world_continent"],
                "judge_world_country_reason":    field_reasons["world_country"],
                "judge_world_region_reason":     field_reasons["world_region"],
                "judge_world_city_reason":       field_reasons["world_city"],
                "judge_legitimacion_reason":     pilar_reasons["legitimacion"],
                "judge_efectividad_reason":      pilar_reasons["efectividad"],
                "judge_justicia_equidad_reason": pilar_reasons["justicia_equidad"],
                "judge_confianza_inst_reason":   pilar_reasons["confianza_institucional"],
                # ── Audit ──────────────────────────────────────────────────
                "judge_made_correction": judge_made_correction,
                "judge_username":        judge_user,
                # ── Project context ───────────────────────────────────────
                "keywords_judge_accepted": [
                    {"keyword": k.keyword, "reason": k.reason}
                    for k in keywords_list if k.reviewer_decision == "accept"
                ],
                **project_meta,
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
                    "pilar":             None,
                    "field_name":         None,
                    "corrected_value":    None,
                    "corrected_text":     None,
                })
            # Una fila por cada anotación de pilar
            for a in pilar_anns:
                rows_annotators.append({
                    **base,
                    "export_mode":       "annotator",
                    "annotator":          a.annotator.username if a.annotator else "?",
                    "annotation_type":    "pilar",
                    "corrected_sentiment": None,
                    "corrected_topic":    None,
                    "is_correction":      a.is_correction,
                    "correction_reason":  a.correction_reason,
                    "reviewer_decision":  a.reviewer_decision,
                    "judge_final_value":  a.judge_final_value,
                    "pilar":             a.pilar,
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
                    "pilar":             None,
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
        fieldnames = list(dict.fromkeys(k for r in all_rows for k in r.keys()))  # unión de todas las claves, sin duplicar
        w   = _csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_rows)
        return {"data": out.getvalue(), "count": len(all_rows), "format": "csv", "mode": mode}

    lines = [json.dumps(r, ensure_ascii=False, default=str) for r in all_rows]
    return {"data": "\n".join(lines), "count": len(all_rows), "format": "jsonl", "mode": mode}