from __future__ import annotations
from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict


# ── Auth ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: str = "annotator"     # desired role; admin confirms on approval

class RegisterResponse(BaseModel):
    """No token here on purpose — a pending user cannot log in yet."""
    id: str
    username: str
    email: str
    role: str
    status: str
    message: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str
    status: str
    must_change_password: bool = False


# ── Admin: user management ──────────────────────────────────────────────────
class PendingUserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class UserApprovalDecision(BaseModel):
    decision: str            # "approve" | "reject"
    role: Optional[str] = None   # admin can override the requested role on approval

class AdminPasswordReset(BaseModel):
    new_password: Optional[str] = None   # si no se envía, se genera una temporal

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    
class UserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Projects ───────────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str
    tema: str
    desc_tema: str = ""
    population_scope: str = ""
    output_folder: Optional[str] = None

class ProjectOut(BaseModel):
    id: str
    name: str
    tema: str
    desc_tema: str
    population_scope: str
    output_folder: Optional[str]
    created_at: datetime
    keywords: List[Any] = []

    class Config:
        from_attributes = True


# ── Records ────────────────────────────────────────────────────────────────
class RecordOut(BaseModel):
    id: str
    external_id: Optional[str]
    content: Optional[str] = None
    platform: Optional[str]
    tipo: Optional[str]
    fecha: Optional[str]
    fuente: Optional[str]
    titulo_padre: Optional[str]
    cuerpo_padre: Optional[str]
    descripcion_padre: Optional[str]
    tweet_anterior: Optional[str]
    # idioma_ia: Optional[str]
    # New: language + world data produced by the LLM re-analysis pass
    lang: Optional[str] = None
    world_continent: Optional[str] = None
    world_country: Optional[str] = None
    world_region: Optional[str] = None
    world_city: Optional[str] = None
    url_post: Optional[str] = None
    pertinencia: Optional[str] = None
    justif_pertinencia: Optional[str] = None
    posicion: Optional[str] = None
    justif_posicion: Optional[str] = None
    justif_topic: Optional[str] = None
    justif_sentimiento: Optional[str] = None
    justif_legitimacion: Optional[str] = None
    justif_efectividad: Optional[str] = None
    justif_justicia_equidad: Optional[str] = None
    justif_confianza_institucional: Optional[str] = None
    justif_lang: Optional[str] = None
    justif_continente: Optional[str] = None
    justif_pais: Optional[str] = None
    justif_region: Optional[str] = None
    justif_ciudad: Optional[str] = None
    # codigo_pais: Optional[str] = None
    sentiment_llm: Optional[int]
    topic_llm: Optional[str]
    legitimacion: Optional[int]
    efectividad: Optional[int]
    justicia_equidad: Optional[int]
    confianza_institucional: Optional[int]
    status: str
    locked_by_other: bool = False
    locked_until: Optional[datetime] = None

    class Config:
        from_attributes = True
        extra = "ignore"   # ignora columnas extra en el CSV sin error

class RecordListResponse(BaseModel):
    records: List[RecordOut]
    total: int
    pending: int      # server-computed, never negative
    done: int
    offset: int
    limit: int

class RecordImportItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=(), extra="ignore")
    external_id: Optional[str] = None
    content: str
    platform: Optional[str] = None
    tipo: Optional[str] = None
    fecha: Optional[str] = None
    fuente: Optional[str] = None
    titulo_padre: Optional[str] = None
    cuerpo_padre: Optional[str] = None
    descripcion_padre: Optional[str] = None
    tweet_anterior: Optional[str] = None
    # idioma_ia: Optional[str] = None
    model_reasoning: Optional[str] = None
    relevancia_ia:   Optional[str] = None
    # New columns expected from the LLM re-analysis CSV export
    lang: Optional[str] = None
    world_continent: Optional[str] = None
    world_country: Optional[str] = None
    world_region: Optional[str] = None
    world_city: Optional[str] = None
    url_post: Optional[str] = None
    pertinencia: Optional[str] = None
    justif_pertinencia: Optional[str] = None
    posicion: Optional[str] = None
    justif_posicion: Optional[str] = None
    justif_topic: Optional[str] = None
    justif_sentimiento: Optional[str] = None
    justif_legitimacion: Optional[str] = None
    justif_efectividad: Optional[str] = None
    justif_justicia_equidad: Optional[str] = None
    justif_confianza_institucional: Optional[str] = None
    justif_lang: Optional[str] = None
    justif_continente: Optional[str] = None
    justif_pais: Optional[str] = None
    justif_region: Optional[str] = None
    justif_ciudad: Optional[str] = None
    # codigo_pais: Optional[str] = None 
    sentiment_llm: Optional[int] = None
    topic_llm: Optional[str] = None
    legitimacion: Optional[int] = None
    efectividad: Optional[int] = None
    justicia_equidad: Optional[int] = None
    confianza_institucional: Optional[int] = None


