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
        select(Record).where(Record.project_id == project_id, Record.status.in_(["annotated", "judged"]))
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
                corrected_topic=a.corrected_topic, corrected_value=a.corrected_value,
                pilar=a.pilar, field_name=a.field_name, corrected_text=a.corrected_text,
                is_correction=a.is_correction, judge_final_value=a.judge_final_value,
                judge_final_text=a.judge_final_text, reviewer_decision=a.reviewer_decision,
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
            world_country=rec.world_country, world_region=rec.world_region,
            world_city=rec.world_city, codigo_pais=rec.codigo_pais,
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
    """Crea la decisión del juez cuando ningún anotador corrigió ese pilar/campo."""
    ann = Annotation(
        record_id=body.record_id, project_id=body.project_id,
        annotator_id=current_user.id, annotation_type=body.annotation_type,
        pilar=body.pilar, field_name=body.field_name,
        is_correction=False, correction_reason=body.reason,
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
        "keywords_accepted": [k.keyword for k in keywords_list if k.accepted is True],
        "keywords_rejected": [k.keyword for k in keywords_list if k.accepted is False],
        "keywords_pending":  [k.keyword for k in keywords_list if k.accepted is None],
        "keywords_judge_accepted": [k.keyword for k in keywords_list if k.reviewer_decision == "accept"],
        "keywords_judge_rejected": [k.keyword for k in keywords_list if k.reviewer_decision == "reject"],
        "keywords_judge_pending":  [k.keyword for k in keywords_list if k.reviewer_decision is None],
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
            "idioma_ia_llm":              rec.idioma_ia,
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
        if mode in ("judge", "all"):
            # Sentimiento: prioriza la decisión del juez
            human_topic, human_topic_reason = None, None
            for a in sent_anns:
                if a.corrected_topic:
                    human_topic, human_topic_reason = a.corrected_topic, a.topic_reason
                    break

            # Pilares: decisión del juez por pilar; si no hay, mayoría entre anotadores
            PILAR_KEYS = ["legitimacion", "efectividad", "justicia_equidad", "confianza_institucional"]
            pilar_final: dict = {}
            for key in PILAR_KEYS:
                anns_k = [a for a in pilar_anns if a.pilar == key]
                judge_a = next((a for a in anns_k if a.judge_final_value is not None), None)
                if judge_a:
                    pilar_final[key] = (judge_a.judge_final_value, judge_a.correction_reason)
                else:
                    vals = [a.corrected_value for a in anns_k if a.corrected_value is not None]
                    if vals:
                        consensus = max(set(vals), key=vals.count)
                        reason = next((a.correction_reason for a in anns_k if a.corrected_value == consensus), None)
                        pilar_final[key] = (consensus, reason)
                    else:
                        pilar_final[key] = (None, None)

            # Campos de texto: decisión del juez; si no hay y todos los anotadores
            # coinciden, ese valor; si hay desacuerdo sin decisión del juez, queda pendiente (None)
            TEXT_FIELD_KEYS = ["pertinencia", "posicion", "idioma_ia", "lang",
                               "world_continent", "world_country", "world_region", "world_city", "codigo_pais"]
            field_final: dict = {}
            for key in TEXT_FIELD_KEYS:
                anns_k = [a for a in field_anns if a.field_name == key]
                judge_a = next((a for a in anns_k if a.judge_final_text is not None), None)
                if judge_a:
                    field_final[key] = (judge_a.judge_final_text, judge_a.correction_reason)
                else:
                    texts = {a.corrected_text for a in anns_k if a.corrected_text}
                    if len(texts) == 1:
                        value = next(iter(texts))
                        reason = next((a.correction_reason for a in anns_k if a.corrected_text == value), None)
                        field_final[key] = (value, reason)
                    else:
                        field_final[key] = (None, None)

            row = {
                **base,
                "export_mode":        "judge",
                "judge_final_value":  judge_ann.judge_final_value if judge_ann else None,
                "judge_annotator":    judge_ann.annotator.username if judge_ann and judge_ann.annotator else None,
                "judge_reason":       judge_ann.correction_reason if judge_ann else None,
                "human_topic":        human_topic,
                "human_topic_reason": human_topic_reason,
                "human_pertinencia":         field_final["pertinencia"][0],
                "human_pertinencia_reason":  field_final["pertinencia"][1],
                "human_posicion":            field_final["posicion"][0],
                "human_posicion_reason":     field_final["posicion"][1],
                "human_idioma_ia":           field_final["idioma_ia"][0],
                "human_idioma_ia_reason":    field_final["idioma_ia"][1],
                "human_lang":                field_final["lang"][0],
                "human_lang_reason":         field_final["lang"][1],
                "human_world_continent":         field_final["world_continent"][0],
                "human_world_continent_reason":  field_final["world_continent"][1],
                "human_world_country":           field_final["world_country"][0],
                "human_world_country_reason":    field_final["world_country"][1],
                "human_world_region":            field_final["world_region"][0],
                "human_world_region_reason":     field_final["world_region"][1],
                "human_world_city":              field_final["world_city"][0],
                "human_world_city_reason":       field_final["world_city"][1],
                "human_codigo_pais":             field_final["codigo_pais"][0],
                "human_codigo_pais_reason":      field_final["codigo_pais"][1],
                "legitimacion_human":            pilar_final["legitimacion"][0],
                "legitimacion_human_reason":     pilar_final["legitimacion"][1],
                "efectividad_human":             pilar_final["efectividad"][0],
                "efectividad_human_reason":      pilar_final["efectividad"][1],
                "justicia_equidad_human":        pilar_final["justicia_equidad"][0],
                "justicia_equidad_human_reason": pilar_final["justicia_equidad"][1],
                "confianza_inst_human":          pilar_final["confianza_institucional"][0],
                "confianza_inst_human_reason":   pilar_final["confianza_institucional"][1],
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