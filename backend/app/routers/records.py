"""
Records router.

  - GET /records computes `pending` server-side (never negative).
  - POST /records/{id}/lock acquires a pessimistic lock (30 min TTL).
    Returns 409 if another ACTIVE user holds the lock.
  - DELETE /records/{id}/lock releases the lock.
  - POST /records/import bulk-loads rows (now including lang + world_* columns
    produced by the LLM re-analysis pass).
"""
import csv
import io
import json

from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import File, UploadFile, Form, APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct

from backend.app.core.database import get_db
from backend.app.core.security import get_current_user, require_role
from backend.app.models.models import User, Record, RecordLock, Annotation, Project
from backend.app.schemas.schemas import RecordOut, RecordListResponse, RecordImportItem, CsvImportResult

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

    # ANTES
    # page_q  = q.order_by(Record.created_at).offset(offset).limit(limit)
    # DESPUÉS
    page_q = q
    if annotation_type and done_ids:
        page_q = page_q.where(Record.id.notin_(done_ids))   # ← oculta lo que YA anotaste
    page_q = page_q.order_by(Record.created_at).offset(offset).limit(limit)
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
            tweet_anterior=rec.tweet_anterior, #idioma=rec.idioma,
            lang=rec.lang, world_continent=rec.world_continent,
            world_country=rec.world_country, world_region=rec.world_region,
            world_city=rec.world_city,
            url_post=rec.url_post,
            pertinencia=rec.pertinencia,
            justif_pertinencia=rec.justif_pertinencia,
            posicion=rec.posicion,
            justif_posicion=rec.justif_posicion,
            justif_topic=rec.justif_topic,
            justif_sentimiento=rec.justif_sentimiento,
            justif_legitimacion=rec.justif_legitimacion,
            justif_efectividad=rec.justif_efectividad,
            justif_justicia_equidad=rec.justif_justicia_equidad,
            justif_confianza_institucional=rec.justif_confianza_institucional,
            justif_lang=rec.justif_lang,
            justif_continente=rec.justif_continente,
            justif_pais=rec.justif_pais,
            justif_region=rec.justif_region,
            justif_ciudad=rec.justif_ciudad,
            # codigo_pais=rec.codigo_pais,
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

