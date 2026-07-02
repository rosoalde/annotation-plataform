# Guía del repositorio — Plataforma de Etiquetado

> Generada el 2 Jul 2026 revisando el código real de cada archivo.  
> Para alguien que no conoce la plataforma: aquí encontrará exactamente qué hace cada archivo y dónde buscar cuando quiere cambiar algo.

---

## Árbol completo

```
annotation-plataform/
│
├── main.py                          ← PUNTO DE ENTRADA del servidor
├── Dockerfile                       ← imagen Docker del backend
├── docker-compose.yml               ← levanta DB + backend + frontend juntos
├── diagnostico_csv.py               ← script de diagnóstico local para CSVs
├── sample_import.csv                ← CSV de ejemplo para probar la importación
├── guia.md                          ← guía anterior (menos detallada que esta)
├── guia_tablas_inspeccion.md        ← referencia SQL de las tablas
│
├── backend/
│   ├── requirements.txt             ← dependencias Python
│   ├── Dockerfile                   ← (no usado actualmente, el raíz sí)
│   ├── __init__.py
│   │
│   ├── app/
│   │   ├── __init__.py
│   │   │
│   │   ├── core/
│   │   │   ├── database.py          ← conexión a PostgreSQL
│   │   │   └── security.py          ← JWT, contraseñas, permisos
│   │   │
│   │   ├── models/
│   │   │   └── models.py            ← tablas de la base de datos (ORM)
│   │   │
│   │   ├── schemas/
│   │   │   └── schemas.py           ← contratos de entrada/salida de la API
│   │   │
│   │   └── routers/
│   │       ├── auth.py              ← registro y login
│   │       ├── admin.py             ← aprobar/rechazar usuarios
│   │       ├── projects.py          ← CRUD de proyectos
│   │       ├── records.py           ← registros + importación CSV
│   │       ├── annotations.py       ← guardar anotaciones
│   │       ├── review.py            ← revisor acepta/rechaza correcciones
│   │       └── judge.py             ← juez decide + exporta LoRA
│   │
│   └── scripts/
│       └── create_admin.py          ← crea el primer admin (bootstrap)
│
└── frontend/
    ├── index.html                   ← entrada HTML (solo un <div id="root">)
    ├── package.json                 ← dependencias npm
    ├── tsconfig.json                ← configuración TypeScript
    ├── vite.config.ts               ← configuración Vite (proxy /api)
    ├── Dockerfile                   ← imagen Docker del frontend
    │
    └── src/
        ├── main.tsx                 ← rutas de la app (React Router)
        ├── index.css                ← variables CSS globales (colores, fuentes)
        │
        ├── types/
        │   └── index.ts             ← todos los tipos TypeScript compartidos
        │
        ├── stores/
        │   └── authStore.ts         ← estado global: token JWT + usuario
        │
        ├── services/
        │   └── api.ts               ← cliente HTTP (Axios) + todas las llamadas API
        │
        ├── components/
        │   ├── Layout.tsx           ← barra lateral + navegación
        │   ├── ProjectContextBar.tsx ← barra fija "Tema / Descripción / Ámbito"
        │   └── ProtectedRoute.tsx   ← redirige a /login si no hay token
        │
        └── views/
            ├── LoginView.tsx        ← login + registro
            ├── ProjectsView.tsx     ← lista de proyectos + crear proyecto
            ├── ImportView.tsx       ← importar CSV en 3 pasos
            ├── KeywordsView.tsx     ← gestionar términos de búsqueda
            ├── SentimentView.tsx    ← anotar sentimiento + topic
            ├── PillarsView.tsx      ← anotar 4 pilares de aceptación
            ├── ReviewView.tsx       ← revisar correcciones del equipo
            ├── JudgeView.tsx        ← decidir etiqueta final + exportar
            └── AdminView.tsx        ← aprobar/rechazar cuentas de usuario
```

---

## Archivos raíz

