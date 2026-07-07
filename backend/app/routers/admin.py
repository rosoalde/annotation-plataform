"""
Admin router — user approval workflow.

Only users with role="admin" can list pending registrations and
approve/reject them. The very first admin must be created with the
bootstrap script (see scripts/create_admin.py) since there is no
admin yet to approve anyone.
"""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.core.security import require_role, hash_password, generate_temp_password
from backend.app.models.models import User
from backend.app.schemas.schemas import PendingUserOut, UserApprovalDecision, UserOut, AdminPasswordReset

router = APIRouter(tags=["admin"])


@router.get("/users/pending", response_model=List[PendingUserOut])
async def list_pending_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(
        select(User).where(User.status == "pending").order_by(User.created_at)
    )
    return result.scalars().all()


@router.get("/users", response_model=List[UserOut])
async def list_all_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.post("/users/{user_id}/decision")
async def decide_user(
    user_id: str,
    body: UserApprovalDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision debe ser 'approve' o 'reject'")

    result = await db.execute(select(User).where(User.id == user_id))
    user   = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    if body.decision == "approve":
        user.status      = "approved"
        user.approved_by = current_user.id
        user.approved_at = datetime.utcnow()
        if body.role:   # admin can override the role the user requested
            if body.role not in ("annotator", "reviewer", "judge", "admin"):
                raise HTTPException(400, "Rol inválido")
            user.role = body.role
    else:
        user.status = "rejected"

    await db.commit()
    return {"ok": True, "user_id": user.id, "status": user.status, "role": user.role}

@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    body: AdminPasswordReset,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user   = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    new_password = body.new_password or generate_temp_password()
    if len(new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")

    user.hashed_pw = hash_password(new_password)
    user.must_change_password = True
    await db.commit()
    return {"ok": True, "user_id": user.id, "temp_password": new_password}
@router.post("/users/{user_id}/role")
async def change_role(
    user_id: str,
    role: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Change an already-approved user's role at any time."""
    if role not in ("annotator", "reviewer", "judge", "admin"):
        raise HTTPException(400, "Rol inválido")

    result = await db.execute(select(User).where(User.id == user_id))
    user   = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    user.role = role
    await db.commit()
    return {"ok": True, "user_id": user.id, "role": user.role}