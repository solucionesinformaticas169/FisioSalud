const fs = require("fs");
const path = require("path");
const dns = require("dns");
const crypto = require("crypto");
require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const AVAILABLE_HOURS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00"
];
const SESSION_SLOT_OPTIONS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"
];
const THERAPY_CAPACITY = {
  CAMILLA: 3,
  RODILLA_TOBILLO: 2,
  HOMBRO_CODO_MANO: 3
};
const SITE_CONTENT_PATH = path.join(__dirname, "site-content.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ROLE_ORDER = {
  USER: 1,
  ADMIN: 2,
  SUPERADMIN: 3
};
const SMTP_ENABLED = String(process.env.SMTP_ENABLED || "").toLowerCase() === "true";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = String(process.env.SMTP_PASS || "").replace(/\s+/g, "");
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const TWILIO_ENABLED = String(process.env.TWILIO_ENABLED || "").toLowerCase() === "true";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
const META_WHATSAPP_ENABLED = String(process.env.META_WHATSAPP_ENABLED || "").toLowerCase() === "true";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const META_WHATSAPP_PHONE_NUMBER_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
const META_WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || "";
const META_WHATSAPP_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN || "";
const META_WHATSAPP_VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN || "";
const META_TEMPLATE_LANGUAGE = process.env.META_TEMPLATE_LANGUAGE || "es";
const META_TEMPLATE_CONFIRMACION_CITA = process.env.META_TEMPLATE_CONFIRMACION_CITA || "confirmacion_cita";
const META_TEMPLATE_REAGENDAMIENTO_CITA = process.env.META_TEMPLATE_REAGENDAMIENTO_CITA || "reagendamiento_cita";
const META_TEMPLATE_CANCELACION_CITA = process.env.META_TEMPLATE_CANCELACION_CITA || "cancelacion_cita1";
const META_TEMPLATE_RECORDATORIO_CITA = process.env.META_TEMPLATE_RECORDATORIO_CITA || "recordatorio_cita1";
const META_TEMPLATE_CONFIRMACION_PLAN = process.env.META_TEMPLATE_CONFIRMACION_PLAN || "confirmacion_plan_sesiones1";
const META_TEMPLATE_REAGENDAMIENTO_SESION = process.env.META_TEMPLATE_REAGENDAMIENTO_SESION || "reagendamiento_sesion";
const META_TEMPLATE_CANCELACION_SESION = process.env.META_TEMPLATE_CANCELACION_SESION || "cancelacion_sesion";
const CLINIC_TIME_ZONE = process.env.CLINIC_TIME_ZONE || "America/Guayaquil";
const CLINIC_UTC_OFFSET_HOURS = Number(process.env.CLINIC_UTC_OFFSET_HOURS || -5);
const SESSION_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const SESSION_STALE_MINUTES = 30;

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
let mailTransporter = null;
let twilioClient = null;
let remindersRunning = false;

ensureSiteContent();

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

app.post("/api/auth/login", async (request, response) => {
  const username = String(request.body.username || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const clientMeta = getClientMetadata(request);

  if (!username || !password) {
    await registerAccessAttempt({
      username,
      successful: false,
      failureReason: "DATOS_INCOMPLETOS",
      clientMeta
    });
    return response.status(400).json({ message: "Usuario y contrasena son obligatorios." });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, nombre, role, activo, password_salt, password_hash
       FROM usuarios_sistema
       WHERE username = $1`,
      [username]
    );

    if (result.rowCount === 0) {
      await registerAccessAttempt({
        username,
        successful: false,
        failureReason: "USUARIO_NO_EXISTE",
        clientMeta
      });
      return response.status(401).json({ message: "Credenciales incorrectas. Revisa usuario y contrasena." });
    }

    const user = result.rows[0];
    if (!user.activo) {
      await registerAccessAttempt({
        user,
        username,
        successful: false,
        failureReason: "USUARIO_INACTIVO",
        clientMeta
      });
      return response.status(403).json({ message: "Este usuario se encuentra inactivo." });
    }

    if (!verifyPassword(password, user.password_salt, user.password_hash)) {
      await registerAccessAttempt({
        user,
        username,
        successful: false,
        failureReason: "CONTRASENA_INVALIDA",
        clientMeta
      });
      return response.status(401).json({ message: "Credenciales incorrectas. Revisa usuario y contrasena." });
    }

    const sessionToken = generateSessionToken();
    await registerAccessAttempt({
      user,
      username,
      successful: true,
      sessionToken,
      clientMeta
    });

    return response.json({
      session: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.nombre,
        sessionToken
      }
    });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo iniciar sesion." });
  }
});

app.post("/api/auth/logout", async (request, response) => {
  const sessionToken = String(request.body.sessionToken || request.header("x-session-token") || "").trim();
  const reason = String(request.body.reason || "").trim() || "LOGOUT";

  if (!sessionToken) {
    return response.status(400).json({ message: "No se recibio la sesion activa." });
  }

  try {
    await closeAccessSession(sessionToken, reason);
    return response.json({ ok: true });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo cerrar la sesion." });
  }
});

app.post("/api/auth/heartbeat", async (request, response) => {
  const sessionToken = String(request.body.sessionToken || request.header("x-session-token") || "").trim();

  if (!sessionToken) {
    return response.status(400).json({ ok: false, message: "Sesion no identificada." });
  }

  try {
    const touched = await touchAccessSession(sessionToken);
    return response.json({ ok: touched });
  } catch (error) {
    return response.status(500).json({ ok: false, message: "No se pudo actualizar la actividad." });
  }
});

app.get("/api/admin/users", async (request, response) => {
  const role = String(request.header("x-role") || "").toUpperCase();
  if (!hasRequiredRole(role, "SUPERADMIN")) {
    return response.status(403).json({ message: "No tienes permisos para administrar usuarios." });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, nombre, role, activo, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM usuarios_sistema
       ORDER BY username ASC`
    );

    return response.json({ users: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar los usuarios." });
  }
});

app.get("/api/admin/login-history", async (request, response) => {
  const role = String(request.header("x-role") || "").toUpperCase();
  if (!hasRequiredRole(role, "ADMIN")) {
    return response.status(403).json({ message: "No tienes permisos para consultar el historial de accesos." });
  }

  const username = String(request.query.username || "").trim().toLowerCase();
  const status = String(request.query.status || "").trim().toUpperCase();
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();

  if ((startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    return response.status(400).json({ message: "Las fechas deben tener formato YYYY-MM-DD." });
  }

  if (startDate && endDate && new Date(`${startDate}T00:00:00`).getTime() > new Date(`${endDate}T00:00:00`).getTime()) {
    return response.status(400).json({ message: "La fecha inicial no puede ser posterior a la final." });
  }

  try {
    const params = [];
    const filters = [];

    if (username) {
      params.push(`%${username}%`);
      filters.push(`LOWER(ha.username_intento) LIKE $${params.length}`);
    }

    if (status === "SUCCESS") {
      params.push(true);
      filters.push(`ha.login_exitoso = $${params.length}`);
    } else if (status === "FAILED") {
      params.push(false);
      filters.push(`ha.login_exitoso = $${params.length}`);
    } else if (status === "ACTIVE") {
      params.push(true);
      filters.push(`ha.sesion_activa = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      filters.push(`ha.fecha_hora_ingreso >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      filters.push(`ha.fecha_hora_ingreso < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const limitClause = filters.length ? "" : "LIMIT 10";
    const result = await pool.query(
      `SELECT
         ha.id,
         ha.username_intento,
         COALESCE(ha.nombre_usuario, us.nombre) AS nombre_usuario,
         ha.role_usuario,
         ha.login_exitoso,
         ha.motivo_fallo,
         ha.fecha_hora_ingreso,
         ha.fecha_hora_cierre,
         ha.ultima_actividad,
         ha.sesion_activa,
         ha.navegador,
         ha.sistema_operativo,
         ha.direccion_ip
       FROM historial_accesos ha
       LEFT JOIN usuarios_sistema us ON us.id = ha.user_id
       ${whereClause}
       ORDER BY ha.fecha_hora_ingreso DESC
       ${limitClause}`,
      params
    );

    return response.json({ history: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar el historial de accesos." });
  }
});

app.post("/api/admin/users", async (request, response) => {
  const requesterRole = String(request.header("x-role") || "").toUpperCase();
  if (!hasRequiredRole(requesterRole, "SUPERADMIN")) {
    return response.status(403).json({ message: "No tienes permisos para crear usuarios." });
  }

  const payload = normalizeSystemUserPayload(request.body);
  const validation = validateSystemUserPayload(payload, true);
  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  try {
    const exists = await pool.query(
      `SELECT 1 FROM usuarios_sistema WHERE username = $1`,
      [payload.username]
    );

    if (exists.rowCount > 0) {
      return response.status(409).json({ message: "El nombre de usuario ya existe." });
    }

    const credentials = hashPassword(payload.password);
    await pool.query(
      `INSERT INTO usuarios_sistema (username, nombre, role, password_salt, password_hash, activo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [payload.username, payload.nombre, payload.role, credentials.salt, credentials.hash, true]
    );

    return response.status(201).json({ message: "Usuario creado correctamente." });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo crear el usuario." });
  }
});

app.patch("/api/admin/users/:id", async (request, response) => {
  const requesterRole = String(request.header("x-role") || "").toUpperCase();
  if (!hasRequiredRole(requesterRole, "SUPERADMIN")) {
    return response.status(403).json({ message: "No tienes permisos para actualizar usuarios." });
  }

  const userId = Number(request.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return response.status(400).json({ message: "Identificador de usuario invalido." });
  }

  const payload = normalizeSystemUserPayload(request.body, { allowMissing: true });
  const validation = validateSystemUserPayload(payload, false);
  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  try {
    const current = await pool.query(
      `SELECT id FROM usuarios_sistema WHERE id = $1`,
      [userId]
    );

    if (current.rowCount === 0) {
      return response.status(404).json({ message: "El usuario no existe." });
    }

    const updates = [];
    const params = [];

    if (payload.nombre) {
      params.push(payload.nombre);
      updates.push(`nombre = $${params.length}`);
    }

    if (payload.role) {
      params.push(payload.role);
      updates.push(`role = $${params.length}`);
    }

    if (typeof payload.activo === "boolean") {
      params.push(payload.activo);
      updates.push(`activo = $${params.length}`);
    }

    if (payload.password) {
      const credentials = hashPassword(payload.password);
      params.push(credentials.salt);
      updates.push(`password_salt = $${params.length}`);
      params.push(credentials.hash);
      updates.push(`password_hash = $${params.length}`);
    }

    if (!updates.length) {
      return response.status(400).json({ message: "No hay cambios para guardar." });
    }

    params.push(userId);
    await pool.query(
      `UPDATE usuarios_sistema
       SET ${updates.join(", ")}
       WHERE id = $${params.length}`,
      params
    );

    return response.json({ message: "Usuario actualizado correctamente." });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo actualizar el usuario." });
  }
});

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ ok: false, message: "No se pudo conectar a la base de datos." });
  }
});

setInterval(() => {
  runReminderJobs().catch((error) => {
    console.error("Error ejecutando recordatorios:", error.message);
  });

  cleanupStaleAccessSessions().catch((error) => {
    console.error("Error cerrando sesiones inactivas:", error.message);
  });
}, SESSION_HEARTBEAT_INTERVAL_MS);

setTimeout(() => {
  runReminderJobs().catch((error) => {
    console.error("Error ejecutando recordatorios iniciales:", error.message);
  });

  cleanupStaleAccessSessions().catch((error) => {
    console.error("Error cerrando sesiones inactivas al iniciar:", error.message);
  });
}, 5000);

app.get("/api/patients/:cedula", async (request, response) => {
  const { cedula } = request.params;

  if (!/^\d{10}$/.test(cedula)) {
    return response.status(400).json({ exists: false, message: "Cedula invalida." });
  }

  try {
    const result = await pool.query(
      `SELECT cedula, nombre, apellido, telefono, correo
       FROM pacientes
       WHERE cedula = $1`,
      [cedula]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ exists: false });
    }

    return response.json({ exists: true, patient: result.rows[0] });
  } catch (error) {
    return response.status(500).json({ exists: false, message: "Error consultando paciente." });
  }
});

function validateDateRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return "Las fechas deben tener formato YYYY-MM-DD.";
  }

  if (new Date(`${startDate}T00:00:00`).getTime() > new Date(`${endDate}T00:00:00`).getTime()) {
    return "La fecha inicial no puede ser posterior a la final.";
  }

  return null;
}

app.get("/api/reports/web-appointments", async (request, response) => {
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();

  const validationMessage = validateDateRange(startDate, endDate);
  if (validationMessage) {
    return response.status(400).json({ message: validationMessage });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.cedula, p.nombre, p.apellido, c.fecha, TO_CHAR(c.hora, 'HH24:MI') AS hora, c.observacion
       FROM citas c
       INNER JOIN pacientes p ON p.cedula = c.cedula
       WHERE c.origen = 'WEB'
         AND c.fecha BETWEEN $1 AND $2
       ORDER BY c.fecha ASC, c.hora ASC`,
      [startDate, endDate]
    );

    return response.json({ appointments: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar los pacientes agendados." });
  }
});

app.get("/api/reports/sessions", async (request, response) => {
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();
  const cedula = String(request.query.cedula || "").replace(/\D/g, "");

  const validationMessage = validateDateRange(startDate, endDate);
  if (validationMessage) {
    return response.status(400).json({ message: validationMessage });
  }

  try {
    const params = [startDate, endDate];
    let cedulaClause = "";

    if (cedula.length === 10) {
      cedulaClause = "AND plan.cedula = $3";
      params.push(cedula);
    }

    const result = await pool.query(
      `SELECT det.id,
              plan.cedula,
              p.nombre,
              p.apellido,
              plan.diagnostico,
              TO_CHAR(det.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(det.hora, 'HH24:MI') AS hora,
              det.tipo_terapia
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE det.fecha BETWEEN $1 AND $2
         ${cedulaClause}
       ORDER BY det.fecha ASC, det.hora ASC`,
      params
    );

    return response.json({ sessions: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar las sesiones." });
  }
});

app.get("/api/attendances/sessions", async (request, response) => {
  const date = String(request.query.date || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ message: "La fecha es obligatoria." });
  }

  try {
    const result = await pool.query(
      `SELECT det.id,
              det.numero_sesion,
              TO_CHAR(det.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(det.hora, 'HH24:MI') AS hora,
              det.tipo_terapia,
              det.estado_atencion,
              plan.cedula,
              p.nombre,
              p.apellido,
              plan.diagnostico
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE det.fecha = $1
       ORDER BY det.tipo_terapia ASC, det.hora ASC, p.apellido ASC, p.nombre ASC`,
      [date]
    );

    return response.json({ sessions: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar el listado de atenciones." });
  }
});

app.patch("/api/attendances/sessions/:id", async (request, response) => {
  const sessionId = Number(request.params.id);
  const status = String(request.body.estadoAtencion || "").trim().toUpperCase();

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ message: "Identificador de sesion invalido." });
  }

  if (!["ATENDIDO", "NO_ATENDIDO"].includes(status)) {
    return response.status(400).json({ message: "Estado de atencion invalido." });
  }

  try {
    const result = await pool.query(
      `UPDATE plan_sesion_detalles
       SET estado_atencion = $1
       WHERE id = $2
       RETURNING id`,
      [status, sessionId]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ message: "La sesion no existe." });
    }

    return response.json({ message: "Estado de atencion actualizado correctamente." });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo actualizar el estado de atencion." });
  }
});

app.get("/api/session-plans/patient/:cedula", async (request, response) => {
  const cedula = String(request.params.cedula || "").replace(/\D/g, "");

  if (!/^\d{10}$/.test(cedula)) {
    return response.status(400).json({ message: "La cedula debe tener 10 digitos." });
  }

  try {
    const result = await pool.query(
      `SELECT det.id,
              det.plan_id,
              det.numero_sesion,
              TO_CHAR(det.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(det.hora, 'HH24:MI') AS hora,
              det.tipo_terapia,
              plan.cedula,
              p.nombre,
              p.apellido,
              plan.diagnostico
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE plan.cedula = $1
         AND det.fecha >= CURRENT_DATE
       ORDER BY det.fecha ASC, det.hora ASC, det.numero_sesion ASC`,
      [cedula]
    );

    return response.json({ sessions: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar las sesiones del paciente." });
  }
});

app.get("/api/session-plans/available-times", async (request, response) => {
  const date = String(request.query.date || "").trim();
  const therapyType = String(request.query.tipoTerapia || "").trim();
  const cedula = String(request.query.cedula || "").replace(/\D/g, "");
  const excludeSessionId = Number(request.query.excludeSessionId || 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ message: "La fecha es obligatoria." });
  }

  if (isWeekendDate(date)) {
    return response.status(400).json({ message: "Solo se pueden consultar dias habiles." });
  }

  if (!THERAPY_CAPACITY[therapyType]) {
    return response.status(400).json({ message: "Tipo de terapia invalido." });
  }

  if (!/^\d{10}$/.test(cedula)) {
    return response.status(400).json({ message: "La cedula debe tener 10 digitos." });
  }

  if (!Number.isInteger(excludeSessionId) || excludeSessionId <= 0) {
    return response.status(400).json({ message: "Identificador de sesion invalido." });
  }

  try {
    const availableTimes = await getAvailableTimesForDate(date, therapyType, cedula, excludeSessionId);
    return response.json({ availableTimes });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar la disponibilidad." });
  }
});

app.put("/api/session-plans/sessions/:id/reschedule", async (request, response) => {
  const sessionId = Number(request.params.id);
  const fecha = String(request.body.fecha || "").trim();
  const hora = String(request.body.hora || "").trim();

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ message: "Identificador de sesion invalido." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return response.status(400).json({ message: "La fecha es obligatoria." });
  }

  if (isWeekendDate(fecha)) {
    return response.status(400).json({ message: "Solo se pueden agendar dias habiles." });
  }

  if (!SESSION_SLOT_OPTIONS.includes(hora)) {
    return response.status(400).json({ message: "La hora seleccionada no es valida." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT det.id,
              det.numero_sesion,
              TO_CHAR(det.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(det.hora, 'HH24:MI') AS hora,
              det.tipo_terapia,
              plan.cedula,
              plan.diagnostico,
              p.nombre,
              p.apellido,
              p.telefono,
              p.correo
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE det.id = $1`,
      [sessionId]
    );

    if (sessionResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "La sesion no existe." });
    }

    const current = sessionResult.rows[0];
    if (current.fecha === fecha && current.hora === hora) {
      await client.query("ROLLBACK");
      return response.status(400).json({ message: "La sesion ya esta en ese horario." });
    }

    const patientConflict = await client.query(
      `SELECT 1
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       WHERE plan.cedula = $1
         AND det.fecha = $2
         AND TO_CHAR(det.hora, 'HH24:MI') = $3
         AND det.id <> $4`,
      [current.cedula, fecha, hora, sessionId]
    );

    if (patientConflict.rowCount > 0) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "El paciente ya tiene otra sesion en ese horario." });
    }

    const occupancy = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM plan_sesion_detalles
       WHERE fecha = $1
         AND TO_CHAR(hora, 'HH24:MI') = $2
         AND tipo_terapia = $3
         AND id <> $4`,
      [fecha, hora, current.tipo_terapia, sessionId]
    );

    if (occupancy.rows[0].total >= THERAPY_CAPACITY[current.tipo_terapia]) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "No hay cupos disponibles para ese horario." });
    }

    await client.query(
      `UPDATE plan_sesion_detalles
       SET fecha = $1, hora = $2
       WHERE id = $3`,
      [fecha, hora, sessionId]
    );

    await client.query("COMMIT");
    queueSessionRescheduleEmail({
      sessionNumber: current.numero_sesion,
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      correo: current.correo,
      diagnostico: current.diagnostico,
      tipoTerapia: current.tipo_terapia,
      oldFecha: current.fecha,
      oldHora: current.hora,
      fecha,
      hora
    });
    queueSessionRescheduleWhatsappMessage({
      sessionNumber: current.numero_sesion,
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      diagnostico: current.diagnostico,
      tipoTerapia: current.tipo_terapia,
      oldFecha: current.fecha,
      oldHora: current.hora,
      fecha,
      hora
    });
    return response.json({ message: "Sesion reprogramada correctamente." });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo reprogramar la sesion." });
  } finally {
    client.release();
  }
});

app.delete("/api/session-plans/sessions/:id", async (request, response) => {
  const sessionId = Number(request.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ message: "Identificador de sesion invalido." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT det.plan_id,
              det.numero_sesion,
              TO_CHAR(det.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(det.hora, 'HH24:MI') AS hora,
              det.tipo_terapia,
              plan.cedula,
              plan.diagnostico,
              p.nombre,
              p.apellido,
              p.telefono,
              p.correo
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE det.id = $1`,
      [sessionId]
    );

    if (sessionResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "La sesion no existe." });
    }

    const current = sessionResult.rows[0];
    const planId = current.plan_id;

    await client.query(
      `DELETE FROM plan_sesion_detalles
       WHERE id = $1`,
      [sessionId]
    );

    const remaining = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM plan_sesion_detalles
       WHERE plan_id = $1`,
      [planId]
    );

    if (remaining.rows[0].total === 0) {
      await client.query(
        `DELETE FROM planes_sesiones
         WHERE id = $1`,
        [planId]
      );
    }

    await client.query("COMMIT");
    queueSessionCancellationEmail({
      sessionNumber: current.numero_sesion,
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      correo: current.correo,
      diagnostico: current.diagnostico,
      tipoTerapia: current.tipo_terapia,
      fecha: current.fecha,
      hora: current.hora
    });
    queueSessionCancellationWhatsappMessage({
      sessionNumber: current.numero_sesion,
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      diagnostico: current.diagnostico,
      tipoTerapia: current.tipo_terapia,
      fecha: current.fecha,
      hora: current.hora
    });
    return response.json({ message: "Sesion cancelada correctamente." });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo cancelar la sesion." });
  } finally {
    client.release();
  }
});

app.get("/api/reports/appointments", async (request, response) => {
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();

  const validationMessage = validateDateRange(startDate, endDate);
  if (validationMessage) {
    return response.status(400).json({ message: validationMessage });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.cedula, p.nombre, p.apellido, c.origen,
              TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(c.hora, 'HH24:MI') AS hora, c.observacion,
              c.estado_atencion
       FROM citas c
       INNER JOIN pacientes p ON p.cedula = c.cedula
       WHERE c.fecha BETWEEN $1 AND $2
       ORDER BY c.fecha ASC, c.hora ASC`,
      [startDate, endDate]
    );

    return response.json({ appointments: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar las citas." });
  }
});