### `main.py`
El servidor FastAPI. Es el archivo que arranca `uvicorn`.  
**Qué hace:**
- Crea la aplicación FastAPI y configura CORS.
- Al arrancar, crea las tablas en PostgreSQL si no existen (`Base.metadata.create_all`).
- También ejecuta `_sync_missing_columns`: detecta columnas del modelo que no están en la BD y las añade automáticamente con `ALTER TABLE` — esto es lo que permite que añadir un campo en `models.py` sea suficiente sin necesidad de Alembic.
- Registra todos los routers bajo `/api/...`.

**¿Cuándo lo tocas?** Casi nunca. Solo si añades un router nuevo.

---

### `docker-compose.yml`
Define los 3 servicios para levantar todo con un comando:
- `db` — PostgreSQL 16, expone el puerto 5432 internamente, persiste datos en el volumen `pgdata`.
- `backend` — monta todo el repo como volumen, arranca con `uvicorn main:app --reload`.
- `frontend` — monta `./frontend`, arranca con `npm run dev`.

**Nota importante:** el backend monta la raíz del repo (`.:/app`), por eso los imports usan `from backend.app.core...` en lugar de `from app.core...`.

---

### `diagnostico_csv.py`
Script de 3 líneas para ejecutar en local y verificar que un CSV se parsea correctamente. Lee el `sample_import.csv` y muestra columnas detectadas y el valor de `content`.  
**Cómo usarlo:** `python diagnostico_csv.py` (ajusta la ruta del CSV si es necesario).

---

### `sample_import.csv`
CSV de 3 filas de ejemplo con todas las columnas que la plataforma acepta. Sirve para probar la importación sin datos reales. Las columnas incluyen `content`, `platform`, `tipo`, todos los campos de análisis LLM (`sentiment_llm`, `pertinencia`, `posicion`, `legitimacion`...) y sus justificaciones (`justif_sentimiento`, `justif_legitimacion`...).

---

## Backend

### `backend/requirements.txt`
Dependencias Python fijadas a versiones concretas. Las más importantes:
- `fastapi` + `uvicorn` — servidor web
- `sqlalchemy[asyncio]` + `asyncpg` — acceso async a PostgreSQL
- `passlib[bcrypt]` + `python-jose` — contraseñas y JWT
- `pydantic[email]` — validación (el `[email]` es necesario para el campo `EmailStr`)
- `python-multipart` — necesario para recibir archivos CSV (multipart/form-data)

---

### `backend/app/core/database.py`
Configura la conexión a PostgreSQL usando SQLAlchemy async.  
**Variables de entorno que lee:** `DATABASE_URL` (por defecto `postgresql+asyncpg://postgres:postgres@localhost:5432/annotation_db`).  
Exporta `engine`, `AsyncSessionLocal`, `Base`, y la función `get_db()` que todos los routers usan como dependencia para obtener una sesión de BD.

---

### `backend/app/core/security.py`
Todo lo relacionado con autenticación y autorización:
- `hash_password` / `verify_password` — bcrypt.
- `create_access_token` — genera un JWT con 24 h de validez.
- `get_current_user` — decodifica el JWT de cada petición y devuelve el usuario. **Bloquea** automáticamente a usuarios con `status != "approved"` (devuelve 403), aunque tengan un token válido.
- `require_role(*roles)` — decorador que restringe un endpoint a roles concretos.

**Variable de entorno:** `SECRET_KEY` (cámbiala en producción).

---

### `backend/app/models/models.py`
Define las 6 tablas de la base de datos como clases Python (ORM SQLAlchemy):

| Tabla | Propósito |
|---|---|
| `User` | Usuarios con `username`, `email`, `role` y `status` (pending/approved/rejected) |
| `Project` | Proyectos de anotación con `tema`, `desc_tema`, `population_scope` |
| `Keyword` | Términos de búsqueda asociados a un proyecto |
| `Record` | Posts/comentarios a anotar. Tiene ~40 columnas: contenido, contexto del post padre, todos los campos del LLM con sus justificaciones, `url_post`, `lang`, `world_*`, `codigo_pais` |
| `RecordLock` | Lock pesimista: solo un usuario puede anotar un registro a la vez (TTL 30 min) |
| `Annotation` | Todas las anotaciones humanas. Campos para sentimiento, pilares, keywords, y campos genéricos (`field_name`/`original_text`/`corrected_text`) para anotar cualquier atributo de texto |

