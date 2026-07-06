# Guía completa — Plataforma de Etiquetado v3.1

## 0. Resumen del chequeo

✅ De tus 22 archivos, **20 ya estaban correctos** (solo necesitan moverse de carpeta).
❌ Faltaban **2 archivos de frontend** (`ReviewView.tsx`, `JudgeView.tsx`) y **todos los
archivos de configuración/arranque** (nadie te los había pasado todavía como archivos
sueltos). Todo eso está generado más abajo y adjunto en esta respuesta.

⚠️ Un archivo necesita **renombrarse**: `annotation.py` → `annotations.py`
(el código de `main.py` importa el módulo como `annotations`, en plural).

---

## 1. Qué hace cada parte del sistema

### Backend (FastAPI + PostgreSQL)

| Archivo | Qué hace |
|---|---|
| `app/main.py` | Punto de entrada. Crea la app FastAPI, registra todos los routers, crea las tablas en PostgreSQL al arrancar. |
| `app/core/database.py` | Configura la conexión a PostgreSQL (SQLAlchemy async) y la función `get_db()` que usan todos los endpoints. |
| `app/core/security.py` | Todo lo de JWT: hashear contraseñas (bcrypt), crear/verificar tokens, y la función `get_current_user()` que **bloquea a cualquier usuario cuyo `status` no sea `"approved"`** — esta es la pieza clave de tu requisito de aprobación manual. |
| `app/models/models.py` | Las tablas de la base de datos: `User` (con `email`, `status`: pending/approved/rejected), `Project`, `Record` (ahora con `lang`, `world_continent`, `world_country`, `world_region`, `world_city`), `RecordLock`, `Annotation`, `Keyword`. |
| `app/schemas/schemas.py` | Los "moldes" de validación (Pydantic) para cada petición/respuesta de la API. |
| `app/routers/auth.py` | `POST /auth/register` (crea cuenta en estado `pending`, **sin token**) y `POST /auth/login` (rechaza con 403 si el usuario sigue pendiente o fue rechazado). |
| `app/routers/admin.py` | **Nuevo.** `GET /admin/users/pending` (lista solicitudes), `POST /admin/users/{id}/decision` (aprobar/rechazar y asignar rol), `GET /admin/users` (lista completa). |
| `app/routers/projects.py` | CRUD de proyectos y estadísticas. |
| `app/routers/records.py` | Listado de registros con paginación, **lock pesimista** (`POST/DELETE .../lock`) para evitar que dos anotadores editen el mismo registro a la vez, e importación masiva desde CSV. |
| `app/routers/annotations.py` | Guarda anotaciones de sentimiento/pilares/keywords; libera el lock automáticamente al guardar. |
| `app/routers/review.py` | Para el rol `reviewer`: ver correcciones pendientes y aceptarlas/rechazarlas. |
| `app/routers/judge.py` | Para el rol `judge`: ver registros anotados por 2 personas distintas y decidir la etiqueta final; exportar a JSONL/CSV para fine-tuning. |
| `scripts/create_admin.py` | Script de arranque en frío: crea el **primer admin** directamente en la base de datos (necesario porque nadie puede aprobar al primer usuario si no existe ya un admin). |

### Frontend (React + TypeScript + Vite)