app.patch("/api/attendances/appointments/:id", async (request, response) => {
  const appointmentId = Number(request.params.id);
  const status = String(request.body.estadoAtencion || "").trim().toUpperCase();

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return response.status(400).json({ message: "Identificador de cita invalido." });
  }

  if (!["ATENDIDO", "NO_ATENDIDO"].includes(status)) {
    return response.status(400).json({ message: "Estado de atencion invalido." });
  }

  try {
    const result = await pool.query(
      `UPDATE citas
       SET estado_atencion = $1
       WHERE id = $2
       RETURNING id`,
      [status, appointmentId]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ message: "La cita no existe." });
    }

    return response.json({ message: "Estado de atencion de la cita actualizado correctamente." });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo actualizar el estado de la cita." });
  }
});

app.get("/api/reports/session-summary", async (request, response) => {
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();

  const validationMessage = validateDateRange(startDate, endDate);
  if (validationMessage) {
    return response.status(400).json({ message: validationMessage });
  }

  try {
    const result = await pool.query(
      `SELECT det.tipo_terapia,
              COUNT(*)::int AS total_sessions
       FROM plan_sesion_detalles det
       WHERE det.fecha BETWEEN $1 AND $2
       GROUP BY det.tipo_terapia
       ORDER BY total_sessions DESC, det.tipo_terapia ASC`,
      [startDate, endDate]
    );

    return response.json({ summary: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar el resumen de sesiones." });
  }
});

app.get("/api/reports/session-follow-up", async (request, response) => {
  const startDate = String(request.query.startDate || "").trim();
  const endDate = String(request.query.endDate || "").trim();
  const cedula = String(request.query.cedula || "").replace(/\D/g, "");

  const validationMessage = validateDateRange(startDate, endDate);
  if (validationMessage) {
    return response.status(400).json({ message: validationMessage });
  }

  if (cedula && !/^\d{10}$/.test(cedula)) {
    return response.status(400).json({ message: "La cedula debe tener 10 digitos." });
  }

  try {
    const params = [startDate, endDate];
    let cedulaClause = "";

    if (cedula) {
      params.push(cedula);
      cedulaClause = "AND plan.cedula = $3";
    }

    const result = await pool.query(
      `SELECT plan.id AS plan_id,
              plan.cedula,
              p.nombre,
              p.apellido,
              plan.diagnostico,
              det.tipo_terapia,
              COUNT(*)::int AS total_sesiones,
              COUNT(*) FILTER (WHERE det.estado_atencion = 'ATENDIDO')::int AS atendidas,
              COUNT(*) FILTER (WHERE det.estado_atencion <> 'ATENDIDO')::int AS pendientes,
              TO_CHAR(MIN(det.fecha), 'YYYY-MM-DD') AS fecha_inicio,
              TO_CHAR(MAX(det.fecha), 'YYYY-MM-DD') AS fecha_fin
       FROM plan_sesion_detalles det
       INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
       INNER JOIN pacientes p ON p.cedula = plan.cedula
       WHERE det.fecha BETWEEN $1 AND $2
         ${cedulaClause}
       GROUP BY plan.id, plan.cedula, p.nombre, p.apellido, plan.diagnostico, det.tipo_terapia
       ORDER BY p.apellido ASC, p.nombre ASC, plan.id ASC`,
      params
    );

    const totals = result.rows.reduce((accumulator, row) => {
      accumulator.totalSesiones += row.total_sesiones;
      accumulator.atendidas += row.atendidas;
      accumulator.pendientes += row.pendientes;
      return accumulator;
    }, { totalSesiones: 0, atendidas: 0, pendientes: 0 });

    return response.json({
      summaries: result.rows,
      totals
    });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar el seguimiento de sesiones." });
  }
});
app.get("/api/appointments/available-hours", async (request, response) => {
  const { date } = request.query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ message: "Fecha invalida." });
  }

  if (isWeekendDate(date)) {
    return response.status(400).json({ message: "Solo hay atencion de lunes a viernes." });
  }

  try {
    const result = await pool.query(
      `SELECT TO_CHAR(hora, 'HH24:MI') AS hora
       FROM citas
       WHERE fecha = $1`,
      [date]
    );

    const reservedHours = result.rows.map((row) => row.hora);
    const availableHours = AVAILABLE_HOURS.filter((hour) => !reservedHours.includes(hour));
    return response.json({ availableHours });
  } catch (error) {
    return response.status(500).json({ message: "Error consultando horas." });
  }
});

app.get("/api/appointments/patient/:cedula", async (request, response) => {
  const cedula = String(request.params.cedula || "").replace(/\D/g, "");

  if (!/^\d{10}$/.test(cedula)) {
    return response.status(400).json({ message: "La cédula debe tener 10 dígitos." });
  }

  try {
    const result = await pool.query(
      `SELECT id, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(hora, 'HH24:MI') AS hora, origen, observacion
       FROM citas
       WHERE cedula = $1
         AND fecha >= CURRENT_DATE
       ORDER BY fecha ASC, hora ASC`,
      [cedula]
    );

    return response.json({ appointments: result.rows });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar las citas." });
  }
});

app.post("/api/appointments", async (request, response) => {
  const payload = normalizePayload(request.body);
  const validation = validatePayload(payload);

  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO pacientes (cedula, nombre, apellido, telefono, correo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cedula) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           apellido = EXCLUDED.apellido,
           telefono = EXCLUDED.telefono,
           correo = EXCLUDED.correo,
           updated_at = NOW()`,
      [payload.cedula, payload.nombre, payload.apellido, payload.telefono, payload.correo]
    );

    const availability = await client.query(
      `SELECT 1
       FROM citas
       WHERE fecha = $1 AND hora = $2`,
      [payload.fecha, payload.hora]
    );

    if (availability.rowCount > 0) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "La hora seleccionada ya no esta disponible." });
    }

    await client.query(
      `INSERT INTO citas (cedula, fecha, hora, observacion, origen)
       VALUES ($1, $2, $3, $4, $5)`,
      [payload.cedula, payload.fecha, payload.hora, payload.observacion || null, "WEB"]
    );

    await client.query("COMMIT");

    queueAppointmentConfirmationEmail(payload);
    queueAppointmentWhatsappMessage(payload);
    return response.status(201).json({ message: "Agendado correctamente." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error registrando cita:", error);
    return response.status(500).json({ message: "No se pudo registrar la cita." });
  } finally {
    client.release();
  }
});

app.put("/api/appointments/:id/reschedule", async (request, response) => {
  const appointmentId = Number(request.params.id);
  const fecha = String(request.body.fecha || "").trim();
  const hora = String(request.body.hora || "").trim();

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return response.status(400).json({ message: "Identificador de cita no válido." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return response.status(400).json({ message: "La fecha es obligatoria." });
  }

  if (isWeekendDate(fecha)) {
    return response.status(400).json({ message: "Solo se pueden agendar días hábiles." });
  }

  if (!AVAILABLE_HOURS.includes(hora)) {
    return response.status(400).json({ message: "La hora seleccionada no es válida." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query(
      `SELECT c.cedula,
              p.nombre,
              p.apellido,
              p.telefono,
              p.correo,
              c.observacion,
              TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(c.hora, 'HH24:MI') AS hora
       FROM citas c
       INNER JOIN pacientes p ON p.cedula = c.cedula
       WHERE id = $1`,
      [appointmentId]
    );

    if (currentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "La cita no existe." });
    }

    const current = currentResult.rows[0];
    if (current.fecha === fecha && current.hora === hora) {
      await client.query("ROLLBACK");
      return response.status(400).json({ message: "La cita ya está en ese horario." });
    }

    const conflict = await client.query(
      `SELECT 1 FROM citas WHERE fecha = $1 AND hora = $2 AND id <> $3`,
      [fecha, hora, appointmentId]
    );

    if (conflict.rowCount > 0) {
      await client.query("ROLLBACK");
      return response.status(409).json({ message: "El horario seleccionado ya está reservado." });
    }

    await client.query(
      `UPDATE citas SET fecha = $1, hora = $2 WHERE id = $3`,
      [fecha, hora, appointmentId]
    );

    await client.query("COMMIT");
    queueAppointmentRescheduleEmail({
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      correo: current.correo,
      observacion: current.observacion,
      oldFecha: current.fecha,
      oldHora: current.hora,
      fecha,
      hora
    });
    queueAppointmentRescheduleWhatsappMessage({
      cedula: current.cedula,
      nombre: current.nombre,
      apellido: current.apellido,
      telefono: current.telefono,
      observacion: current.observacion,
      oldFecha: current.fecha,
      oldHora: current.hora,
      fecha,
      hora
    });
    return response.json({ message: "Cita reprogramada correctamente." });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo reprogramar la cita." });
  } finally {
    client.release();
  }
});

app.delete("/api/appointments/:id", async (request, response, next) => {
  const appointmentId = Number(request.params.id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return next();
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query(
      `SELECT c.cedula,
              p.nombre,
              p.apellido,
              p.telefono,
              p.correo,
              c.observacion,
              TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
              TO_CHAR(c.hora, 'HH24:MI') AS hora
       FROM citas c
       INNER JOIN pacientes p ON p.cedula = c.cedula
       WHERE c.id = $1`,
      [appointmentId]
    );

    if (currentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "La cita no existe." });
    }

    const current = currentResult.rows[0];

    await client.query(
      `DELETE FROM citas WHERE id = $1`,
      [appointmentId]
    );

    await client.query("COMMIT");
    queueAppointmentCancellationEmail(current);
    queueAppointmentCancellationWhatsappMessage(current);
    return response.json({ message: "Cita cancelada correctamente." });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo cancelar la cita." });
  } finally {
    client.release();
  }
});

app.delete("/api/appointments/:id", async (request, response) => {
  const appointmentId = Number(request.params.id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return response.status(400).json({ message: "Identificador de cita no válido." });
  }

  try {
    const result = await pool.query(
      `DELETE FROM citas WHERE id = $1`,
      [appointmentId]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ message: "La cita no existe." });
    }

    return response.json({ message: "Cita cancelada correctamente." });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo cancelar la cita." });
  }
});

app.post("/api/patient-intakes", async (request, response) => {
  const payload = normalizeIntakePayload(request.body);
  const validation = validateIntakePayload(payload);

  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO pacientes (cedula, nombre, apellido, telefono, correo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cedula) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           apellido = EXCLUDED.apellido,
           telefono = EXCLUDED.telefono,
           correo = EXCLUDED.correo,
           updated_at = NOW()`,
      [payload.cedula, payload.nombre, payload.apellido, payload.telefono, payload.correo]
    );

    await client.query(
      `INSERT INTO ingresos_paciente (cedula, fecha, hora, observacion, origen)
       VALUES ($1, $2, $3, $4, $5)`,
      [payload.cedula, payload.fecha, payload.hora, payload.observacion || null, "INGRESO"]
    );

    await client.query("COMMIT");
    return response.status(201).json({ message: "Ingreso registrado" });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo registrar el ingreso." });
  } finally {
    client.release();
  }
});

