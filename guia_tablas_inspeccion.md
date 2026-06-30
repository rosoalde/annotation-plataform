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

---

# 7. Ver todas las tablas mediante SQL

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';
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

# Flujo de inspección recomendado

1. Conectarse a PostgreSQL.
2. Ejecutar `\dt` para verificar las tablas disponibles.
3. Revisar la estructura con `\d nombre_tabla`.
4. Contar registros con `SELECT COUNT(*)`.
5. Inspeccionar una muestra de datos mediante `SELECT * ... LIMIT 10`.
6. Verificar relaciones entre tablas si es necesario.

Este flujo permite confirmar rápidamente que el esquema está creado correctamente y que la aplicación está almacenando información en la base de datos.
