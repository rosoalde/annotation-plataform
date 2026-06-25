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

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="LoRA Annotation Platform", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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

@app.get("/")
async def root():
    return FileResponse("frontend/index.html")