app.get("/api/session-plans/availability", async (request, response) => {
  const payload = {
    cedula: String(request.query.cedula || "").replace(/\D/g, ""),
    numeroSesiones: Number(request.query.numeroSesiones || 0),
    fechaInicial: String(request.query.fechaInicial || "").trim(),
    horaInicial: String(request.query.horaInicial || "").trim(),
    tipoTerapia: String(request.query.tipoTerapia || "").trim()
  };

  const validation = validateSessionPlanSearch(payload);
  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  try {
    const patient = await pool.query(
      `SELECT cedula FROM pacientes WHERE cedula = $1`,
      [payload.cedula]
    );

    if (patient.rowCount === 0) {
      return response.status(404).json({ message: "La cedula no corresponde a un paciente registrado." });
    }

    const preferredHourConflicts = await findPatientPreferredHourConflicts(
      payload.cedula,
      payload.fechaInicial,
      payload.numeroSesiones,
      payload.horaInicial
    );

    if (preferredHourConflicts.length > 0) {
      return response.status(409).json({
        message: `El paciente ya tiene sesiones agendadas a las ${payload.horaInicial}. Elige otro horario.`
      });
    }

    const sessions = await findNearestSessions(payload);
    if (sessions.length !== payload.numeroSesiones) {
      return response.status(409).json({ message: "No se encontraron suficientes sesiones disponibles cercanas." });
    }

    return response.json({ sessions });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo consultar la disponibilidad." });
  }
});

app.get("/api/site-content", (_request, response) => {
  try {
    response.json(readSiteContent());
  } catch (error) {
    response.status(500).json({ message: "No se pudo cargar el contenido del sitio." });
  }
});

app.post("/api/site-content", (request, response) => {
  const role = String(request.header("x-role") || "").toUpperCase();
  if (!hasRequiredRole(role, "ADMIN")) {
    return response.status(403).json({ message: "No tienes permisos para editar el contenido del Home." });
  }

  try {
    const currentContent = readSiteContent();
    const payload = request.body || {};
    const nextContent = {
      ...currentContent,
      ...normalizeSiteContentPayload(payload, currentContent),
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(SITE_CONTENT_PATH, JSON.stringify(nextContent, null, 2), "utf8");
    return response.json({ message: "Contenido actualizado correctamente.", content: nextContent });
  } catch (error) {
    return response.status(500).json({ message: "No se pudo guardar el contenido del sitio." });
  }
});

app.post("/api/session-plans", async (request, response) => {
  const payload = normalizeSessionPlanPayload(request.body);
  const validation = validateSessionPlanPayload(payload);

  if (!validation.ok) {
    return response.status(400).json({ message: validation.message });
  }

  const client = await pool.connect();
  let patientInfo = null;

  try {
    await client.query("BEGIN");

    const patient = await client.query(
      `SELECT cedula, nombre, apellido, telefono, correo
       FROM pacientes
       WHERE cedula = $1`,
      [payload.cedula]
    );

    if (patient.rowCount === 0) {
      await client.query("ROLLBACK");
      return response.status(404).json({ message: "La cedula no corresponde a un paciente registrado." });
    }

    patientInfo = patient.rows[0];

    const planResult = await client.query(
      `INSERT INTO planes_sesiones (cedula, diagnostico, numero_sesiones, fecha_inicial, hora_inicial, tipo_terapia, observacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        payload.cedula,
        payload.diagnostico,
        payload.numeroSesiones,
        payload.fechaInicial,
        payload.horaInicial,
        payload.tipoTerapia,
        payload.observacion || null
      ]
    );

    for (const session of payload.sesiones) {
      const patientConflict = await client.query(
        `SELECT 1
         FROM plan_sesion_detalles det
         INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
         WHERE plan.cedula = $1 AND det.fecha = $2 AND det.hora = $3`,
        [payload.cedula, session.date, session.time]
      );

      if (patientConflict.rowCount > 0) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: `El paciente ya tiene una sesion agendada el ${session.date} a las ${session.time}. Elige otro horario.` });
      }

      const occupancy = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM plan_sesion_detalles
         WHERE fecha = $1 AND hora = $2 AND tipo_terapia = $3`,
        [session.date, session.time, payload.tipoTerapia]
      );

      if (occupancy.rows[0].total >= THERAPY_CAPACITY[payload.tipoTerapia]) {
        await client.query("ROLLBACK");
        return response.status(409).json({ message: `La sesion ${session.sessionNumber} ya no tiene disponibilidad en la hora seleccionada.` });
      }

      await client.query(
        `INSERT INTO plan_sesion_detalles (plan_id, numero_sesion, fecha, hora, tipo_terapia)
         VALUES ($1, $2, $3, $4, $5)`,
        [planResult.rows[0].id, session.sessionNumber, session.date, session.time, payload.tipoTerapia]
      );
    }

    await client.query("COMMIT");
    queueSessionPlanConfirmationEmail({
      cedula: payload.cedula,
      nombre: patientInfo.nombre,
      apellido: patientInfo.apellido,
      telefono: patientInfo.telefono,
      correo: patientInfo.correo,
      diagnostico: payload.diagnostico,
      numeroSesiones: payload.numeroSesiones,
      fechaInicial: payload.fechaInicial,
      horaInicial: payload.horaInicial,
      tipoTerapia: payload.tipoTerapia,
      observacion: payload.observacion,
      sesiones: payload.sesiones
    });
    queueSessionPlanWhatsappMessage({
      cedula: payload.cedula,
      nombre: patientInfo.nombre,
      apellido: patientInfo.apellido,
      telefono: patientInfo.telefono,
      diagnostico: payload.diagnostico,
      numeroSesiones: payload.numeroSesiones,
      fechaInicial: payload.fechaInicial,
      horaInicial: payload.horaInicial,
      tipoTerapia: payload.tipoTerapia,
      observacion: payload.observacion,
      sesiones: payload.sesiones
    });
    return response.status(201).json({ message: "Guardado exitoso" });
  } catch (error) {
    await client.query("ROLLBACK");
    return response.status(500).json({ message: "No se pudo guardar el plan de sesiones." });
  } finally {
    client.release();
  }
});

app.get("/ingreso-paciente", (_request, response) => {
  response.sendFile(path.join(__dirname, "ingreso-paciente.html"));
});

app.get("/plan-sesiones", (_request, response) => {
  response.sendFile(path.join(__dirname, "plan-sesiones.html"));
});

app.get("/agendamiento", (_request, response) => {
  response.sendFile(path.join(__dirname, "agendamiento.html"));
});

app.get("/consulta-cita", (_request, response) => {
  response.sendFile(path.join(__dirname, "consulta-cita.html"));
});

app.get("/consulta-citas", (_request, response) => {
  response.sendFile(path.join(__dirname, "consulta-citas-report.html"));
});

app.get("/consulta-sesiones", (_request, response) => {
  response.sendFile(path.join(__dirname, "consulta-sesiones-report.html"));
});

app.get("/reagendar-sesiones", (_request, response) => {
  response.sendFile(path.join(__dirname, "reagendar-sesiones.html"));
});

app.get("/atenciones", (_request, response) => {
  response.sendFile(path.join(__dirname, "atenciones.html"));
});

app.get("/seguimiento-sesiones", (_request, response) => {
  response.sendFile(path.join(__dirname, "seguimiento-sesiones.html"));
});

app.get("/consultas", (_request, response) => {
  response.redirect("/consulta-citas");
});

app.get("/login", (_request, response) => {
  response.sendFile(path.join(__dirname, "login.html"));
});

app.get("/edicion", (_request, response) => {
  response.sendFile(path.join(__dirname, "edit-home.html"));
});

app.get("/usuarios", (_request, response) => {
  response.sendFile(path.join(__dirname, "usuarios.html"));
});

app.get("/historial-accesos", (_request, response) => {
  response.sendFile(path.join(__dirname, "historial-accesos.html"));
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

bootstrapServer();

function normalizePayload(body) {
  return {
    cedula: String(body.cedula || "").replace(/\D/g, ""),
    nombre: normalizeLetters(body.nombre),
    apellido: normalizeLetters(body.apellido),
    telefono: String(body.telefono || "").replace(/\D/g, ""),
    correo: String(body.correo || "").trim().toLowerCase(),
    fecha: String(body.fecha || "").trim(),
    hora: String(body.hora || "").trim(),
    observacion: normalizeLetters(body.observacion, true)
  };
}

function normalizeIntakePayload(body) {
  return {
    cedula: String(body.cedula || "").replace(/\D/g, ""),
    nombre: normalizeLetters(body.nombre),
    apellido: normalizeLetters(body.apellido),
    telefono: String(body.telefono || "").replace(/\D/g, ""),
    correo: String(body.correo || "").trim().toLowerCase(),
    fecha: String(body.fecha || "").trim(),
    hora: String(body.hora || "").trim(),
    observacion: normalizeLetters(body.observacion, true)
  };
}

function normalizeSessionPlanPayload(body) {
  return {
    cedula: String(body.cedula || "").replace(/\D/g, ""),
    diagnostico: normalizeDiagnosis(body.diagnostico),
    numeroSesiones: Number(body.numeroSesiones || 0),
    fechaInicial: String(body.fechaInicial || "").trim(),
    horaInicial: String(body.horaInicial || "").trim(),
    tipoTerapia: String(body.tipoTerapia || "").trim(),
    observacion: normalizeLetters(body.observacion, true),
    sesiones: Array.isArray(body.sesiones)
      ? body.sesiones.map((session) => ({
          sessionNumber: Number(session.sessionNumber || 0),
          date: String(session.date || "").trim(),
          time: String(session.time || "").trim()
        }))
      : []
  };
}

function normalizeSystemUserPayload(body, options = {}) {
  const allowMissing = Boolean(options.allowMissing);
  const source = body || {};

  return {
    username: allowMissing && source.username == null ? "" : String(source.username || "").trim().toLowerCase(),
    nombre: allowMissing && source.nombre == null ? "" : String(source.nombre || "").trim(),
    role: allowMissing && source.role == null ? "" : String(source.role || "").trim().toUpperCase(),
    password: allowMissing && source.password == null ? "" : String(source.password || ""),
    activo: typeof source.activo === "boolean" ? source.activo : undefined
  };
}

function validatePayload(payload) {
  if (!/^\d{10}$/.test(payload.cedula)) {
    return { ok: false, message: "La cedula debe tener 10 digitos." };
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.nombre)) {
    return { ok: false, message: "El nombre solo permite letras." };
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.apellido)) {
    return { ok: false, message: "El apellido solo permite letras." };
  }

  if (!/^\d{10}$/.test(payload.telefono)) {
    return { ok: false, message: "El telefono debe tener 10 digitos." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.correo)) {
    return { ok: false, message: "El correo no tiene un formato valido." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha)) {
    return { ok: false, message: "La fecha es obligatoria." };
  }

  if (isWeekendDate(payload.fecha)) {
    return { ok: false, message: "Solo se puede agendar de lunes a viernes." };
  }

  if (!AVAILABLE_HOURS.includes(payload.hora)) {
    return { ok: false, message: "La hora seleccionada no es valida." };
  }

  if (payload.observacion && !/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.observacion)) {
    return { ok: false, message: "La observacion solo permite letras." };
  }

  return { ok: true };
}

function validateIntakePayload(payload) {
  if (!/^\d{10}$/.test(payload.cedula)) {
    return { ok: false, message: "La cedula debe tener 10 digitos." };
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.nombre)) {
    return { ok: false, message: "El nombre solo permite letras." };
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.apellido)) {
    return { ok: false, message: "El apellido solo permite letras." };
  }

  if (!/^\d{10}$/.test(payload.telefono)) {
    return { ok: false, message: "El telefono debe tener 10 digitos." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.correo)) {
    return { ok: false, message: "El correo no tiene un formato valido." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha)) {
    return { ok: false, message: "La fecha es obligatoria." };
  }

  if (!/^\d{2}:\d{2}$/.test(payload.hora)) {
    return { ok: false, message: "La hora es obligatoria." };
  }

  if (payload.observacion && !/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.observacion)) {
    return { ok: false, message: "La observacion solo permite letras." };
  }

  return { ok: true };
}

