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

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_sync_missing_columns)

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