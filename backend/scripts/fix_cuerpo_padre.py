"""
fix_cuerpo_padre.py
Actualiza cuerpo_padre en los registros COMENTARIO que lo tienen vacío,
leyendo el contenido del post raíz directamente del CSV original.

Uso:
    python fix_cuerpo_padre.py /ruta/al/archivo.csv <project_id>
"""
import sys
import csv
import asyncio
from pathlib import Path

# ── Ajusta estas variables si la ruta de BD es diferente ──────────────────
DATABASE_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/annotation_db"


async def main(csv_path: str, project_id: str):
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select, update, text

    engine = create_async_engine(DATABASE_URL, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 1. Leer CSV y construir lookups  uri→contenido  e  id_raiz(POST)→contenido
    sep = ";"
    with open(csv_path, encoding="utf-8-sig") as f:
        sample = f.read(1024)
    if ";" in sample:
        sep = ";"
    elif "," in sample:
        sep = ","

    uri_to_content: dict[str, str] = {}   # Bluesky: uri propio → contenido
    id_to_content: dict[str, str] = {}    # Reddit: id_raiz (POST) → contenido
    rows = []

    with open(csv_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=sep)
        for row in reader:
            rows.append(row)
            def sv(k): return str(row.get(k) or "").strip()
            uri = sv("uri")
            contenido = sv("contenido")
            if uri and contenido:
                uri_to_content[uri] = contenido
            if sv("tipo").upper() == "POST":
                for k in ("id_raiz", "id_propio"):
                    rid = sv(k)
                    if rid and contenido:
                        id_to_content[rid] = contenido

    # 2. Construir mapa url_post (comment's uri) → parent content
    url_to_parent: dict[str, str] = {}
    for row in rows:
        def sv(k): return str(row.get(k) or "").strip()
        if sv("tipo").upper() != "COMENTARIO":
            continue
        own_uri    = sv("uri")
        parent_uri = sv("parent_uri")
        id_raiz    = sv("id_raiz")
        parent_content = ""
        if parent_uri and parent_uri in uri_to_content:
            parent_content = uri_to_content[parent_uri]
        if not parent_content and id_raiz and id_raiz in id_to_content:
            parent_content = id_to_content[id_raiz]
        if own_uri and parent_content:
            url_to_parent[own_uri] = parent_content

    print(f"Posts raíz encontrados: {len(url_to_parent)}")

    # 3. Actualizar registros en la BD
    updated = 0
    async with Session() as db:
        # Traer todos los COMENTARIO del proyecto sin cuerpo_padre
        result = await db.execute(
            text("""
                SELECT id, url_post
                FROM records
                WHERE project_id = :pid
                  AND tipo = 'COMENTARIO'
                  AND (cuerpo_padre IS NULL OR cuerpo_padre = '')
            """),
            {"pid": project_id}
        )
        to_fix = result.fetchall()
        print(f"Registros COMENTARIO sin cuerpo_padre: {len(to_fix)}")

        for rec_id, url_post in to_fix:
            parent_body = url_to_parent.get(url_post or "")
            if parent_body:
                await db.execute(
                    text("UPDATE records SET cuerpo_padre = :body WHERE id = :rid"),
                    {"body": parent_body, "rid": rec_id}
                )
                updated += 1

        await db.commit()

    print(f"Registros actualizados: {updated}")
    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Uso: python fix_cuerpo_padre.py <ruta_csv> <project_id>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2]))