function validateSessionPlanSearch(payload) {
  if (!/^\d{10}$/.test(payload.cedula)) {
    return { ok: false, message: "La cedula debe tener 10 digitos." };
  }

  if (!/^(10|[1-9])$/.test(String(payload.numeroSesiones))) {
    return { ok: false, message: "Selecciona entre 1 y 10 sesiones." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fechaInicial)) {
    return { ok: false, message: "La fecha inicial es obligatoria." };
  }

  if (isWeekendDate(payload.fechaInicial)) {
    return { ok: false, message: "Solo se puede buscar en dias habiles." };
  }

  if (!SESSION_SLOT_OPTIONS.includes(payload.horaInicial)) {
    return { ok: false, message: "La hora inicial debe estar en bloques de 30 minutos." };
  }

  if (!THERAPY_CAPACITY[payload.tipoTerapia]) {
    return { ok: false, message: "Selecciona un tipo de terapia valido." };
  }

  return { ok: true };
}

function validateSessionPlanPayload(payload) {
  const baseValidation = validateSessionPlanSearch(payload);
  if (!baseValidation.ok) {
    return baseValidation;
  }

  if (!/^[A-Z0-9ÁÉÍÓÚÑ ]+$/.test(payload.diagnostico)) {
    return { ok: false, message: "El diagnostico solo permite letras y numeros en mayusculas." };
  }

  if (!payload.observacion) {
    return { ok: false, message: "La observacion es obligatoria." };
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(payload.observacion)) {
    return { ok: false, message: "La observacion solo permite letras." };
  }

  if (!Array.isArray(payload.sesiones) || payload.sesiones.length !== payload.numeroSesiones) {
    return { ok: false, message: "Debes consultar y confirmar las sesiones antes de guardar." };
  }

  for (const session of payload.sesiones) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || !SESSION_SLOT_OPTIONS.includes(session.time)) {
      return { ok: false, message: "Las sesiones seleccionadas no tienen un formato valido." };
    }
  }

  return { ok: true };
}

function validateSystemUserPayload(payload, requirePassword) {
  if (requirePassword && !payload.username) {
    return { ok: false, message: "El nombre de usuario es obligatorio." };
  }

  if (payload.username && !/^[a-z0-9._-]{3,40}$/.test(payload.username)) {
    return { ok: false, message: "El usuario debe tener entre 3 y 40 caracteres validos." };
  }

  if ((requirePassword && !payload.nombre) || (payload.nombre && payload.nombre.length < 3)) {
    return { ok: false, message: "El nombre del usuario es obligatorio." };
  }

  if ((requirePassword && !payload.role) || (payload.role && !["USER", "ADMIN", "SUPERADMIN"].includes(payload.role))) {
    return { ok: false, message: "Selecciona un rol valido." };
  }

  if (requirePassword && String(payload.password || "").length < 6) {
    return { ok: false, message: "La contrasena debe tener al menos 6 caracteres." };
  }

  if (!requirePassword && payload.password && payload.password.length < 6) {
    return { ok: false, message: "La contrasena debe tener al menos 6 caracteres." };
  }

  return { ok: true };
}

function normalizeLetters(value, allowEmpty = false) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!allowEmpty && normalized.length === 0) {
    return "";
  }

  return normalized;
}

function normalizeDiagnosis(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function isWeekendDate(value) {
  const selectedDate = new Date(`${value}T00:00:00`);
  const day = selectedDate.getDay();
  return day === 0 || day === 6;
}

async function findNearestSessions(payload) {
  const preferredMinutes = toMinutes(payload.horaInicial);
  const sessions = [];
  let currentDate = payload.fechaInicial;
  let attempts = 0;

  while (sessions.length < payload.numeroSesiones && attempts < 120) {
    attempts += 1;

    if (isWeekendDate(currentDate)) {
      currentDate = nextBusinessDate(currentDate);
      continue;
    }

    const availableTimes = await getAvailableTimesForDate(currentDate, payload.tipoTerapia, payload.cedula);
    const candidateTimes = filterCandidateTimes(availableTimes, preferredMinutes);

    if (candidateTimes.length > 0) {
      const selectedTime = pickPreferredSessionTime(candidateTimes, payload.horaInicial);
      const occupancyMap = await getOccupancyMapForDate(currentDate, payload.tipoTerapia);

      sessions.push({
        sessionNumber: sessions.length + 1,
        date: currentDate,
        dateLabel: formatDateLabel(currentDate),
        weekdayLabel: formatWeekdayLabel(currentDate),
        selectedTime,
        availableTimes: candidateTimes,
        remainingCapacity: THERAPY_CAPACITY[payload.tipoTerapia] - (occupancyMap.get(selectedTime) || 0)
      });
    }

    currentDate = nextBusinessDate(currentDate);
  }

  return sessions;
}

async function getAvailableTimesForDate(date, therapyType, cedula = "", excludeSessionId = 0) {
  const occupancyMap = await getOccupancyMapForDate(date, therapyType, excludeSessionId);
  const patientOccupiedTimes = cedula
    ? await getPatientOccupiedTimesForDate(cedula, date, excludeSessionId)
    : new Set();

  return SESSION_SLOT_OPTIONS.filter((time) =>
    (occupancyMap.get(time) || 0) < THERAPY_CAPACITY[therapyType] && !patientOccupiedTimes.has(time)
  );
}

async function getOccupancyMapForDate(date, therapyType, excludeSessionId = 0) {
  const params = [date, therapyType];
  let excludeClause = "";

  if (excludeSessionId > 0) {
    params.push(excludeSessionId);
    excludeClause = "AND id <> $3";
  }

  const result = await pool.query(
    `SELECT TO_CHAR(hora, 'HH24:MI') AS hora, COUNT(*)::int AS total
     FROM plan_sesion_detalles
     WHERE fecha = $1 AND tipo_terapia = $2
       ${excludeClause}
     GROUP BY hora`,
    params
  );

  return new Map(result.rows.map((row) => [row.hora, row.total]));
}

async function getPatientOccupiedTimesForDate(cedula, date, excludeSessionId = 0) {
  const params = [cedula, date];
  let excludeClause = "";

  if (excludeSessionId > 0) {
    params.push(excludeSessionId);
    excludeClause = "AND det.id <> $3";
  }

  const result = await pool.query(
    `SELECT TO_CHAR(det.hora, 'HH24:MI') AS hora
     FROM plan_sesion_detalles det
     INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
     WHERE plan.cedula = $1 AND det.fecha = $2
       ${excludeClause}`,
    params
  );

  return new Set(result.rows.map((row) => row.hora));
}

async function findPatientPreferredHourConflicts(cedula, startDate, numberOfSessions, preferredHour) {
  const candidateDates = buildBusinessDates(startDate, numberOfSessions);
  const result = await pool.query(
    `SELECT det.fecha
     FROM plan_sesion_detalles det
     INNER JOIN planes_sesiones plan ON plan.id = det.plan_id
     WHERE plan.cedula = $1
       AND det.fecha = ANY($2::date[])
       AND TO_CHAR(det.hora, 'HH24:MI') = $3`,
    [cedula, candidateDates, preferredHour]
  );

  return result.rows;
}

function filterCandidateTimes(times, preferredMinutes) {
  return [...times]
    .filter((time) => toMinutes(time) >= preferredMinutes)
    .sort((left, right) => {
      const leftDistance = Math.abs(toMinutes(left) - preferredMinutes);
      const rightDistance = Math.abs(toMinutes(right) - preferredMinutes);
      if (leftDistance === rightDistance) {
        return toMinutes(left) - toMinutes(right);
      }
      return leftDistance - rightDistance;
    });
}

function pickPreferredSessionTime(candidateTimes, preferredTime) {
  if (candidateTimes.includes(preferredTime)) {
    return preferredTime;
  }

  return candidateTimes[0];
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours * 60) + minutes;
}

function nextBusinessDate(date) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return formatIsoLocalDate(next);
}

function buildBusinessDates(startDate, numberOfSessions) {
  const dates = [];
  let currentDate = startDate;

  while (dates.length < numberOfSessions) {
    if (!isWeekendDate(currentDate)) {
      dates.push(currentDate);
    }
    currentDate = nextBusinessDate(currentDate);
  }

  return dates;
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(`${date}T00:00:00`));
}

function formatWeekdayLabel(date) {
  const label = new Intl.DateTimeFormat("es-EC", { weekday: "long" })
    .format(new Date(`${date}T00:00:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatIsoLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureSiteContent() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  if (!fs.existsSync(SITE_CONTENT_PATH)) {
    fs.writeFileSync(
      SITE_CONTENT_PATH,
      JSON.stringify(createDefaultSiteContent(), null, 2),
      "utf8"
    );
  }
}

async function bootstrapServer() {
  try {
    await ensureSystemUsers();
    app.listen(PORT, () => {
      console.log(`Servidor activo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("No se pudo inicializar el sistema:", error.message);
    process.exit(1);
  }
}

async function ensureSystemUsers() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios_sistema (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(40) NOT NULL UNIQUE,
      nombre VARCHAR(80) NOT NULL,
      role VARCHAR(20) NOT NULL,
      password_salt VARCHAR(64) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial_accesos (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NULL REFERENCES usuarios_sistema(id) ON UPDATE CASCADE ON DELETE SET NULL,
      username_intento VARCHAR(40) NOT NULL,
      nombre_usuario VARCHAR(80),
      role_usuario VARCHAR(20),
      login_exitoso BOOLEAN NOT NULL DEFAULT FALSE,
      motivo_fallo VARCHAR(120),
      session_token VARCHAR(80),
      fecha_hora_ingreso TIMESTAMP NOT NULL DEFAULT NOW(),
      fecha_hora_cierre TIMESTAMP NULL,
      ultima_actividad TIMESTAMP NULL,
      sesion_activa BOOLEAN NOT NULL DEFAULT FALSE,
      navegador VARCHAR(80),
      sistema_operativo VARCHAR(80),
      direccion_ip VARCHAR(80),
      user_agent TEXT
    )
  `);

  const defaults = [
    { username: "usuario", nombre: "Usuario demo", role: "USER", password: "usuario123" },
    { username: "admin", nombre: "Admin demo", role: "ADMIN", password: "admin123" },
    { username: "superadmin", nombre: "SuperAdmin demo", role: "SUPERADMIN", password: "super123" }
  ];

  for (const user of defaults) {
    const exists = await pool.query(
      `SELECT 1 FROM usuarios_sistema WHERE username = $1`,
      [user.username]
    );

    if (exists.rowCount === 0) {
      const credentials = hashPassword(user.password);
      await pool.query(
        `INSERT INTO usuarios_sistema (username, nombre, role, password_salt, password_hash, activo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.username, user.nombre, user.role, credentials.salt, credentials.hash, true]
      );
    }
  }
}

function generateSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function registerAccessAttempt({ user = null, username = "", successful, failureReason = null, sessionToken = null, clientMeta }) {
  const normalizedUsername = String(username || user?.username || "").trim().toLowerCase() || "desconocido";

  await pool.query(
    `INSERT INTO historial_accesos (
      user_id,
      username_intento,
      nombre_usuario,
      role_usuario,
      login_exitoso,
      motivo_fallo,
      session_token,
      fecha_hora_ingreso,
      fecha_hora_cierre,
      ultima_actividad,
      sesion_activa,
      navegador,
      sistema_operativo,
      direccion_ip,
      user_agent
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13, $14
    )`,
    [
      user?.id || null,
      normalizedUsername,
      user?.nombre || null,
      user?.role || null,
      Boolean(successful),
      failureReason,
      sessionToken,
      successful ? null : new Date(),
      successful ? new Date() : null,
      Boolean(successful),
      clientMeta.browser,
      clientMeta.operatingSystem,
      clientMeta.ipAddress,
      clientMeta.userAgent
    ]
  );
}

async function closeAccessSession(sessionToken, reason = "LOGOUT") {
  const result = await pool.query(
    `UPDATE historial_accesos
     SET sesion_activa = FALSE,
         fecha_hora_cierre = COALESCE(fecha_hora_cierre, NOW()),
         motivo_fallo = CASE
           WHEN login_exitoso THEN COALESCE(motivo_fallo, $2)
           ELSE motivo_fallo
         END
     WHERE session_token = $1
       AND sesion_activa = TRUE`,
    [sessionToken, reason]
  );

  return result.rowCount > 0;
}

async function touchAccessSession(sessionToken) {
  const result = await pool.query(
    `UPDATE historial_accesos
     SET ultima_actividad = NOW()
     WHERE session_token = $1
       AND sesion_activa = TRUE`,
    [sessionToken]
  );

  return result.rowCount > 0;
}

async function cleanupStaleAccessSessions() {
  await pool.query(
    `UPDATE historial_accesos
     SET sesion_activa = FALSE,
         fecha_hora_cierre = COALESCE(fecha_hora_cierre, ultima_actividad, fecha_hora_ingreso),
         motivo_fallo = COALESCE(motivo_fallo, 'SESION_CERRADA_POR_INACTIVIDAD')
     WHERE login_exitoso = TRUE
       AND sesion_activa = TRUE
       AND COALESCE(ultima_actividad, fecha_hora_ingreso) < NOW() - INTERVAL '${SESSION_STALE_MINUTES} minutes'`
  );
}

function getClientMetadata(request) {
  const userAgent = String(request.header("user-agent") || "").trim();
  const parsedUserAgent = parseUserAgent(userAgent);

  return {
    browser: parsedUserAgent.browser,
    operatingSystem: parsedUserAgent.operatingSystem,
    ipAddress: getClientIp(request),
    userAgent
  };
}

function getClientIp(request) {
  const forwardedFor = String(request.header("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  const rawIp = (forwardedFor || request.socket?.remoteAddress || "").replace("::ffff:", "");

  if (!rawIp) {
    return "IP no disponible";
  }

  if (rawIp === "::1" || rawIp === "127.0.0.1") {
    return "127.0.0.1 (localhost)";
  }

  return rawIp;
}

function parseUserAgent(userAgent) {
  const source = String(userAgent || "");
  const browser = /Edg\//.test(source)
    ? "Microsoft Edge"
    : /OPR\//.test(source)
      ? "Opera"
      : /Chrome\//.test(source)
        ? "Google Chrome"
        : /Firefox\//.test(source)
          ? "Mozilla Firefox"
          : /Safari\//.test(source) && !/Chrome\//.test(source)
            ? "Safari"
            : /MSIE|Trident\//.test(source)
              ? "Internet Explorer"
              : "Navegador no identificado";

  const operatingSystem = /Windows NT/.test(source)
    ? "Windows"
    : /Android/.test(source)
      ? "Android"
      : /iPhone|iPad|iPod/.test(source)
        ? "iOS"
        : /Mac OS X/.test(source)
          ? "macOS"
          : /Linux/.test(source)
            ? "Linux"
            : "Sistema no identificado";

  return { browser, operatingSystem };
}

function createDefaultSiteContent() {
  return {
    updatedAt: new Date().toISOString(),
    brand: {
      logoSrc: "/assets/logo.png",
      logoAlt: "Fisio Salud Clinica la Paz"
    },
    popup: {
      enabled: true,
      title: "Bienestar que acompana tu recuperacion",
      text: "Agenda tu valoracion, conoce nuestros programas de rehabilitacion y descubre una experiencia mas cercana, clara y profesional.",
      buttonLabel: "Agenda tu cita",
      imageSrc: "/assets/hero-4.jpg"
    },
    carousel: [
      {
        title: "Dolor de columna",
        caption: "Tratamiento integral enfocado en aliviar el dolor, mejorar la movilidad y acelerar tu recuperacion.",
        imageSrc: "/assets/hero-1.png"
      },
      {
        title: "Bienestar corporativo",
        caption: "Programas para equipos de trabajo con fisioterapia, educacion en salud y acompanamiento preventivo.",
        imageSrc: "/assets/hero-2.png"
      },
      {
        title: "Prevencion inteligente",
        caption: "Planes que combinan evaluacion, seguimiento y ejercicios personalizados para cada etapa.",
        imageSrc: "/assets/hero-5.jpg"
      },
      {
        title: "Recuperacion con metodo",
        caption: "Un enfoque humano y actualizado para rehabilitacion musculoesqueletica y funcional.",
        imageSrc: "/assets/hero-6.jpg"
      }
    ],
    about: {
      title: "Rehabilitacion con criterio clinico y cercania humana",
      text: "Fisio Salud Clinica la Paz acompana procesos de recuperacion fisica, alivio del dolor y prevencion funcional con una experiencia moderna para pacientes particulares, familias y empresas."
    },
    contact: {
      phone: "593-0998545872",
      email: "contacto@fisiosalud.com",
      address: "Viracochabamba 2-84, Clinica La Paz"
    }
  };
}

function readSiteContent() {
  ensureSiteContent();
  const raw = fs.readFileSync(SITE_CONTENT_PATH, "utf8");
  return JSON.parse(raw);
}

function hasRequiredRole(role, minimumRole) {
  return (ROLE_ORDER[role] || 0) >= (ROLE_ORDER[minimumRole] || 0);
}

function normalizeSiteContentPayload(payload, currentContent) {
  const nextBrand = {
    ...currentContent.brand,
    ...(payload.brand || {})
  };
  const nextPopup = {
    ...currentContent.popup,
    ...(payload.popup || {})
  };
  const nextCarousel = Array.isArray(payload.carousel) ? payload.carousel : currentContent.carousel;

  if (payload.brand?.logoUploadDataUrl) {
    nextBrand.logoSrc = saveDataUrlAsset(payload.brand.logoUploadDataUrl, "logo");
  }

  if (payload.popup?.imageUploadDataUrl) {
    nextPopup.imageSrc = saveDataUrlAsset(payload.popup.imageUploadDataUrl, "popup");
  }

  const normalizedCarousel = nextCarousel.slice(0, 4).map((item, index) => {
    const existing = currentContent.carousel[index] || {};
    const nextItem = {
      ...existing,
      ...item
    };

    if (item?.imageUploadDataUrl) {
      nextItem.imageSrc = saveDataUrlAsset(item.imageUploadDataUrl, `slide-${index + 1}`);
    }

    delete nextItem.imageUploadDataUrl;
    return nextItem;
  });

  while (normalizedCarousel.length < 4) {
    normalizedCarousel.push(currentContent.carousel[normalizedCarousel.length]);
  }

  delete nextBrand.logoUploadDataUrl;
  delete nextPopup.imageUploadDataUrl;

  return {
    brand: nextBrand,
    popup: nextPopup,
    carousel: normalizedCarousel,
    about: {
      ...currentContent.about,
      ...(payload.about || {})
    },
    contact: {
      ...currentContent.contact,
      ...(payload.contact || {})
    }
  };
}

function saveDataUrlAsset(dataUrl, filePrefix) {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Formato de imagen no valido.");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const extension = mimeTypeToExtension(mimeType);
  const fileName = `${filePrefix}-${Date.now()}.${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
  return `/uploads/${fileName}`;
}

function mimeTypeToExtension(mimeType) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/gif": "gif",
    "image/avif": "avif"
  };

  return map[mimeType] || "png";
}

function getMailTransporter() {
  if (!SMTP_ENABLED || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  if (!mailTransporter) {
    mailTransporter = createMailTransporter({
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      requireTLS: !SMTP_SECURE
    });
  }

  return mailTransporter;
}

function createMailTransporter({ port, secure, requireTLS = false }) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    family: 4,
    requireTLS,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      servername: SMTP_HOST
    },
    lookup(hostname, _options, callback) {
      dns.lookup(hostname, { family: 4, all: false }, callback);
    },
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function getMailErrorDetails(error) {
  return [
    error && error.code ? `code=${error.code}` : "",
    error && error.command ? `command=${error.command}` : "",
    error && error.responseCode ? `responseCode=${error.responseCode}` : "",
    error && error.response ? `response=${error.response}` : "",
    error && error.message ? `message=${error.message}` : ""
  ].filter(Boolean).join(" | ");
}

function shouldRetryMailWithTlsFallback(error) {
  if (SMTP_PORT !== 465 || !SMTP_SECURE) {
    return false;
  }

  const retryableCodes = new Set([
    "ESOCKET",
    "ECONNECTION",
    "ETIMEDOUT",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENOTFOUND"
  ]);

  return retryableCodes.has(error && error.code);
}

async function sendMailWithFallback(message) {
  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  try {
    await transporter.sendMail(message);
    return { ok: true };
  } catch (error) {
    if (!shouldRetryMailWithTlsFallback(error)) {
      return { ok: false, reason: "send-error", details: getMailErrorDetails(error) };
    }

    try {
      const fallbackTransporter = createMailTransporter({
        port: 587,
        secure: false,
        requireTLS: true
      });
      await fallbackTransporter.sendMail(message);
      console.info("Correo enviado usando fallback SMTP 587/STARTTLS.");
      return { ok: true };
    } catch (fallbackError) {
      return {
        ok: false,
        reason: "send-error",
        details: `primary(${getMailErrorDetails(error)}) | fallback(${getMailErrorDetails(fallbackError)})`
      };
    }
  }
}

function getTwilioClient() {
  if (!TWILIO_ENABLED || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return null;
  }

  if (!twilioClient) {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }

  return twilioClient;
}

function isMetaWhatsappConfigured() {
  return Boolean(
    META_WHATSAPP_ENABLED &&
    META_WHATSAPP_PHONE_NUMBER_ID &&
    META_WHATSAPP_ACCESS_TOKEN
  );
}

async function sendMetaTemplateMessage({ phone, templateName, parameters }) {
  if (!isMetaWhatsappConfigured()) {
    return { ok: false, reason: "meta-disabled" };
  }

  const toNumber = formatMetaWhatsappNumber(phone);
  if (!toNumber) {
    return { ok: false, reason: "invalid-phone" };
  }

  if (!templateName) {
    return { ok: false, reason: "missing-template" };
  }

  const bodyParameters = (parameters || []).map((value) => ({
    type: "text",
    text: String(value ?? "").trim() || "-"
  }));

  try {
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toNumber,
      type: "template",
      template: {
        name: templateName,
        language: {
          policy: "deterministic",
          code: META_TEMPLATE_LANGUAGE
        },
        components: [
          {
            type: "body",
            parameters: bodyParameters
          }
        ]
      }
    };

    const apiResponse = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${META_WHATSAPP_ACCESS_TOKEN}`
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error("Meta WhatsApp API respondio con error:", JSON.stringify({
        status: apiResponse.status,
        templateName,
        language: META_TEMPLATE_LANGUAGE,
        to: toNumber,
        response: errorBody
      }));
      return { ok: false, reason: "send-error" };
    }

    const successBody = await apiResponse.text();
    console.log("Meta WhatsApp enviado correctamente:", JSON.stringify({
      templateName,
      language: META_TEMPLATE_LANGUAGE,
      to: toNumber,
      response: successBody
    }));

    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el mensaje por Meta WhatsApp:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

async function runReminderJobs() {
  if (remindersRunning) {
    return;
  }

  remindersRunning = true;

  try {
    await processDayBeforeEmailReminders();
    await processThreeHoursWhatsappReminders();
  } finally {
    remindersRunning = false;
  }
}

async function processDayBeforeEmailReminders() {
  const now = new Date();
  const currentTime = formatTimeInTimeZone(now, CLINIC_TIME_ZONE);

  if (currentTime < "19:00") {
    return;
  }

  const today = formatDateInTimeZone(now, CLINIC_TIME_ZONE);
  const targetDate = addDaysToIsoDate(today, 1);

  const result = await pool.query(
    `SELECT c.id,
            c.cedula,
            p.nombre,
            p.apellido,
            p.telefono,
            p.correo,
            c.observacion,
            TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
            TO_CHAR(c.hora, 'HH24:MI') AS hora
     FROM citas c
     INNER JOIN pacientes p ON p.cedula = c.cedula
     WHERE c.fecha = $1
       AND c.reminder_email_sent_at IS NULL
     ORDER BY c.hora ASC`,
    [targetDate]
  );

  for (const appointment of result.rows) {
    const sendResult = await sendAppointmentReminderEmail(appointment);
    if (sendResult.ok) {
      await markReminderSent(appointment.id, "email");
    }
  }
}

async function processThreeHoursWhatsappReminders() {
  const now = new Date();
  const nowMs = now.getTime();
  const today = formatDateInTimeZone(now, CLINIC_TIME_ZONE);
  const tomorrow = addDaysToIsoDate(today, 1);

  const result = await pool.query(
    `SELECT c.id,
            c.cedula,
            p.nombre,
            p.apellido,
            p.telefono,
            p.correo,
            c.observacion,
            c.created_at,
            TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
            TO_CHAR(c.hora, 'HH24:MI') AS hora
     FROM citas c
     INNER JOIN pacientes p ON p.cedula = c.cedula
     WHERE c.fecha BETWEEN $1 AND $2
       AND c.reminder_whatsapp_sent_at IS NULL
     ORDER BY c.fecha ASC, c.hora ASC`,
    [today, tomorrow]
  );

  for (const appointment of result.rows) {
    const appointmentMs = localDateTimeToUtcMs(appointment.fecha, appointment.hora, CLINIC_UTC_OFFSET_HOURS);
    const reminderMs = appointmentMs - (3 * 60 * 60 * 1000);
    const createdAtMs = new Date(appointment.created_at).getTime();

    // Si la cita fue creada despues de la hora en que debia salir el recordatorio,
    // no se envia el recordatorio inmediato para evitar duplicar el aviso inicial.
    if (createdAtMs > reminderMs) {
      continue;
    }

    if (nowMs >= reminderMs && nowMs < appointmentMs) {
      const sendResult = await sendAppointmentReminderWhatsapp(appointment);
      if (sendResult.ok) {
        await markReminderSent(appointment.id, "whatsapp");
      }
    }
  }
}

async function markReminderSent(appointmentId, type) {
  const column = type === "email" ? "reminder_email_sent_at" : "reminder_whatsapp_sent_at";
  await pool.query(
    `UPDATE citas
     SET ${column} = NOW()
     WHERE id = $1`,
    [appointmentId]
  );
}

async function sendAppointmentConfirmationEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Tu cita ha sido agendada correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Fecha: ${formattedDate}`,
    `Hora: ${payload.hora}`,
    `Cedula: ${payload.cedula}`,
    `Observacion: ${observationText}`,
    "",
    "Te esperamos."
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Confirmacion de cita</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    Tu cita ha sido agendada correctamente. Te compartimos el detalle de tu reserva en
                    <strong>Fisio Salud Clinica la Paz</strong>.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle de la cita</td>
                            <td align="right" style="padding:0 0 16px;">
                              <span style="display:inline-block; padding:8px 14px; border-radius:999px; background:#dfeaff; color:#0b4ab3; font-size:12px; font-weight:700;">Reserva confirmada</span>
                            </td>
                          </tr>
                          <tr>
                            <td colspan="2" style="padding:0;">
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                                <tr>
                                  <td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(formattedDate)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Cedula</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.cedula)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Observacion</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(observationText)}</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse; margin:0 0 24px;">
                    <tr>
                      <td style="border-radius:14px; background:#0f62fe;">
                        <a href="https://www.facebook.com/fisiolapaz" style="display:inline-block; padding:14px 22px; font-family:Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">
                          Contacto e informacion
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0; font-size:16px; line-height:1.7; color:#32415f;">
                    Gracias por confiar en nosotros. Te esperamos para acompanarte en tu proceso de recuperacion.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  const result = await sendMailWithFallback({
    from: SMTP_FROM,
    to: payload.correo,
    subject: "Confirmacion de cita - Fisio Salud Clinica la Paz",
    text,
    html,
    attachments: fs.existsSync(logoPath)
      ? [
          {
            filename: "logo.png",
            path: logoPath,
            cid: logoCid
          }
        ]
      : []
  });

  if (!result.ok) {
    console.error("No se pudo enviar el correo de confirmacion:", result.details || result.reason || "unknown");
  }

  return result;
}

function queueAppointmentConfirmationEmail(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentConfirmationEmail(payload);
    if (!result.ok) {
      console.error("La cita se guardo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendAppointmentReminderEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-reminder-email";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Te recordamos que manana tienes una cita agendada en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Fecha: ${formattedDate}`,
    `Hora: ${payload.hora}`,
    `Cedula: ${payload.cedula}`,
    `Observacion: ${observationText}`
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Recordatorio de cita</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    Este es un recordatorio de tu cita programada para manana en <strong>Fisio Salud Clinica la Paz</strong>.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr><td style="padding:24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                        <tr><td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle del recordatorio</td></tr>
                        <tr><td colspan="2" style="padding:0;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                            <tr><td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(formattedDate)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Cedula</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.cedula)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Observacion</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(observationText)}</td></tr>
                          </table>
                        </td></tr>
                      </table>
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Recordatorio de cita - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath) ? [{ filename: "logo.png", path: logoPath, cid: logoCid }] : []
    });
    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo recordatorio:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

