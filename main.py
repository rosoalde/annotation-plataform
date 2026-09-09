"""
LoRA Annotation Platform — FastAPI backend v3.1
New in this version:
  - User approval workflow (self-register → pending → admin approves)
  - Records carry world_data (continent/country/region/city) + lang,
    produced by the LLM re-analysis pass and imported as CSV columns
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.database import engine, Base
from backend.app.routers import auth, admin, projects, records, annotations, review, judge
from pathlib import Path
from sqlalchemy import inspect, text

import logging

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="LoRA Annotation Platform", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _sync_missing_columns(sync_conn):
    inspector = inspect(sync_conn)
    for table in Base.metadata.sorted_tables:
        existing = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                ddl_type = col.type.compile(dialect=sync_conn.dialect)
                sync_conn.execute(text(
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}'
                ))
        # Detectar columnas obsoletas (en BD pero ya no en el modelo)
        model_col_names = {c.name for c in table.columns}
        for col in inspector.get_columns(table.name):
            if col["name"] not in model_col_names:
                logger.warning(
                    "Columna obsoleta en '%s': '%s' existe en la BD pero no en el modelo.",
                    table.name,
                    col["name"],

                )
                print(
                    f"[ACCIÓN REQUERIDA] Para eliminar la columna obsoleta ejecuta en psql:\n"
                    f'  ALTER TABLE "{table.name}" DROP COLUMN IF EXISTS "{col["name"]}";',
                    flush=True,
                )

def _migrate_renamed_columns(sync_conn):
    """Copia datos de columnas/valores renombrados a su nuevo nombre.
    Idempotente: en arranques posteriores las condiciones WHERE ya no
    se cumplen, así que no hace nada."""
    inspector = inspect(sync_conn)
    cols = {c["name"] for c in inspector.get_columns("records")}
    if "posicion" in cols and "postura" in cols:
        sync_conn.execute(text(
            "UPDATE records SET postura = posicion "
            "WHERE postura IS NULL AND posicion IS NOT NULL"
        ))
    if "justif_posicion" in cols and "justif_postura" in cols:
        sync_conn.execute(text(
            "UPDATE records SET justif_postura = justif_posicion "
            "WHERE justif_postura IS NULL AND justif_posicion IS NOT NULL"
        ))
    sync_conn.execute(text(
        "UPDATE annotations SET field_name = 'postura' WHERE field_name = 'posicion'"
    ))

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_sync_missing_columns)
        await conn.run_sync(_migrate_renamed_columns)

app.include_router(auth.router,        prefix="/api/auth")
app.include_router(admin.router,       prefix="/api/admin")
app.include_router(projects.router,    prefix="/api/projects")
app.include_router(records.router,     prefix="/api/projects")
app.include_router(annotations.router, prefix="/api/projects")
app.include_router(review.router,      prefix="/api")
app.include_router(judge.router,       prefix="/api/judge")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "3.1.0"}

# @app.get("/")
# async def root():
#     return FileResponse("frontend/index.html")