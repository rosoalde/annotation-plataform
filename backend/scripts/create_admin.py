"""
Bootstrap script — creates the FIRST admin user directly in the database.

Why this is needed:
  With the new approval workflow, every self-registered user starts as
  "pending" and needs an admin to approve them. But to approve anyone,
  an admin must already exist. This script creates that first admin,
  bypassing the API (since the API has no admin yet to approve via).

Usage (from backend/ folder, with venv activated and DATABASE_URL set):
    python -m scripts.create_admin --username admin --email admin@example.com --password admin1234
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from backend.app.core.database import AsyncSessionLocal, engine, Base
from backend.app.core.security import hash_password
from backend.app.models.models import User


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    # Ensure tables exist (normally created by the app on startup, but
    # this script can run before the app has ever started).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(User).where(User.username == args.username))
        if existing.scalar_one_or_none():
            print(f"⚠ El usuario '{args.username}' ya existe. Nada que hacer.")
            return

        admin = User(
            username  = args.username,
            email     = args.email,
            hashed_pw = hash_password(args.password),
            role      = "admin",
            status    = "approved",   # bootstrap admin is pre-approved
        )
        db.add(admin)
        await db.commit()
        print(f"✓ Admin '{args.username}' creado y aprobado. Ya puedes iniciar sesión.")


if __name__ == "__main__":
    asyncio.run(main())