async function sendAppointmentWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_CONFIRMACION_CITA,
    parameters: [patientName, formattedDate, payload.hora, observationText]
  });
}

function queueAppointmentWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentWhatsappMessage(payload);
    if (!result.ok) {
      console.error("La cita se guardo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendAppointmentReminderWhatsapp(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_RECORDATORIO_CITA,
    parameters: [patientName, formattedDate, payload.hora, observationText]
  });
}

async function sendAppointmentRescheduleEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const oldFormattedDate = formatLongDate(payload.oldFecha);
  const newFormattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-reschedule";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Tu cita fue reagendada correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Nueva fecha: ${newFormattedDate}`,
    `Nueva hora: ${payload.hora}`,
    `Fecha anterior: ${oldFormattedDate}`,
    `Hora anterior: ${payload.oldHora}`,
    `Cedula: ${payload.cedula}`,
    `Observacion: ${observationText}`,
    "",
    "Te esperamos."
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Reagendamiento de cita</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    Tu cita fue reagendada correctamente. Este es el nuevo horario registrado en
                    <strong>Fisio Salud Clinica la Paz</strong>.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Nuevo detalle de la cita</td>
                            <td align="right" style="padding:0 0 16px;">
                              <span style="display:inline-block; padding:8px 14px; border-radius:999px; background:#dfeaff; color:#0b4ab3; font-size:12px; font-weight:700;">Cambio confirmado</span>
                            </td>
                          </tr>
                          <tr>
                            <td colspan="2" style="padding:0;">
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                                <tr>
                                  <td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Nueva fecha</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(newFormattedDate)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Nueva hora</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha anterior</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(oldFormattedDate)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora anterior</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.oldHora)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Cedula</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.cedula)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Observacion</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(observationText)}</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0; font-size:16px; line-height:1.7; color:#32415f;">
                    Gracias por informarte con nosotros. Te esperamos en tu nuevo horario.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Cita reagendada - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath)
        ? [
            {
              filename: "logo.png",
              path: logoPath,
              cid: logoCid
            }
          ]
        : []
    });

    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo de reagendamiento:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

function queueAppointmentRescheduleEmail(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentRescheduleEmail(payload);
    if (!result.ok) {
      console.error("La cita se reprogramo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendAppointmentRescheduleWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const oldFormattedDate = formatLongDate(payload.oldFecha);
  const newFormattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_REAGENDAMIENTO_CITA,
    parameters: [
      patientName,
      newFormattedDate,
      payload.hora,
      oldFormattedDate,
      payload.oldHora,
      observationText
    ]
  });
}

function queueAppointmentRescheduleWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentRescheduleWhatsappMessage(payload);
    if (!result.ok) {
      console.error("La cita se reagendo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendAppointmentCancellationEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-cancel";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Tu cita fue cancelada correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Fecha cancelada: ${formattedDate}`,
    `Hora cancelada: ${payload.hora}`,
    `Cedula: ${payload.cedula}`,
    `Observacion: ${observationText}`
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Cancelacion de cita</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    Te confirmamos que tu cita fue cancelada correctamente en <strong>Fisio Salud Clinica la Paz</strong>.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle de la cancelacion</td>
                            <td align="right" style="padding:0 0 16px;">
                              <span style="display:inline-block; padding:8px 14px; border-radius:999px; background:#ffe3e0; color:#b42318; font-size:12px; font-weight:700;">Cita cancelada</span>
                            </td>
                          </tr>
                          <tr>
                            <td colspan="2" style="padding:0;">
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                                <tr>
                                  <td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha cancelada</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(formattedDate)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora cancelada</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Cedula</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.cedula)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Observacion</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(observationText)}</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0; font-size:16px; line-height:1.7; color:#32415f;">
                    Si deseas una nueva reserva, puedes volver a agendar en el horario que mas te convenga.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Cita cancelada - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath)
        ? [
            {
              filename: "logo.png",
              path: logoPath,
              cid: logoCid
            }
          ]
        : []
    });

    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo de cancelacion:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

function queueAppointmentCancellationEmail(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentCancellationEmail(payload);
    if (!result.ok) {
      console.error("La cita se cancelo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendAppointmentCancellationWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const observationText = payload.observacion || "Sin observacion registrada.";
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_CANCELACION_CITA,
    parameters: [patientName, formattedDate, payload.hora, observationText]
  });
}

function queueAppointmentCancellationWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendAppointmentCancellationWhatsappMessage(payload);
    if (!result.ok) {
      console.error("La cita se cancelo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionRescheduleEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const oldFormattedDate = formatLongDate(payload.oldFecha);
  const newFormattedDate = formatLongDate(payload.fecha);
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-session-reschedule";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Una sesion de tu plan fue reagendada correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Sesion: ${payload.sessionNumber}`,
    `Tipo de terapia: ${payload.tipoTerapia}`,
    `Diagnostico: ${payload.diagnostico}`,
    `Nueva fecha: ${newFormattedDate}`,
    `Nueva hora: ${payload.hora}`,
    `Fecha anterior: ${oldFormattedDate}`,
    `Hora anterior: ${payload.oldHora}`,
    `Cedula: ${payload.cedula}`
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Reagendamiento de sesion</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    La sesion <strong>${escapeHtml(payload.sessionNumber)}</strong> de tu plan fue reagendada correctamente.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle de la sesion</td>
                          </tr>
                          <tr><td colspan="2" style="padding:0;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                              <tr><td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Sesion</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.sessionNumber)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Tipo de terapia</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.tipoTerapia)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Diagnostico</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.diagnostico)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Nueva fecha</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(newFormattedDate)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Nueva hora</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha anterior</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(oldFormattedDate)}</td></tr>
                              <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora anterior</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.oldHora)}</td></tr>
                            </table>
                          </td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Sesion reagendada - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath) ? [{ filename: "logo.png", path: logoPath, cid: logoCid }] : []
    });
    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo de reagendamiento de sesion:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