**¿Cuándo lo tocas?** Cuando añades un campo nuevo a la BD. Después de añadirlo aquí, el servidor lo detecta y hace `ALTER TABLE` solo en el siguiente arranque (gracias a `_sync_missing_columns` en `main.py`).

---

### `backend/app/schemas/schemas.py`
Los "contratos" de la API: qué datos acepta cada endpoint y qué devuelve. En Pydantic.

Clases principales:
- `RegisterRequest` / `LoginRequest` / `TokenResponse` — autenticación
- `ProjectCreate` / `ProjectOut` / `ProjectUpdate` — proyectos
- `RecordOut` — lo que devuelve la API al listar registros (incluye todos los campos de análisis LLM)
- `RecordImportItem` — esquema de cada fila del CSV; define qué columnas del CSV se leen
- `CsvImportResult` — resultado de una importación: `imported`, `skipped`, `errors`
- `SentimentAnnotationCreate` / `PillarAnnotationCreate` / `FieldAnnotationCreate` — guardar anotaciones
- `KeywordDecisionCreate` — aceptar/rechazar términos

**¿Cuándo lo tocas?** Cuando añades un campo nuevo: hay que añadirlo en `RecordOut` (para que la API lo devuelva) y en `RecordImportItem` (para que el CSV lo reconozca).

---

### `backend/app/routers/auth.py`
Endpoints de autenticación:
- `POST /api/auth/register` — crea cuenta con `status="pending"`. **No devuelve token.** El usuario no puede loguearse hasta ser aprobado por un admin.
- `POST /api/auth/login` — devuelve JWT. Rechaza con 403 si el usuario está `pending` o `rejected`.
- `GET /api/auth/me` — devuelve datos del usuario autenticado.

---

### `backend/app/routers/admin.py`
Solo accesible para `role="admin"`:
- `GET /api/admin/users/pending` — lista solicitudes pendientes de aprobación.
- `GET /api/admin/users` — lista todos los usuarios.
- `POST /api/admin/users/{id}/decision` — aprobar o rechazar una solicitud, con posibilidad de sobreescribir el rol pedido.
- `POST /api/admin/users/{id}/role` — cambiar el rol de un usuario ya aprobado.

---

### `backend/app/routers/projects.py`
- `GET /api/projects` — lista todos los proyectos.
- `GET /api/projects/{id}` — obtiene un proyecto.
- `POST /api/projects` — crea un proyecto (solo admin/reviewer).
- `GET /api/projects/{id}/stats` — estadísticas: total de registros por estado.
- `PUT /api/projects/{id}` — actualiza nombre, tema, descripción, ámbito (solo admin/reviewer).

---

### `backend/app/routers/records.py`
El router más complejo:
- `GET /api/projects/{id}/records` — lista registros con paginación. Calcula `pending` y `done` **en el servidor** para este usuario (nunca devuelve negativos). Limpia locks expirados en cada llamada.
- `POST /api/projects/{id}/records/{record_id}/lock` — adquiere lock pesimista (30 min). Devuelve 409 si otro usuario tiene el lock activo.
- `DELETE /api/projects/{id}/records/{record_id}/lock` — libera el lock.
- `POST /api/projects/{id}/records/import-csv` — **importa directamente un archivo CSV** (multipart/form-data). Acepta un campo opcional `meta_json` para actualizar los metadatos del proyecto al mismo tiempo. Procesa fila a fila, convierte cadenas vacías a `None`, y devuelve un resumen con `imported`, `skipped`, `errors`.
- `POST /api/projects/{id}/records/import` — alternativa: importa desde JSON (para scripts).