| Archivo | Qué hace |
|---|---|
| `src/main.tsx` | Define las rutas de la app (`react-router-dom`) y envuelve todo en el `QueryClientProvider`. |
| `src/index.css` | Variables de color y estilos base (tema oscuro). |
| `src/types/index.ts` | Todos los tipos TypeScript compartidos (`Record`, `Project`, `AuthUser`, etc.), incluyendo los nuevos `lang`/`world_*`. |
| `src/stores/authStore.ts` | Estado global (Zustand) con el token JWT y el usuario logueado; persiste en `localStorage`. |
| `src/services/api.ts` | Cliente Axios centralizado: añade el JWT a cada petición, convierte errores 409 (lock) y 403 (cuenta pendiente) en errores tipados (`LockConflictError`, `AccountPendingError`). |
| `src/components/Layout.tsx` | El "esqueleto" de la app: barra lateral con navegación que cambia según el rol del usuario. |
| `src/components/ProtectedRoute.tsx` | Redirige a `/login` si no hay token; `AdminRoute` además bloquea el acceso a `/admin` si el rol no es `admin`. |
| `src/views/LoginView.tsx` | Login + registro. Al registrarse, **no inicia sesión automáticamente** — muestra el mensaje "cuenta pendiente de aprobación". |
| `src/views/AdminView.tsx` | **Nuevo.** Panel donde el admin ve las solicitudes pendientes, elige el rol final, y aprueba/rechaza. También lista todos los usuarios y permite cambiarles el rol. |
| `src/views/ProjectsView.tsx` | Lista de proyectos disponibles. |
| `src/views/SentimentView.tsx` | Pantalla de anotación de sentimiento: lock antes de anotar, badges de `lang`/país, progreso. |
| `src/views/PilarsView.tsx` | Igual pero para los 4 pilares de aceptación política. |
| `src/views/ReviewView.tsx` | Pantalla del revisor: acepta/rechaza correcciones de los anotadores. |
| `src/views/JudgeView.tsx` | Pantalla del juez: compara las anotaciones de los dos anotadores + el LLM, y decide el valor final. |

---

## 2. Flujo de aprobación de anotadores (tu requisito nuevo)

```
1. Usuario va a /login → pestaña "Registrarse"
2. Rellena username + email + password + rol deseado
3. POST /auth/register → se crea con status="pending"
   → NO recibe token, ve: "Cuenta creada. Un administrador debe aprobarla..."
4. Usuario intenta loguearse antes de ser aprobado
   → 403 "Tu cuenta está pendiente de aprobación por un administrador."
5. Un admin entra a /admin
   → ve la solicitud, puede cambiar el rol propuesto, pulsa "Aprobar"
   → POST /admin/users/{id}/decision {"decision":"approve","role":"annotator"}
6. Ahora el usuario SÍ puede loguearse y usar la plataforma
```

⚠️ **El primer admin no puede crearse así** (no hay nadie que lo apruebe).
Para eso está `scripts/create_admin.py` — se ejecuta una sola vez, directo
contra la base de datos, sin pasar por la API.

---

## 3. Cómo reorganizar tus archivos actuales

Tienes dos opciones:

### Opción A — Script automático (recomendado)

Adjunto `reorganize.sh`. Cópialo dentro de tu carpeta actual y ejecútalo:

```bash
cd /home/romina/annotation-plataform
# sube/copia aquí reorganize.sh
bash reorganize.sh
```

Esto **copia** (no mueve) tus 22 archivos a una carpeta nueva `../annotation-platform/`
con la estructura correcta, y al final te dice exactamente qué archivos nuevos
te siguen faltando (que son los que te adjunto en esta respuesta).

### Opción B — Manual