function queueSessionRescheduleEmail(payload) {
  setImmediate(async () => {
    const result = await sendSessionRescheduleEmail(payload);
    if (!result.ok) {
      console.error("La sesion se reagendo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionRescheduleWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const oldFormattedDate = formatLongDate(payload.oldFecha);
  const newFormattedDate = formatLongDate(payload.fecha);
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_REAGENDAMIENTO_SESION,
    parameters: [
      patientName,
      payload.sessionNumber,
      payload.tipoTerapia,
      payload.diagnostico,
      newFormattedDate,
      payload.hora,
      oldFormattedDate,
      payload.oldHora
    ]
  });
}

function queueSessionRescheduleWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendSessionRescheduleWhatsappMessage(payload);
    if (!result.ok) {
      console.error("La sesion se reagendo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionCancellationEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-session-cancel";

  const text = [
    `Hola ${patientName}.`,
    "",
    "Una sesion de tu plan fue cancelada correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Sesion: ${payload.sessionNumber}`,
    `Tipo de terapia: ${payload.tipoTerapia}`,
    `Diagnostico: ${payload.diagnostico}`,
    `Fecha cancelada: ${formattedDate}`,
    `Hora cancelada: ${payload.hora}`
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Cancelacion de sesion</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    La sesion <strong>${escapeHtml(payload.sessionNumber)}</strong> de tu plan fue cancelada correctamente.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr><td style="padding:24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                        <tr><td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle de la sesion</td></tr>
                        <tr><td colspan="2" style="padding:0;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                            <tr><td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Sesion</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.sessionNumber)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Tipo de terapia</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.tipoTerapia)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Diagnostico</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.diagnostico)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha cancelada</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(formattedDate)}</td></tr>
                            <tr><td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora cancelada</td><td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.hora)}</td></tr>
                          </table>
                        </td></tr>
                      </table>
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Sesion cancelada - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath) ? [{ filename: "logo.png", path: logoPath, cid: logoCid }] : []
    });
    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo de cancelacion de sesion:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

function queueSessionCancellationEmail(payload) {
  setImmediate(async () => {
    const result = await sendSessionCancellationEmail(payload);
    if (!result.ok) {
      console.error("La sesion se cancelo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionCancellationWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedDate = formatLongDate(payload.fecha);
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_CANCELACION_SESION,
    parameters: [
      patientName,
      payload.sessionNumber,
      payload.tipoTerapia,
      payload.diagnostico,
      formattedDate,
      payload.hora
    ]
  });
}

function queueSessionCancellationWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendSessionCancellationWhatsappMessage(payload);
    if (!result.ok) {
      console.error("La sesion se cancelo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionPlanConfirmationEmail(payload) {
  if (!payload.correo) {
    return { ok: false, reason: "missing-email" };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { ok: false, reason: "mail-disabled" };
  }

  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedStartDate = formatLongDate(payload.fechaInicial);
  const observationText = payload.observacion || "Sin observacion registrada.";
  const logoPath = path.join(__dirname, "assets", "logo.png");
  const logoCid = "fisiosalud-logo-session-plan";
  const sessions = Array.isArray(payload.sesiones) ? payload.sesiones : [];

  const sessionsText = sessions
    .map((session) => `Sesion ${session.sessionNumber}: ${formatLongDate(session.date)} - ${session.time}`)
    .join("\n");

  const sessionsRows = sessions
    .map((session) => `
      <tr>
        <td style="padding:10px 0; color:#607089; font-size:14px; font-weight:700; border-top:1px solid #e4edff;">Sesion ${escapeHtml(session.sessionNumber)}</td>
        <td style="padding:10px 0; color:#162033; font-size:14px; border-top:1px solid #e4edff;">${escapeHtml(formatLongDate(session.date))}</td>
        <td style="padding:10px 0; color:#162033; font-size:14px; border-top:1px solid #e4edff;">${escapeHtml(session.time)}</td>
      </tr>
    `)
    .join("");

  const text = [
    `Hola ${patientName}.`,
    "",
    "Tu plan de sesiones fue agendado correctamente en Fisio Salud Clinica la Paz Lcda. Karen Jaime.",
    `Numero de sesiones: ${payload.numeroSesiones}`,
    `Tipo de terapia: ${payload.tipoTerapia}`,
    `Diagnostico: ${payload.diagnostico}`,
    `Fecha inicial: ${formattedStartDate}`,
    `Hora inicial: ${payload.horaInicial}`,
    `Cedula: ${payload.cedula}`,
    `Observacion: ${observationText}`,
    "",
    "Detalle de sesiones:",
    sessionsText,
    "",
    "Te esperamos."
  ].join("\n");

  const html = `
    <div style="margin:0; padding:32px 0; background:#edf4ff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px; max-width:680px; border-collapse:collapse; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 18px 44px rgba(22,32,51,0.12);">
              <tr>
                <td style="padding:28px 32px; background:linear-gradient(135deg,#0f4db8 0%,#2ca7e0 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle; width:120px;">
                        <img src="cid:${logoCid}" alt="Fisio Salud" width="98" style="display:block; width:98px; height:auto; border:0;">
                      </td>
                      <td style="vertical-align:middle; color:#ffffff; font-family:Arial,sans-serif;">
                        <div style="font-size:13px; letter-spacing:1.6px; text-transform:uppercase; opacity:0.9; margin-bottom:8px;">Plan de sesiones confirmado</div>
                        <div style="font-size:29px; line-height:1.1; font-weight:700;">Fisio Salud Clinica la Paz</div>
                        <div style="font-size:16px; line-height:1.5; opacity:0.92; margin-top:8px;">Lcda. Karen Jaime</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:32px; font-family:Arial,sans-serif; color:#162033;">
                  <p style="margin:0 0 12px; font-size:18px; line-height:1.6;">Hola <strong>${escapeHtml(patientName)}</strong>,</p>
                  <p style="margin:0 0 24px; font-size:17px; line-height:1.7; color:#32415f;">
                    Tu plan de sesiones fue agendado correctamente. Aqui tienes el resumen del tratamiento programado en
                    <strong>Fisio Salud Clinica la Paz</strong>.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#f7faff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 16px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Resumen del plan</td>
                            <td align="right" style="padding:0 0 16px;">
                              <span style="display:inline-block; padding:8px 14px; border-radius:999px; background:#dfeaff; color:#0b4ab3; font-size:12px; font-weight:700;">${escapeHtml(payload.numeroSesiones)} sesiones</span>
                            </td>
                          </tr>
                          <tr>
                            <td colspan="2" style="padding:0;">
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                                <tr>
                                  <td style="width:34%; padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Tipo de terapia</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.tipoTerapia)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Diagnostico</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.diagnostico)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Fecha inicial</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(formattedStartDate)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Hora inicial</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.horaInicial)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Cedula</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(payload.cedula)}</td>
                                </tr>
                                <tr>
                                  <td style="padding:11px 0; color:#607089; font-size:15px; font-weight:700; border-top:1px solid #e4edff;">Observacion</td>
                                  <td style="padding:11px 0; color:#162033; font-size:15px; border-top:1px solid #e4edff;">${escapeHtml(observationText)}</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; border-spacing:0; margin:0 0 24px; background:#ffffff; border:1px solid #d9e6ff; border-radius:20px;">
                    <tr>
                      <td style="padding:24px;">
                        <div style="margin:0 0 14px; font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#0f62fe; font-weight:700;">Detalle de sesiones</div>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                          <tr>
                            <td style="padding:0 0 10px; color:#607089; font-size:13px; font-weight:700;">Sesion</td>
                            <td style="padding:0 0 10px; color:#607089; font-size:13px; font-weight:700;">Dia</td>
                            <td style="padding:0 0 10px; color:#607089; font-size:13px; font-weight:700;">Hora</td>
                          </tr>
                          ${sessionsRows}
                        </table>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0; font-size:16px; line-height:1.7; color:#32415f;">
                    Conserva este correo como referencia de tu tratamiento. Te esperamos en las fechas programadas.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: payload.correo,
      subject: "Plan de sesiones confirmado - Fisio Salud Clinica la Paz",
      text,
      html,
      attachments: fs.existsSync(logoPath)
        ? [
            {
              filename: "logo.png",
              path: logoPath,
              cid: logoCid
            }
          ]
        : []
    });

    return { ok: true };
  } catch (error) {
    console.error("No se pudo enviar el correo del plan de sesiones:", error.message);
    return { ok: false, reason: "send-error" };
  }
}

function queueSessionPlanConfirmationEmail(payload) {
  setImmediate(async () => {
    const result = await sendSessionPlanConfirmationEmail(payload);
    if (!result.ok) {
      console.error("El plan se guardo, pero el correo no pudo enviarse.", result.reason || "unknown");
    }
  });
}

async function sendSessionPlanWhatsappMessage(payload) {
  const patientName = `${payload.nombre} ${payload.apellido}`.trim();
  const formattedStartDate = formatLongDate(payload.fechaInicial);
  return sendMetaTemplateMessage({
    phone: payload.telefono,
    templateName: META_TEMPLATE_CONFIRMACION_PLAN,
    parameters: [
      patientName,
      payload.numeroSesiones,
      payload.tipoTerapia,
      payload.diagnostico,
      formattedStartDate,
      payload.horaInicial
    ]
  });
}

function queueSessionPlanWhatsappMessage(payload) {
  setImmediate(async () => {
    const result = await sendSessionPlanWhatsappMessage(payload);
    if (!result.ok) {
      console.error("El plan se guardo, pero el WhatsApp no pudo enviarse.", result.reason || "unknown");
    }
  });
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("es-EC", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function formatTimeInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return formatter.format(date);
}

function addDaysToIsoDate(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function localDateTimeToUtcMs(dateStr, timeStr, utcOffsetHours) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hour, minute] = String(timeStr).split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour - utcOffsetHours, minute || 0, 0, 0);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMetaWhatsappNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (/^593\d{9}$/.test(digits)) {
    return digits;
  }

  if (/^0\d{9}$/.test(digits)) {
    return `593${digits.slice(1)}`;
  }

  if (/^\d{10}$/.test(digits)) {
    return `593${digits.slice(1)}`;
  }

  return "";
}

function formatWhatsappNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (/^593\d{9}$/.test(digits)) {
    return `whatsapp:+${digits}`;
  }

  if (/^0\d{9}$/.test(digits)) {
    return `whatsapp:+593${digits.slice(1)}`;
  }

  if (/^\d{10}$/.test(digits)) {
    return `whatsapp:+593${digits.slice(1)}`;
  }

  return "";
}
