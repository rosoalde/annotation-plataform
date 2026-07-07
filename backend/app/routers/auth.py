"""
Auth router.

Registration flow (new):
  1. User submits username + email + password + desired role.
  2. Account is created with status="pending".
  3. NO TOKEN is returned — a pending user cannot use the API yet.
  4. An admin must approve them via /api/admin/users/{id}/decision.
  5. Only after approval can the user log in and receive a JWT.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from backend.app.core.database import get_db
from backend.app.core.security import hash_password, verify_password, create_access_token, get_current_user
from backend.app.models.models import User
from backend.app.schemas.schemas import ChangePasswordRequest, RegisterRequest, RegisterResponse, LoginRequest, TokenResponse

router = APIRouter(tags=["auth"])


@router.post("/register", response_model=RegisterResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where(or_(User.username == body.username, User.email == body.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Usuario o email ya registrados")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    if body.role not in ("annotator", "reviewer", "judge", "admin"):
        raise HTTPException(status_code=400, detail="Rol inválido")

    user = User(
        username  = body.username,
        email     = body.email,
        hashed_pw = hash_password(body.password),
        role      = body.role,
        status    = "pending",   # ← always pending on self-registration
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return RegisterResponse(
        id=user.id, username=user.username, email=user.email,
        role=user.role, status=user.status,
        message="Cuenta creada. Un administrador debe aprobarla antes de que puedas iniciar sesión.",
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user   = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_pw):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
        )

    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta está pendiente de aprobación por un administrador.",
        )
    if user.status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu solicitud de acceso fue rechazada. Contacta con el administrador.",
        )

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token, user_id=user.id, username=user.username,
        role=user.role, status=user.status, must_change_password=bool(user.must_change_password),
    )


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id, "username": current_user.username,
        "email": current_user.email, "role": current_user.role,
        "status": current_user.status,
        "must_change_password": bool(current_user.must_change_password),
    }

@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.hashed_pw):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")

    current_user.hashed_pw = hash_password(body.new_password)
    current_user.must_change_password = False
    await db.commit()
    return {"ok": True}