```
annotation-platform/                      ← carpeta raíz nueva
│
├── docker-compose.yml                    ← NUEVO, adjunto
│
├── backend/
│   ├── Dockerfile                        ← NUEVO, adjunto
│   ├── requirements.txt                  ← NUEVO, adjunto
│   └── app/
│       ├── __init__.py                   ← NUEVO (vacío)
│       ├── main.py                       ← tu main.py
│       │
│       ├── core/
│       │   ├── __init__.py               ← NUEVO (vacío)
│       │   ├── database.py                ← NUEVO, adjunto
│       │   └── security.py                 ← NUEVO, adjunto
│       │
│       ├── models/
│       │   ├── __init__.py                ← NUEVO (vacío)
│       │   └── models.py                   ← NUEVO, adjunto
│       │
│       ├── schemas/
│       │   ├── __init__.py                ← NUEVO (vacío)
│       │   └── schemas.py                  ← tu schemas.py
│       │
│       └── routers/
│           ├── __init__.py                ← NUEVO (vacío)
│           ├── admin.py                    ← tu admin.py
│           ├── auth.py                     ← tu auth.py
│           ├── projects.py                 ← tu projects.py
│           ├── records.py                  ← tu records.py
│           ├── annotations.py              ← tu annotation.py RENOMBRADO
│           ├── review.py                   ← tu review.py
│           └── judge.py                    ← tu judge.py
│   └── scripts/
│       ├── __init__.py                    ← NUEVO (vacío)
│       └── create_admin.py                 ← tu create_admin.py
│
└── frontend/
    ├── Dockerfile                         ← NUEVO, adjunto
    ├── package.json                       ← NUEVO, adjunto
    ├── tsconfig.json                      ← NUEVO, adjunto
    ├── vite.config.ts                     ← NUEVO, adjunto
    ├── index.html                         ← NUEVO, adjunto
    └── src/
        ├── main.tsx                       ← tu main.tsx
        ├── index.css                      ← tu index.css
        │
        ├── types/
        │   └── index.ts                   ← tu index.ts
        ├── stores/
        │   └── authStore.ts                ← tu authStore.ts
        ├── services/
        │   └── api.ts                      ← tu api.ts
        ├── components/
        │   ├── Layout.tsx                   ← tu Layout.tsx
        │   └── ProtectedRoute.tsx            ← tu Protectedroute.tsx RENOMBRADO
        └── views/
            ├── LoginView.tsx                ← tu LoginView.tsx
            ├── ProjectsView.tsx               ← tu Projectsview.tsx RENOMBRADO
            ├── SentimentView.tsx              ← tu SentimentView.tsx
            ├── PilarsView.tsx                ← tu Pilarsview.tsx RENOMBRADO
            ├── AdminView.tsx                  ← tu Adminview.tsx RENOMBRADO
            ├── ReviewView.tsx                 ← NUEVO, adjunto
            └── JudgeView.tsx                  ← NUEVO, adjunto
```

> 💡 En Linux/Mac los nombres de archivo distinguen mayúsculas/minúsculas, así que
> `Protectedroute.tsx` y `ProtectedRoute.tsx` son técnicamente archivos distintos.
> Asegúrate de que el nombre final coincida exactamente con los `import` del código
> (todos los imports en este proyecto usan PascalCase: `ProtectedRoute`, `ProjectsView`, etc.)

---

## 4. Cómo levantar el sistema

### Requisito previo: crear el primer admin

Antes de nada, necesitas un admin para poder aprobar a los demás.

**A) Con Docker (después de levantar los contenedores, ver abajo):**
```bash
docker compose exec backend python -m backend.scripts.create_admin \
  --username admin --email romina.albornoz@uv.es --password 
```

**B) Sin Docker (entorno local):**
```bash
cd backend
source venv/bin/activate
python -m scripts.create_admin --username admin --email admin@tuempresa.com --password admin1234
```

### Opción A — Docker Compose (recomendado)

```bash
cd annotation-platform
docker compose up --build
```

- Frontend: http://147.156.152.30:5173
- Backend / Swagger docs: http://147.156.152.30:8007/docs
- PostgreSQL: localhost:5432

Para parar:
```bash
docker compose down          # detiene contenedores
docker compose down -v       # detiene Y borra la base de datos
```

### Opción B — Sin Docker

```bash
# 1. Base de datos
createdb annotation_db

# 2. Backend
cd annotation-platform/backend
python -m venv venv
source venv/bin/activate              # Windows: venv\Scripts\activate
pip install -r requirements.txt

export DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/annotation_db"
export SECRET_KEY="cambia-esto-por-32-caracteres-min"

uvicorn app.main:app --host 0.0.0.0 --port 8007 --reload
# → crea las tablas automáticamente al arrancar

# (en otra terminal, con el venv activado) crea el primer admin:
python -m scripts.create_admin --username admin --email admin@tuempresa.com --password admin1234

# 3. Frontend
cd annotation-platform/frontend
npm install
echo "VITE_API_URL=http://localhost:8007/api" > .env.local
npm run dev
# → http://localhost:5173
```

---

## 5. Flujo de uso completo, de principio a fin

