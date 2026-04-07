# Agendamiento Consulta Web

Aplicacion web con frontend estatico, backend en Express y base de datos PostgreSQL.

## Requisitos

- Node.js 20 o superior
- PostgreSQL

## Variables de entorno

Usa el archivo `.env.example` como referencia:

- `DATABASE_URL`: cadena de conexion a PostgreSQL
- `PORT`: puerto del servidor
- `NODE_ENV`: `development` o `production`

## Base de datos

Ejecuta el script [db.sql](./db.sql) para crear las tablas:

```sql
\i db.sql
```

## Ejecucion local

```bash
npm install
npm start
```

Luego abre `http://localhost:3000`.

## Railway

1. Sube este proyecto a un repositorio.
2. Crea un servicio en Railway desde GitHub.
3. Agrega una base PostgreSQL en Railway.
4. Configura la variable `DATABASE_URL` con la cadena que entrega Railway.
5. Railway ejecutara `npm install` y luego `npm start`.