---

### `backend/app/routers/annotations.py`
- `POST /api/projects/{id}/annotations/sentiment` — guarda anotación de sentimiento. Libera el lock automáticamente. Actualiza `record.status` a `annotated_partial` (1 anotador) o `annotated` (2 anotadores distintos).
- `POST /api/projects/{id}/annotations/pillar` — igual para pilares.
- `POST /api/projects/{id}/annotations/field` — guarda corrección de cualquier campo de texto del registro (posicion, lang, world_country, etc.) usando los campos genéricos `field_name`/`original_text`/`corrected_text`.
- `POST /api/projects/{id}/keywords` — añade un término de búsqueda.
- `GET /api/projects/{id}/keywords` — lista todos los términos del proyecto.
- `PATCH /api/projects/{id}/keywords/{keyword_id}` — acepta o rechaza un término.

---

### `backend/app/routers/review.py`
Solo accesible para `reviewer`, `judge`, `admin`:
- `GET /api/projects/{id}/review/pending` — devuelve todas las anotaciones donde `is_correction=True` y que aún no tienen decisión del revisor.
- `POST /api/annotations/{annotation_id}/review` — guarda `accept` o `reject` sobre una corrección.

**Nota sobre el bug "Todo revisado":** si el revisor ve ese mensaje cuando no debería, es porque ninguna anotación tiene `is_correction=True` todavía. Esto ocurre cuando el anotador no cambia la etiqueta del LLM (la confirma sin corregir). Solo las correcciones reales aparecen en la revisión.

---

### `backend/app/routers/judge.py`
Solo accesible para `judge`, `admin`:
- `GET /api/judge/records` — registros con `status="annotated"` (anotados por ≥2 personas), con sus anotaciones.
- `POST /api/judge/decide/{annotation_id}` — guarda el valor final del juez y marca el registro como `judged`.
- `GET /api/judge/export/{project_id}` — exporta en formato JSONL o CSV (estilo Alpaca) para fine-tuning LoRA.

---

### `backend/scripts/create_admin.py`
Script de **arranque en frío**: crea el primer usuario admin directamente en la base de datos, sin pasar por la API (necesario porque no hay nadie que pueda aprobar al primer admin).

```bash
# Desde la raíz del repo, con el entorno virtual activado:
python -m backend.scripts.create_admin --username admin --email admin@lab.com --password admin1234
```

---

## Frontend

### `frontend/src/main.tsx`
Define todas las rutas de la aplicación con React Router:

| Ruta | Vista |
|---|---|
| `/login` | LoginView |
| `/projects` | ProjectsView |
| `/projects/:id/sentiment` | SentimentView |
| `/projects/:id/pillars` | PillarsView |
| `/projects/:id/review` | ReviewView |
| `/projects/:id/judge` | JudgeView |
| `/projects/:id/import` | ImportView |
| `/projects/:id/keywords` | KeywordsView |
| `/admin` | AdminView (solo admins) |

**¿Cuándo lo tocas?** Para añadir una ruta nueva.

---

### `frontend/src/index.css`
Variables CSS globales que definen el tema oscuro de toda la app. Todos los componentes las usan como `var(--accent)`, `var(--green)`, etc.  
**¿Cuándo lo tocas?** Para cambiar colores o fuentes globalmente.

---

### `frontend/src/types/index.ts`
Todos los tipos TypeScript que se comparten entre vistas y servicios. Define: `Record`, `Project`, `KeywordItem`, `ReviewAnnotation`, `JudgeRecord`, `CsvImportResult`, etc.  
**¿Cuándo lo tocas?** Cuando añades un campo nuevo al modelo: hay que añadirlo también aquí para que TypeScript no proteste.

---

### `frontend/src/stores/authStore.ts`
Estado global (Zustand + localStorage). Guarda el token JWT, el usuario logueado (`username`, `role`, `status`) y el `currentProjectId`. Persiste entre recargas de página.  
Exporta helpers: `isAnnotator()`, `isReviewer()`, `isJudge()`, `isAdmin()`, `canReview()`.

