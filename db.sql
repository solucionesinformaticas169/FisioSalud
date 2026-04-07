CREATE TABLE IF NOT EXISTS pacientes (
  cedula VARCHAR(10) PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL,
  apellido VARCHAR(40) NOT NULL,
  telefono VARCHAR(10) NOT NULL,
  correo VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
);

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
);

CREATE TABLE IF NOT EXISTS citas (
  id BIGSERIAL PRIMARY KEY,
  cedula VARCHAR(10) NOT NULL REFERENCES pacientes(cedula) ON UPDATE CASCADE ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'WEB',
  observacion VARCHAR(160),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingresos_paciente (
  id BIGSERIAL PRIMARY KEY,
  cedula VARCHAR(10) NOT NULL REFERENCES pacientes(cedula) ON UPDATE CASCADE ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'INGRESO',
  observacion VARCHAR(160),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planes_sesiones (
  id BIGSERIAL PRIMARY KEY,
  cedula VARCHAR(10) NOT NULL REFERENCES pacientes(cedula) ON UPDATE CASCADE ON DELETE RESTRICT,
  diagnostico VARCHAR(100) NOT NULL,
  numero_sesiones INTEGER NOT NULL,
  fecha_inicial DATE NOT NULL,
  hora_inicial TIME NOT NULL,
  tipo_terapia VARCHAR(30) NOT NULL,
  observacion VARCHAR(160),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_sesion_detalles (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES planes_sesiones(id) ON DELETE CASCADE,
  numero_sesion INTEGER NOT NULL,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  tipo_terapia VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'WEB';

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS estado_atencion VARCHAR(20) NOT NULL DEFAULT 'NO_ATENDIDO';

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS reminder_email_sent_at TIMESTAMP NULL;

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS reminder_whatsapp_sent_at TIMESTAMP NULL;

ALTER TABLE ingresos_paciente
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'INGRESO';

ALTER TABLE plan_sesion_detalles
  ADD COLUMN IF NOT EXISTS tipo_terapia VARCHAR(30) NOT NULL DEFAULT 'CAMILLA';

ALTER TABLE plan_sesion_detalles
  ADD COLUMN IF NOT EXISTS estado_atencion VARCHAR(20) NOT NULL DEFAULT 'NO_ATENDIDO';

ALTER TABLE pacientes
  DROP CONSTRAINT IF EXISTS pacientes_cedula_chk,
  DROP CONSTRAINT IF EXISTS pacientes_telefono_chk,
  DROP CONSTRAINT IF EXISTS pacientes_correo_chk;

ALTER TABLE usuarios_sistema
  DROP CONSTRAINT IF EXISTS usuarios_sistema_role_chk;

ALTER TABLE historial_accesos
  DROP CONSTRAINT IF EXISTS historial_accesos_role_chk;

ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_cedula_chk CHECK (cedula ~ '^[0-9]{10}$'),
  ADD CONSTRAINT pacientes_telefono_chk CHECK (telefono ~ '^[0-9]{10}$'),
  ADD CONSTRAINT pacientes_correo_chk CHECK (correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

ALTER TABLE usuarios_sistema
  ADD CONSTRAINT usuarios_sistema_role_chk CHECK (
    role IN ('USER', 'ADMIN', 'SUPERADMIN')
  );

ALTER TABLE historial_accesos
  ADD CONSTRAINT historial_accesos_role_chk CHECK (
    role_usuario IS NULL OR role_usuario IN ('USER', 'ADMIN', 'SUPERADMIN')
  );

ALTER TABLE citas
  DROP CONSTRAINT IF EXISTS citas_hora_unica,
  DROP CONSTRAINT IF EXISTS citas_hora_chk,
  DROP CONSTRAINT IF EXISTS citas_observacion_chk,
  DROP CONSTRAINT IF EXISTS citas_origen_chk,
  DROP CONSTRAINT IF EXISTS citas_estado_chk;

ALTER TABLE ingresos_paciente
  DROP CONSTRAINT IF EXISTS ingresos_paciente_observacion_chk,
  DROP CONSTRAINT IF EXISTS ingresos_paciente_origen_chk;

ALTER TABLE planes_sesiones
  DROP CONSTRAINT IF EXISTS planes_sesiones_numero_chk,
  DROP CONSTRAINT IF EXISTS planes_sesiones_tipo_chk,
  DROP CONSTRAINT IF EXISTS planes_sesiones_observacion_chk,
  DROP CONSTRAINT IF EXISTS planes_sesiones_diagnostico_chk;

ALTER TABLE plan_sesion_detalles
  DROP CONSTRAINT IF EXISTS plan_sesion_detalles_tipo_chk,
  DROP CONSTRAINT IF EXISTS plan_sesion_detalles_estado_chk;

ALTER TABLE citas
  ADD CONSTRAINT citas_hora_unica UNIQUE (fecha, hora),
  ADD CONSTRAINT citas_hora_chk CHECK (
    hora IN (
      TIME '08:00',
      TIME '09:00',
      TIME '10:00',
      TIME '11:00',
      TIME '12:00',
      TIME '15:00',
      TIME '16:00',
      TIME '17:00',
      TIME '18:00'
    )
  ),
  ADD CONSTRAINT citas_origen_chk CHECK (
    origen IN ('WEB', 'INGRESO')
  ),
  ADD CONSTRAINT citas_estado_chk CHECK (
    estado_atencion IN ('ATENDIDO', 'NO_ATENDIDO')
  ),
  ADD CONSTRAINT citas_observacion_chk CHECK (
    observacion IS NULL OR observacion ~ '^[A-Z ]+$'
  );

ALTER TABLE ingresos_paciente
  ADD CONSTRAINT ingresos_paciente_origen_chk CHECK (
    origen IN ('INGRESO', 'WEB')
  ),
  ADD CONSTRAINT ingresos_paciente_observacion_chk CHECK (
    observacion IS NULL OR observacion ~ '^[A-Z ]+$'
  );

ALTER TABLE planes_sesiones
  ADD CONSTRAINT planes_sesiones_numero_chk CHECK (
    numero_sesiones BETWEEN 1 AND 10
  ),
  ADD CONSTRAINT planes_sesiones_tipo_chk CHECK (
    tipo_terapia IN ('CAMILLA', 'RODILLA_TOBILLO', 'HOMBRO_CODO_MANO')
  ),
  ADD CONSTRAINT planes_sesiones_observacion_chk CHECK (
    observacion IS NULL OR observacion ~ '^[A-Z ]+$'
  ),
  ADD CONSTRAINT planes_sesiones_diagnostico_chk CHECK (
    diagnostico ~ '^[A-Z0-9 ]+$'
  );

ALTER TABLE plan_sesion_detalles
  ADD CONSTRAINT plan_sesion_detalles_tipo_chk CHECK (
    tipo_terapia IN ('CAMILLA', 'RODILLA_TOBILLO', 'HOMBRO_CODO_MANO')
  ),
  ADD CONSTRAINT plan_sesion_detalles_estado_chk CHECK (
    estado_atencion IN ('ATENDIDO', 'NO_ATENDIDO')
  );

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pacientes_set_updated_at ON pacientes;
DROP TRIGGER IF EXISTS usuarios_sistema_set_updated_at ON usuarios_sistema;

CREATE TRIGGER pacientes_set_updated_at
BEFORE UPDATE ON pacientes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER usuarios_sistema_set_updated_at
BEFORE UPDATE ON usuarios_sistema
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO pacientes (cedula, nombre, apellido, telefono, correo)
VALUES
  ('0912345678', 'MARIA', 'LOPEZ', '0998765432', 'maria.lopez@email.com'),
  ('0923456789', 'CARLOS', 'PEREZ', '0987654321', 'carlos.perez@email.com')
ON CONFLICT (cedula) DO NOTHING;