```
1. Admin inicia sesión en /login
2. Crea un proyecto:
   POST /api/projects {"name": "...", "tema": "...", ...}
3. Admin importa los registros (con lang/world_data ya calculados por el LLM):
   POST /api/projects/{id}/records/import  [{...}, {...}, ...]
4. Anotadores se registran en /login → quedan "pending"
5. Admin entra a /admin → aprueba cada uno, asignando rol
6. Anotador A y B anotan en paralelo:
   - Si ambos intentan el mismo registro → el segundo recibe 409
   - Cada guardado libera el lock automáticamente
7. Cuando 2 anotadores distintos han anotado un registro → status: annotated
8. Reviewer revisa correcciones marcadas como is_correction=true
9. Judge entra a /judge → ve LLM + Anotador A + Anotador B → decide valor final
10. Judge exporta JSONL/CSV para fine-tuning del LoRA
```

---

## 6. Script de importación CSV (con lang/world_data)

```python
# import_csv.py
import csv, requests

TOKEN      = "token_del_admin"
PROJECT_ID = "id_del_proyecto"
CSV_PATH   = "dataset_reanalizado.csv"

headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

items = []
with open(CSV_PATH, encoding="utf-8") as f:
    for row in csv.DictReader(f, delimiter=";"):
        items.append({
            "content":         row.get("contenido", ""),
            "platform":        row.get("plataforma", ""),
            "tipo":            row.get("tipo", "POST"),
            "fecha":           row.get("fecha", ""),
            "sentiment_llm":   int(row["sentimiento"]) if row.get("sentimiento") else None,
            "topic_llm":       row.get("topic", ""),
            "lang":            row.get("lang", ""),
            "world_continent": row.get("world_continent", ""),
            "world_country":   row.get("world_country", ""),
            "world_region":    row.get("world_region", ""),
            "world_city":      row.get("world_city", ""),
            "legitimacion":            int(row["legitimacion"]) if row.get("legitimacion") else None,
            "efectividad":             int(row["efectividad"]) if row.get("efectividad") else None,
            "justicia_equidad":        int(row["justicia_equidad"]) if row.get("justicia_equidad") else None,
            "confianza_institucional": int(row["confianza_institucional"]) if row.get("confianza_institucional") else None,
        })

for i in range(0, len(items), 500):
    batch = items[i:i+500]
    r = requests.post(
        f"http://localhost:8007/api/projects/{PROJECT_ID}/records/import",
        headers=headers, json=batch
    )
    print(r.json())
```

Es decir: cuando relances el LLM sobre cada dataset completo, asegúrate de que
el CSV de salida tenga columnas `lang`, `world_continent`, `world_country`,
`world_region`, `world_city` — el script las recoge tal cual.

---

## 7. Checklist final

| Categoría | Archivo | Estado |
|---|---|---|
| Backend | `main.py`, `database.py`, `security.py`, `models.py`, `schemas.py` | ✅ adjuntos |
| Backend | `auth.py`, `admin.py`, `projects.py`, `records.py`, `annotations.py`, `review.py`, `judge.py` | ✅ adjuntos |
| Backend | `create_admin.py`, `requirements.txt`, `Dockerfile` | ✅ adjuntos |
| Frontend | `main.tsx`, `index.css`, `index.ts` (types) | ✅ adjuntos |
| Frontend | `authStore.ts`, `api.ts` | ✅ adjuntos |
| Frontend | `Layout.tsx`, `ProtectedRoute.tsx` | ✅ adjuntos |
| Frontend | `LoginView`, `ProjectsView`, `SentimentView`, `PilarsView`, `AdminView` | ✅ adjuntos |
| Frontend | **`ReviewView.tsx`, `JudgeView.tsx`** | ✅ **generados ahora, antes faltaban** |
| Frontend | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `Dockerfile` | ✅ **generados ahora, antes faltaban** |
| Raíz | `docker-compose.yml` | ✅ **generado ahora, antes faltaba** |
| Raíz | `reorganize.sh` (script de ayuda) | ✅ generado para ti |

**No falta nada más.** Con estos archivos + tus 20 archivos ya correctos, el
sistema está completo y listo para `docker compose up --build -d`.