---

### `frontend/src/services/api.ts`
Todas las llamadas HTTP, agrupadas por dominio:
- `authApi` — registro, login, me
- `adminApi` — listar pendientes, aprobar/rechazar, cambiar rol
- `projectsApi` — listar, obtener, crear, actualizar proyectos
- `recordsApi` — listar registros, lock/unlock, importar CSV
- `annotationsApi` — guardar sentimiento/pilar/campo/keyword, listar keywords
- `reviewApi` — pendientes de revisión, decidir
- `judgeApi` — registros para juzgar, decidir, exportar

Intercepta errores 409 (lock conflict) → `LockConflictError` y errores 403 (cuenta pendiente) → `AccountPendingError`.

---

### `frontend/src/components/Layout.tsx`
La estructura visual que rodea todas las vistas: barra lateral izquierda con navegación.  
La navegación **dentro de un proyecto** (Sentimiento, Pilares, Revisar, Importar CSV, Keywords, Juzgar) solo aparece cuando la URL incluye `:id` — es decir, cuando ya has entrado a un proyecto.  
Al cerrar sesión, limpia el caché de React Query (`qc.clear()`) antes de navegar a `/login`.

---

### `frontend/src/components/ProjectContextBar.tsx`
Barra pegajosa (`position: sticky`) que aparece arriba de la lista de registros en Sentimiento, Pilares e Importar CSV. Muestra el tema, descripción y ámbito del proyecto. Hace `GET /api/projects/{id}` con `staleTime: 60s` para no re-pedirlo en cada render.

---

### `frontend/src/components/ProtectedRoute.tsx`
Dos guardas de ruta:
- `ProtectedRoute` — redirige a `/login` si no hay token.
- `AdminRoute` — redirige a `/projects` si el usuario no es admin.

---

### `frontend/src/views/LoginView.tsx`
Pantalla de inicio. Tiene dos pestañas:
- **Entrar** — login normal.
- **Registrarse** — pide usuario, email, contraseña y rol deseado. Al enviar, la cuenta queda en `pending` y se muestra un mensaje naranja "Un administrador debe aprobarla...". No hay token.

---

### `frontend/src/views/ProjectsView.tsx`
Lista los proyectos disponibles. Si el usuario es admin o reviewer, muestra el botón **"+ Nuevo proyecto"** que despliega un formulario con: nombre, tema, descripción y ámbito.  
Al hacer clic en un proyecto, guarda el `id` en el store y navega a `/projects/{id}/sentiment`.

---

### `frontend/src/views/ImportView.tsx`
Flujo de importación en 3 pasos:
1. **Seleccionar CSV** (drag & drop o clic). Muestra un resumen de columnas reconocidas vs ignoradas. Permite actualizar opcionalmente los metadatos del proyecto (nombre, descripción, ámbito).
2. **Preview** — tabla con las primeras 5 filas, indicador de columnas reconocidas (en azul) y no reconocidas (en gris).
3. **Resultado** — resumen de filas importadas, omitidas y errores.

Llama a `POST /api/projects/{id}/records/import-csv` con el archivo como `multipart/form-data`.

---

### `frontend/src/views/KeywordsView.tsx`
Lista los términos de búsqueda del proyecto. Permite:
- Añadir nuevos manualmente (input + Enter o botón "+ Añadir").
- Aceptar ✓ o rechazar ✗ cualquier término (tanto los generados por el LLM como los añadidos a mano).

Los términos generados por el LLM llegan a través del CSV (no hay todavía un endpoint de importación masiva de keywords independiente).

---

