"""
Database models for the annotation platform.

Tables:
  users            – users with roles AND an approval workflow:
                     status: pending | approved | rejected
                     A user that self-registers starts as "pending" and
                     CANNOT log in until an admin approves them.
  projects         – annotation projects
  keywords         – keywords belonging to a project
  records          – data records to annotate (now includes world_data + lang,
                     filled by the LLM re-analysis pass and imported from CSV)
  record_locks     – pessimistic lock table (30-min TTL)
  annotations      – all human annotations (sentiment + pilar + keyword)
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, Boolean, Text, DateTime,
    ForeignKey, Enum
)
from sqlalchemy.orm import relationship

from backend.app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id         = Column(String, primary_key=True, default=_uuid)
    username   = Column(String(64), unique=True, nullable=False, index=True)
    email      = Column(String(160), unique=True, nullable=False, index=True)
    hashed_pw  = Column(String, nullable=False)
    role       = Column(
        Enum("annotator", "reviewer", "judge", "admin", name="user_role"),
        nullable=False, default="annotator"
    )
    # Approval workflow — new users are NOT usable until an admin approves them.
    status = Column(
        Enum("pending", "approved", "rejected", name="user_status"),
        nullable=False, default="pending"
    )
    approved_by = Column(String, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false")

    annotations = relationship("Annotation", back_populates="annotator", foreign_keys="Annotation.annotator_id")
    locks       = relationship("RecordLock", back_populates="user")


class Project(Base):
    __tablename__ = "projects"

    id               = Column(String, primary_key=True, default=_uuid)
    name             = Column(String(200), nullable=False)
    tema             = Column(String(200), nullable=False)
    desc_tema        = Column(Text, default="")
    population_scope = Column(String(200), default="")
    output_folder    = Column(String(500), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    keywords = relationship("Keyword", back_populates="project", cascade="all, delete-orphan")
    records  = relationship("Record",  back_populates="project", cascade="all, delete-orphan")


class Keyword(Base):
    __tablename__ = "keywords"

    id                = Column(String, primary_key=True, default=_uuid)
    project_id        = Column(String, ForeignKey("projects.id"), nullable=False)
    keyword           = Column(String(200), nullable=False)
    type              = Column(String(50), default="llm_generated")   # llm_generated | human_added
    accepted          = Column(Boolean, nullable=True)
    reason            = Column(Text, nullable=True)
    languages         = Column(String(200), nullable=True)
    reviewer_decision = Column(String(20), nullable=True)   # accept | reject
    created_at        = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="keywords")


class Record(Base):
    """
    A single piece of content to annotate.

    world_data_* and lang are filled by the LLM re-analysis pass
    (run once per full dataset) and arrive as extra CSV columns on import:
      world_continent, world_country, world_region, world_city, lang
    """
    __tablename__ = "records"

    id                      = Column(String, primary_key=True, default=_uuid)
    project_id              = Column(String, ForeignKey("projects.id"), nullable=False)
    external_id             = Column(String(200), nullable=True)
    content                 = Column(Text, nullable=False)
    platform                = Column(String(50), nullable=True)
    tipo                    = Column(String(50), nullable=True)
    fecha                   = Column(String(30), nullable=True)
    fuente                  = Column(String(200), nullable=True)
    usuario                 = Column(String(200), nullable=True)   # nombre de usuario real del autor
    id_anonimo              = Column(String(100), nullable=True)   # id anonimizado del autor (generado aguas arriba)
    titulo_padre            = Column(Text, nullable=True)
    cuerpo_padre            = Column(Text, nullable=True)
    descripcion_padre       = Column(Text, nullable=True)
    tweet_anterior          = Column(Text, nullable=True)
    # idioma               = Column(String(50), nullable=True)   # legacy field, kept for compatibility
    relevancia_ia    = Column(String(5),   nullable=True)   # "SI" / "NO" del filtro LLM
    model_reasoning  = Column(Text,        nullable=True)   # cadena de razonamiento del LLM
    # ── New: language + geolocation produced by the LLM pass ──────────────
    lang             = Column(String(10),  nullable=True)   # e.g. "es", "en", "pt"
    world_continent  = Column(String(50),  nullable=True)
    world_country    = Column(String(80),  nullable=True)
    world_region     = Column(String(80),  nullable=True)
    world_city       = Column(String(80),  nullable=True)

    # ── URL directa al post/comentario original ───────────────────────────────
    url_post = Column(String(500), nullable=True)  # URL directa al post en la plataforma

    # ── Campos de análisis LLM con justificaciones ───────────────────────────
    # Pertinencia
    pertinencia        = Column(String(20), nullable=True)   # "relevante" | "irrelevante"
    justif_pertinencia = Column(Text, nullable=True)

    # Posición
    posicion           = Column(String(20), nullable=True)   # "a_favor" | "en_contra" | "neutral" | "ambiguo"
    justif_posicion    = Column(Text, nullable=True)

    sentiment_llm           = Column(Integer, nullable=True)
    justif_sentimiento = Column(Text, nullable=True)
    topic_llm                = Column(String(200), nullable=True)
    justif_topic   = Column(Text, nullable=True)
    legitimacion             = Column(Integer, nullable=True)
    efectividad              = Column(Integer, nullable=True)
    justicia_equidad         = Column(Integer, nullable=True)
    confianza_institucional  = Column(Integer, nullable=True)

    justif_legitimacion             = Column(Text, nullable=True)
    justif_efectividad              = Column(Text, nullable=True)
    justif_justicia_equidad         = Column(Text, nullable=True)
    justif_confianza_institucional  = Column(Text, nullable=True)

    # Justificaciones de geolocalización (world_* ya existen)
    justif_lang        = Column(Text, nullable=True)
    justif_continente  = Column(Text, nullable=True)
    justif_pais        = Column(Text, nullable=True)
    justif_region      = Column(Text, nullable=True)
    justif_ciudad      = Column(Text, nullable=True)
    # codigo_pais        = Column(String(2), nullable=True)    # ISO 3166-1 alpha-2



    # status: pending | annotated_partial | annotated | judged
    status     = Column(String(30), default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    project     = relationship("Project",    back_populates="records")
    annotations = relationship("Annotation", back_populates="record", cascade="all, delete-orphan")
    lock        = relationship("RecordLock", back_populates="record", uselist=False, cascade="all, delete-orphan")


class RecordLock(Base):
    """
    Pessimistic lock: only one user may annotate a record at a time.
    Lock expires after 30 minutes (checked server-side on every request).
    """
    __tablename__ = "record_locks"

    id         = Column(String, primary_key=True, default=_uuid)
    record_id  = Column(String, ForeignKey("records.id"), unique=True, nullable=False)
    user_id    = Column(String, ForeignKey("users.id"),   nullable=False)
    locked_at  = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    record = relationship("Record", back_populates="lock")
    user   = relationship("User",   back_populates="locks")


class Annotation(Base):
    """
    Stores every human annotation.
    annotation_type: 'sentiment' | 'pilar' | 'keyword'
    """
    __tablename__ = "annotations"

    id              = Column(String, primary_key=True, default=_uuid)
    record_id       = Column(String, ForeignKey("records.id"), nullable=False)
    project_id      = Column(String, ForeignKey("projects.id"), nullable=False)
    annotator_id    = Column(String, ForeignKey("users.id"),    nullable=False)
    annotation_type = Column(String(20), nullable=False)   # sentiment | pilar | keyword

    # Sentiment fields
    original_sentiment  = Column(Integer, nullable=True)
    corrected_sentiment = Column(Integer, nullable=True)
    original_topic       = Column(String(200), nullable=True)
    corrected_topic       = Column(String(200), nullable=True)
    topic_reason          = Column(Text, nullable=True)

    # Pilar fields
    pilar          = Column(String(50), nullable=True)
    original_value  = Column(Integer, nullable=True)
    corrected_value = Column(Integer, nullable=True)

    # Campos genéricos para anotar cualquier atributo de texto del Record
    # que no tiene columnas dedicadas (posicion, lang, world_*)
    field_name     = Column(String(50), nullable=True)   # "posicion" | "lang" | "world_country" | ...
    original_text  = Column(Text, nullable=True)
    corrected_text = Column(Text, nullable=True)

    # Common
    is_correction     = Column(Boolean, default=False)
    correction_reason = Column(Text, nullable=True)   # motivo del ANOTADOR
    reviewer_decision = Column(String(20), nullable=True)  # accept | reject
    judge_final_value = Column(Integer, nullable=True)
    judge_final_text  = Column(Text, nullable=True)  # decisión del juez cuando el campo es de texto
    judge_reason      = Column(Text, nullable=True)  # motivo del JUEZ (separado del del anotador)

    version    = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    annotator = relationship("User",   back_populates="annotations", foreign_keys=[annotator_id])
    record    = relationship("Record", back_populates="annotations")