@router.post("/{project_id}/records/import-csv", response_model=CsvImportResult)
async def import_records_csv(
    project_id: str,
    csv_file: UploadFile  = File(..., description="CSV con posts/comentarios anotados por el LLM"),
    meta_json: str        = Form("{}",  description="JSON con metadatos del proyecto (opcional)"),
    db: AsyncSession      = Depends(get_db),
    current_user: User    = Depends(require_role("admin", "reviewer")),
):
    """
    Importa records desde un CSV con campos LLM pre-rellenados.
    Acepta multipart/form-data: csv_file + meta_json (string JSON).
    
    El CSV debe tener cabecera. Columnas reconocidas: todas las de RecordImportItem.
    Columnas extra son ignoradas silenciosamente (extra = "ignore" en el schema).
    """
    # 1. Verificar proyecto
    proj_r = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_r.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    # 2. Actualizar metadatos del proyecto desde el JSON (opcional)
    project_updated = False
    try:
        meta = json.loads(meta_json)
        if meta.get("desc_tema"):
            project.desc_tema = meta["desc_tema"]
        if meta.get("population_scope"):
            project.population_scope = meta["population_scope"]
        if meta.get("name"):
            project.name = meta["name"]
        if meta:
            project_updated = True
    except (json.JSONDecodeError, Exception):
        pass   # meta_json vacío o inválido → no pasa nada

    # 3. Leer y parsear CSV
    try:
        raw = await csv_file.read()
        text = raw.decode("utf-8-sig")   # utf-8-sig para manejar BOM de Excel
        dialect = "excel" if "," in text.splitlines()[0] and ";" not in text.splitlines()[0] else "excel-tab"
        delimiter = ";" if ";" in text.splitlines()[0] else ","
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        rows = list(reader)
    except Exception as e:
        raise HTTPException(422, f"CSV inválido: {e}")

    if not rows:
        raise HTTPException(422, "El CSV está vacío o no tiene filas de datos")

    # 4. Validar y construir objetos Record
    added = 0
    skipped = 0
    errors = []
    # ── Construir lookup de contenido de posts raíz para resolver cuerpo_padre ──
    # Se hace antes del loop principal porque los comentarios referencian
    # otras filas del mismo CSV (Bluesky: por uri / Reddit: por id_raiz).
    def _sv(v: object) -> str:
        s = str(v).strip() if v is not None else ""
        return "" if s.lower() in ("nan", "none", "") else s

    _bluesky_parent: dict[str, str] = {}  # uri → contenido
    _reddit_parent: dict[str, str] = {}   # id_raiz → contenido

    for _raw in rows:
        _uri = _sv(_raw.get("uri", ""))
        _cont = _sv(_raw.get("contenido", ""))
        if _uri and _cont:
            _bluesky_parent[_uri] = _cont
        if _sv(_raw.get("tipo", "")).upper() == "POST":
            _id = _sv(_raw.get("id_raiz", "")) or _sv(_raw.get("id_propio", ""))
            if _id and _cont:
                _reddit_parent[_id] = _cont
    CSV_COLUMN_MAP = {
        "contenido":           "content",
        "sent_subtopic":       "sentiment_llm",
        "subtopic":            "topic_llm",
        "idioma":              "lang",
        "continente":          "world_continent",
        "pais":                "world_country",
        "region":              "world_region",
        "ciudad":              "world_city",
        "justicia_eq":         "justicia_equidad",
        "confianza":           "confianza_institucional",
        "sent_subtopic_just":  "justif_sentimiento",
        "subtopic_just":       "justif_topic",
        "posicion_just":       "justif_posicion",
        "idioma_just":         "justif_lang",
        "continente_just":     "justif_continente",
        "pais_just":           "justif_pais",
        "pertinente_just":     "justif_pertinencia",
        "region_just":         "justif_region",
        "ciudad_just":         "justif_ciudad",
        "legitimacion_just":   "justif_legitimacion",
        "efectividad_just":    "justif_efectividad",
        "justicia_eq_just":    "justif_justicia_equidad",
        "confianza_just":      "justif_confianza_institucional",
        # YouTube: reutiliza campos de contexto existentes
        "titulo_video":        "titulo_padre",
        "canal":               "fuente",
        # Bluesky: el uri actúa como external_id
        "uri":                 "url_post",
    }
    _headers = set(rows[0].keys()) if rows else set()
    _inferred_platform = (
        "bluesky" if "uri" in _headers
        else "reddit" if "id_raiz" in _headers
        else "youtube" if "id_video" in _headers
        else None
    )
    for i, row in enumerate(rows):
        original_row = dict(row)  # guardar antes de remap para lookup de parent_uri / id_raiz

        # 1. Renombrar columnas según el mapa
        row = {CSV_COLUMN_MAP.get(k, k): v for k, v in row.items()}

        # 2. Convertir cadenas vacías a None
        cleaned = {k: (v if v != "" else None) for k, v in row.items()}

        # 2b. Resolver cuerpo_padre para comentarios
        if str(cleaned.get("tipo") or "").upper() == "COMENTARIO" and not cleaned.get("cuerpo_padre"):
            # Bluesky: buscar el post raíz por parent_uri
            _puri = str(original_row.get("parent_uri") or "").strip()
            if _puri and _puri in _bluesky_parent:
                cleaned["cuerpo_padre"] = _bluesky_parent[_puri]
            # Reddit: buscar el post raíz por id_raiz
            if not cleaned.get("cuerpo_padre"):
                _rid = str(original_row.get("id_raiz") or "").strip()
                if _rid and _rid in _reddit_parent:
                    cleaned["cuerpo_padre"] = _reddit_parent[_rid]

        # 3. pertinente (bool/string) → pertinencia (string)
        if "pertinente" in cleaned and cleaned["pertinente"] is not None:
            v = str(cleaned.pop("pertinente")).strip().lower()
            cleaned["pertinencia"] = "relevante" if v in ("true", "si", "sí", "1") else "irrelevante"

        # 4. Desempaquetar listas JSON en campos geo (["es"] → "es")
        for geo_field in ("lang", "world_continent", "world_country"):
            val = cleaned.get(geo_field)
            if val and str(val).startswith("["):
                try:
                    parsed = json.loads(val.replace('""', '"'))
                    if isinstance(parsed, list) and parsed:
                        cleaned[geo_field] = parsed[0] if parsed[0] != "N/A" else None
                except Exception:
                    pass
        # 5. Reconstruir url_post a partir de identificadores nativos de cada plataforma
        raw_url = cleaned.get("url_post") or ""
        if _inferred_platform == "bluesky" and str(raw_url).startswith("at://"):
            parts = str(raw_url).split("/")
            if len(parts) >= 5:
                did  = parts[2]
                post = parts[-1]
                cleaned["url_post"] = f"https://bsky.app/profile/{did}/post/{post}"

        elif _inferred_platform == "reddit" and not raw_url:
            root = cleaned.get("id_raiz")
            own  = cleaned.get("id_propio")
            tipo = str(cleaned.get("tipo") or "").upper()
            if root:
                if tipo == "COMENTARIO" and own:
                    cleaned["url_post"] = f"https://www.reddit.com/comments/{root}/_/{own}"
                else:
                    cleaned["url_post"] = f"https://www.reddit.com/comments/{root}"

        elif _inferred_platform == "youtube" and not raw_url:
            vid = cleaned.get("id_video")
            if vid:
                cleaned["url_post"] = f"https://youtu.be/{vid}"       
        try:
            from backend.app.schemas.schemas import RecordImportItem
            item = RecordImportItem(**cleaned)
        except Exception as e:
            errors.append({"fila": i + 2, "error": str(e)})
            skipped += 1
            continue

        # Convertir int opcionalmente (el CSV los trae como string)
        def to_int(v):
            try:
                return int(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        db.add(Record(
            project_id=project_id,
            external_id=item.external_id,
            content=item.content,
            platform=item.platform or _inferred_platform,
            tipo=item.tipo,
            fecha=item.fecha,
            fuente=item.fuente,
            titulo_padre=item.titulo_padre,
            cuerpo_padre=item.cuerpo_padre,
            descripcion_padre=item.descripcion_padre,
            tweet_anterior=item.tweet_anterior,
            # idioma=item.idioma,
            model_reasoning  = item.model_reasoning,
            relevancia_ia    = item.relevancia_ia,
            lang=item.lang,
            world_continent=item.world_continent,
            world_country=item.world_country,
            world_region=item.world_region,
            world_city=item.world_city,
            sentiment_llm=to_int(item.sentiment_llm),
            topic_llm=item.topic_llm,
            legitimacion=to_int(item.legitimacion),
            efectividad=to_int(item.efectividad),
            justicia_equidad=to_int(item.justicia_equidad),
            confianza_institucional=to_int(item.confianza_institucional),
            # Campos nuevos
            url_post=item.url_post,
            pertinencia=item.pertinencia,
            justif_pertinencia=item.justif_pertinencia,
            posicion=item.posicion,
            justif_posicion=item.justif_posicion,
            justif_topic=item.justif_topic,
            justif_sentimiento=item.justif_sentimiento,
            justif_legitimacion=item.justif_legitimacion,
            justif_efectividad=item.justif_efectividad,
            justif_justicia_equidad=item.justif_justicia_equidad,
            justif_confianza_institucional=item.justif_confianza_institucional,
            justif_lang=item.justif_lang,
            justif_continente=item.justif_continente,
            justif_pais=item.justif_pais,
            justif_region=item.justif_region,
            justif_ciudad=item.justif_ciudad,
            # codigo_pais=item.codigo_pais,
            status="pending",
        ))
        added += 1

    await db.commit()
    return CsvImportResult(
        imported=added,
        skipped=skipped,
        errors=errors[:50],   # máx 50 errores en la respuesta
        project_updated=project_updated
    )

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