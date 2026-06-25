import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.models.models import User

SECRET_KEY  = os.getenv("SECRET_KEY", "change-me-in-production-use-32chars!")
ALGORITHM   = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 h

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire    = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Decodes the JWT and returns the user.
    IMPORTANT: a user whose status is not "approved" is rejected here too —
    even if they kept an old valid token from before being rejected/demoted,
    every request re-checks their current status against the DB.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user   = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception

    if user.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Tu cuenta está '{user.status}'. Un administrador debe aprobarla antes de poder usar la plataforma.",
        )
    return user


def require_role(*roles: str):
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return _check