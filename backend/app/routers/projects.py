from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.app.core.database import get_db
from backend.app.core.security import get_current_user, require_role
from backend.app.models.models import User, Project, Record, Annotation
from backend.app.schemas.schemas import ProjectCreate, ProjectOut, ProjectStats

router = APIRouter(tags=["projects"])


@router.get("", response_model=List[ProjectOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    projects = result.scalars().all()
    return [
        ProjectOut(
            id=p.id, name=p.name, tema=p.tema, desc_tema=p.desc_tema,
            population_scope=p.population_scope, output_folder=p.output_folder,
            created_at=p.created_at, keywords=[],
        )
        for p in projects
    ]


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result  = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    return ProjectOut(
        id=project.id, name=project.name, tema=project.tema,
        desc_tema=project.desc_tema, population_scope=project.population_scope,
        output_folder=project.output_folder, created_at=project.created_at, keywords=[]
    )


@router.post("", response_model=ProjectOut)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "reviewer")),
):
    project = Project(**body.dict())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectOut(
        id=project.id, name=project.name, tema=project.tema,
        desc_tema=project.desc_tema, population_scope=project.population_scope,
        output_folder=project.output_folder, created_at=project.created_at, keywords=[]
    )


@router.get("/{project_id}/stats", response_model=ProjectStats)
async def project_stats(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    totals = {}
    for st in ("pending", "annotated_partial", "annotated", "judged"):
        r = await db.execute(
            select(func.count(Record.id)).where(Record.project_id == project_id, Record.status == st)
        )
        totals[st] = r.scalar() or 0

    total_records = sum(totals.values())

    ann_r  = await db.execute(select(func.count(Annotation.id)).where(Annotation.project_id == project_id))
    corr_r = await db.execute(
        select(func.count(Annotation.id)).where(
            Annotation.project_id == project_id, Annotation.is_correction == True
        )
    )

    return ProjectStats(
        total_records=total_records,
        pending=totals["pending"], annotated_partial=totals["annotated_partial"],
        annotated=totals["annotated"], judged=totals["judged"],
        total_annotations=ann_r.scalar() or 0, total_corrections=corr_r.scalar() or 0,
    )