# ── Annotations ────────────────────────────────────────────────────────────
class SentimentAnnotationCreate(BaseModel):
    record_id: str
    project_id: str
    original_sentiment: int
    corrected_sentiment: int
    is_correction: bool
    correction_reason: Optional[str] = None
    original_topic: Optional[str] = None
    corrected_topic: Optional[str] = None
    topic_reason: Optional[str] = None
    expected_version: Optional[int] = None

class PilarAnnotationCreate(BaseModel):
    record_id: str
    project_id: str
    pilar: str
    original_value: int
    corrected_value: int
    is_correction: bool
    correction_reason: Optional[str] = None
    expected_version: Optional[int] = None

class KeywordDecisionCreate(BaseModel):
    project_id: str
    keyword: str
    accepted: bool
    reason: Optional[str] = None
    type: Optional[str] = "llm_generated"
    languages: Optional[str] = None

class AnnotationResponse(BaseModel):
    id: str
    record_id: str
    annotation_type: str
    is_correction: bool
    created_at: datetime
    version: int

    class Config:
        from_attributes = True

class FieldAnnotationCreate(BaseModel):
    record_id: str
    project_id: str
    field_name: str          # "posicion" | "lang" | "world_continent" | "world_country" | "world_region" | "world_city"
    original_text: Optional[str] = None
    corrected_text: Optional[str] = None
    is_correction: bool
    correction_reason: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    tema: Optional[str] = None
    desc_tema: Optional[str] = None
    population_scope: Optional[str] = None        


# ── Review ─────────────────────────────────────────────────────────────────
class ReviewAnnotationOut(BaseModel):
    id: str
    record_id: str
    annotation_type: str
    annotator_name: str
    original_sentiment: Optional[int]
    corrected_sentiment: Optional[int]
    correction_reason: Optional[str]
    original_topic: Optional[str]
    corrected_topic: Optional[str]
    original_value: Optional[int]
    corrected_value: Optional[int]
    field_name: Optional[str] = None
    original_text: Optional[str] = None
    corrected_text: Optional[str] = None
    pilar: Optional[str]
    is_correction: bool
    reviewer_decision: Optional[str]
    created_at: datetime
    # Contexto del registro (para el revisor)
    record_content: Optional[str] = None
    record_platform: Optional[str] = None
    record_tipo: Optional[str] = None
    record_fecha: Optional[str] = None
    record_url_post: Optional[str] = None
    record_cuerpo_padre: Optional[str] = None
    record_titulo_padre: Optional[str] = None

    class Config:
        from_attributes = True

class ReviewDecisionCreate(BaseModel):
    annotation_id: str
    decision: str   # accept | reject


# ── Judge ──────────────────────────────────────────────────────────────────
class JudgeAnnotationOut(BaseModel):
    id: str
    annotator: str
    annotation_type: str 
    corrected_sentiment: Optional[int]
    correction_reason: Optional[str]
    corrected_topic: Optional[str]
    corrected_value: Optional[int]
    pilar: Optional[str]
    field_name: Optional[str] = None      
    corrected_text: Optional[str] = None
    is_correction: bool
    judge_final_value: Optional[int]
    judge_final_text: Optional[str] = None
    reviewer_decision: Optional[str] = None

class JudgeRecordOut(BaseModel):
    record: RecordOut
    annotations: List[JudgeAnnotationOut]

class JudgeDecideCreate(BaseModel):
    annotation_id: str
    final_value: Optional[int] = None
    final_text: Optional[str] = None
    reason: Optional[str] = None

class JudgeDecideNewCreate(BaseModel):
    """Decisión del juez cuando NO existe ninguna fila previa (ningún anotador corrigió ese pilar/campo)."""
    record_id: str
    project_id: str
    annotation_type: str          # "pilar" | "field"
    pilar: Optional[str] = None
    field_name: Optional[str] = None
    final_value: Optional[int] = None
    final_text: Optional[str] = None
    reason: Optional[str] = None


# ── Stats ──────────────────────────────────────────────────────────────────
class ProjectStats(BaseModel):
    total_records: int
    pending: int
    annotated_partial: int
    annotated: int
    judged: int
    total_annotations: int
    total_corrections: int

class CsvImportResult(BaseModel):
    imported: int
    skipped: int
    errors: List[dict]
    project_updated: bool