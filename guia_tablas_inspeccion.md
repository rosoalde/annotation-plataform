# Guía de inspección de tablas en PostgreSQL (`psql`)

## 1. Acceder a la base de datos

Si la base de datos está ejecutándose en Docker Compose:

```bash
docker compose exec db psql -U postgres -d annotation_db
```

Si la conexión es correcta, aparecerá un prompt similar a:

```text
annotation_db=#
```

---

# 2. Ver las tablas disponibles

```sql
\dt
```

Ejemplo:

```text
             List of relations
 Schema |     Name     | Type  |  Owner
--------+--------------+-------+----------
 public | annotations  | table | postgres
 public | keywords     | table | postgres
 public | projects     | table | postgres
 public | record_locks | table | postgres
 public | records      | table | postgres
 public | users        | table | postgres
```

---

# 3. Ver la estructura de una tabla

Para inspeccionar las columnas, tipos y restricciones:

```sql
\d users
```

También funciona con cualquier otra tabla:

```sql
\d projects
\d records
\d annotations
\d keywords
\d record_locks
\d users
```

---

# 4. Ver el contenido de una tabla

Mostrar todos los registros:

```sql
SELECT * FROM users;
```

Es recomendable limitar los resultados:

```sql
SELECT * FROM users LIMIT 10;
```

Ejemplos:

```sql
SELECT * FROM projects LIMIT 10;

SELECT * FROM records LIMIT 10;

SELECT * FROM annotations LIMIT 10;

SELECT * FROM keywords LIMIT 10;
```

---

# 5. Contar registros

Comprobar si una tabla contiene datos:

```sql
SELECT COUNT(*) FROM users;

SELECT COUNT(*) FROM projects;

SELECT COUNT(*) FROM records;

SELECT COUNT(*) FROM annotations;

SELECT COUNT(*) FROM keywords;

SELECT COUNT(*) FROM record_locks;
```

---

# 6. Consultar registros concretos

Buscar un usuario por id:

```sql
SELECT *
FROM users
WHERE id = 1;
```

Buscar un proyecto:

```sql
SELECT *
FROM projects
WHERE id = 1;
```

Buscar los primeros registros ordenados:

```sql
SELECT *
FROM records
ORDER BY id
LIMIT 20;
```

Buscar un registro por record_id:

```sql
SELECT *
FROM annotations 
WHERE record_id = '200f5018-1eb8-45ce-9446-704166ee9fc8';
```

---

# 7. Ver todas las tablas mediante SQL

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```

---

# 8. Información de la conexión

Ver la base de datos y el usuario conectados:

```sql
\conninfo
```

---

# 9. Otros comandos útiles

Listar bases de datos:

```sql
\l
```

Listar usuarios:

```sql
\du
```

Listar esquemas:

```sql
\dn
```

Mostrar ayuda de `psql`:

```sql
\?
```

---

# 10. Salir de `psql`

```sql
\q
```

---

# 11. Eliminar datos de la base de datos

Eliminar un proyecto por nombre.
Antes de eliminar un proyecto es necesario eliminar todos los registros que dependen de él, respetando las restricciones de claves foráneas.

Paso 1. Eliminar los bloqueos de los registros

```sql
DELETE FROM record_locks
WHERE record_id IN (
    SELECT id
    FROM records
    WHERE project_id = (
        SELECT id
        FROM projects
        WHERE name = 'Bikesharing'
    )
);
```

Paso 2. Eliminar las anotaciones

```sql
DELETE FROM annotations
WHERE project_id = (
    SELECT id
    FROM projects
    WHERE name = 'Bikesharing'
);
```

Paso 3. Eliminar las keywords

```sql
DELETE FROM keywords
WHERE project_id = (
    SELECT id
    FROM projects
    WHERE name = 'Bikesharing'
);
```

Paso 4. Eliminar los registros

```sql
DELETE FROM records
WHERE project_id = (
    SELECT id
    FROM projects
    WHERE name = 'Bikesharing'
);
```

Paso 5. Eliminar el proyecto

```sql
DELETE FROM projects
WHERE name = 'Bikesharing';
```

# Flujo de inspección recomendado

1. Conectarse a PostgreSQL.
2. Ejecutar `\dt` para verificar las tablas disponibles.
3. Revisar la estructura con `\d nombre_tabla`.
4. Contar registros con `SELECT COUNT(*)`.
5. Inspeccionar una muestra de datos mediante `SELECT * ... LIMIT 10`.
6. Verificar relaciones entre tablas si es necesario.

Este flujo permite confirmar rápidamente que el esquema está creado correctamente y que la aplicación está almacenando información en la base de datos.