### `frontend/src/views/SentimentView.tsx`
Vista principal de anotación de sentimiento. Para cada registro:
1. Muestra metadata: plataforma, tipo, fecha, país/idioma (badge de geolocalización).
2. Si hay `url_post`: muestra un link "🔗 Ver post original ↗".
3. Si hay `cuerpo_padre`: muestra el bloque "Post raíz (contexto)" con borde morado.
4. Etiqueta "[Contenido a clasificar]" + el texto del post.
5. Botón "🔓 Abrir para anotar" — adquiere el lock pesimista.
6. Una vez con lock: botones de sentimiento (↑/↓/→/✕), campo de motivo (si es corrección), campo de tema/topic.
7. "Guardar y siguiente →" — guarda, libera el lock, invalida la query para actualizar el progreso.

---

### `frontend/src/views/PillarsView.tsx`
Igual que SentimentView pero para los 4 pilares de aceptación:
- **Legitimación** — ¿Es legal/legítima la medida?
- **Efectividad** — ¿Funcionará?
- **Justicia y equidad** — ¿Es justa?
- **Confianza institucional** — ¿Confía en quienes la implementan?

Cada pilar tiene botones +1 / 0 / −1 / N/A. Si el valor difiere del LLM, aparece un campo para el motivo.

---

### `frontend/src/views/ReviewView.tsx`
Solo visible para reviewers, judges y admins.  
Muestra las anotaciones donde `is_correction=True` que aún no tienen decisión del revisor. Para cada una: comparación LLM vs corrección humana + motivo. Botones "✓ Aceptar" y "✗ Rechazar".

**Por qué puede aparecer "Todo revisado" incorrectamente:** el endpoint solo devuelve anotaciones con `is_correction=True`. Si los anotadores han confirmado las etiquetas del LLM sin cambiarlas, `is_correction=False` y no aparecen aquí. Es el comportamiento correcto: solo hay que revisar lo que alguien ha corregido.

---

### `frontend/src/views/JudgeView.tsx`
Solo visible para judges y admins.  
Muestra registros con `status="annotated"` (anotados por ≥2 personas). Para cada uno: el post, la etiqueta del LLM, las anotaciones de ambos anotadores en paralelo, y botones para elegir el valor final. Al guardar, el registro pasa a `status="judged"`.

---

### `frontend/src/views/AdminView.tsx`
Solo visible para admins. Dos secciones:
- **Solicitudes pendientes** — usuarios en `status="pending"`. Muestra usuario, email, rol pedido. Permite elegir el rol final y aprobar/rechazar.
- **Todos los usuarios** — lista completa con su estado. Permite cambiar el rol de cualquier usuario aprobado con un selector.

---

## Flujo completo de uso

```
Admin crea el primer usuario (create_admin.py)
    ↓
Admin entra y crea un proyecto (ProjectsView → formulario)
    ↓
Admin importa el CSV con posts anotados por el LLM (ImportView → 3 pasos)
    ↓
Admin gestiona keywords del proyecto (KeywordsView)
    ↓
Anotadores se registran → quedan pendientes
    ↓
Admin los aprueba y asigna roles (AdminView)
    ↓
Anotador A anota sentimiento → lock → guardar → lock liberado
Anotador B anota el mismo registro → lock distinto → guardar
    → record.status = "annotated"
    ↓
Reviewer revisa correcciones (ReviewView) → acepta o rechaza
    ↓
Judge ve LLM + anotador A + anotador B (JudgeView) → decide etiqueta final
    → record.status = "judged"
    ↓
Judge exporta JSONL/CSV para LoRA (botón en JudgeView)
```

---

## Variables de entorno

| Variable | Dónde se usa | Valor por defecto |
|---|---|---|
| `DATABASE_URL` | `backend/app/core/database.py` | `postgresql+asyncpg://postgres:postgres@localhost:5432/annotation_db` |
| `SECRET_KEY` | `backend/app/core/security.py` | `change-me-in-production-use-32chars!` ⚠ cámbiala |
| `PYTHONPATH` | `docker-compose.yml` | `/app` (necesario para imports `from backend.app...`) |
| `VITE_API_URL` | `frontend/src/services/api.ts` | Actualmente hardcodeada a `/api` (usa el proxy de Vite) |
