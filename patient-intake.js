const intakeForm = document.querySelector("#patient-intake-form");
const intakeFields = {
  cedula: document.querySelector("#cedula"),
  nombre: document.querySelector("#nombre"),
  apellido: document.querySelector("#apellido"),
  telefono: document.querySelector("#telefono"),
  correo: document.querySelector("#correo"),
  fecha: document.querySelector("#fecha"),
  fechaDisplay: document.querySelector("#fecha-display"),
  hora: document.querySelector("#hora"),
  horaDisplay: document.querySelector("#hora-display"),
  observacion: document.querySelector("#observacion")
};

const intakeLookupMessage = document.querySelector("#lookup-message");
const intakeFormMessage = document.querySelector("#form-message");
const intakeSubmitButton = document.querySelector("#submit-button");

let lastIntakeLookupValue = "";

setCurrentDateTime();

intakeFields.cedula.addEventListener("input", handleIntakeCedulaInput);
intakeFields.cedula.addEventListener("paste", handleIntakeCedulaPaste);
intakeFields.telefono.addEventListener("input", () => {
  intakeFields.telefono.value = onlyDigits(intakeFields.telefono.value).slice(0, 10);
});

["nombre", "apellido", "observacion"].forEach((fieldName) => {
  intakeFields[fieldName].addEventListener("input", () => {
    intakeFields[fieldName].value = normalizeLetters(intakeFields[fieldName].value);
  });
});

intakeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearIntakeMessages();
  setCurrentDateTime();

  if (!validateIntakeForm()) {
    setIntakeFormMessage("Corrige los campos marcados para continuar.", "error");
    return;
  }

  const payload = {
    cedula: intakeFields.cedula.value.trim(),
    nombre: intakeFields.nombre.value.trim(),
    apellido: intakeFields.apellido.value.trim(),
    telefono: intakeFields.telefono.value.trim(),
    correo: intakeFields.correo.value.trim().toLowerCase(),
    fecha: intakeFields.fecha.value,
    hora: intakeFields.hora.value,
    observacion: intakeFields.observacion.value.trim()
  };

  try {
    setIntakeSubmitState(true);
    const response = await fetch("/api/patient-intakes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      setIntakeFormMessage(result.message || "No se pudo registrar el ingreso.", "error");
      return;
    }

    setIntakeLookupMessage("Paciente guardado correctamente.", "success");
    setIntakeFormMessage("Ingreso registrado correctamente.", "success");
    resetIntakeForm();
  } catch (error) {
    setIntakeFormMessage("No se pudo conectar con el servidor.", "error");
  } finally {
    setIntakeSubmitState(false);
  }
});

async function handleIntakeCedulaInput() {
  clearIntakeMessages();
  intakeFields.cedula.value = sanitizeCedula(intakeFields.cedula.value);
  clearIntakeFieldError("cedula");

  if (intakeFields.cedula.value.length !== 10) {
    lastIntakeLookupValue = "";
    clearIntakePatientData();
    setIntakeLookupMessage("Ingresa una cedula para buscar al paciente.", "neutral");
    return;
  }

  if (intakeFields.cedula.value === lastIntakeLookupValue) {
    return;
  }

  lastIntakeLookupValue = intakeFields.cedula.value;

  try {
    const response = await fetch(`/api/patients/${intakeFields.cedula.value}`);
    const result = await response.json();

    if (response.ok && result.exists) {
      fillIntakePatientData(result.patient);
      setIntakeLookupMessage("Paciente encontrado. Datos cargados automaticamente.", "success");
    } else {
      clearIntakePatientData();
      setIntakeLookupMessage("Paciente no encontrado. Ingresa los datos manualmente.", "warning");
    }
  } catch (error) {
    setIntakeLookupMessage("No se pudo consultar la base de datos.", "error");
  }
}

function handleIntakeCedulaPaste(event) {
  event.preventDefault();
  const pastedText = event.clipboardData.getData("text");
  intakeFields.cedula.value = sanitizeCedula(pastedText);
  handleIntakeCedulaInput();
}

function validateIntakeForm() {
  let isValid = true;
  const data = {
    cedula: intakeFields.cedula.value.trim(),
    nombre: intakeFields.nombre.value.trim(),
    apellido: intakeFields.apellido.value.trim(),
    telefono: intakeFields.telefono.value.trim(),
    correo: intakeFields.correo.value.trim(),
    fecha: intakeFields.fecha.value.trim(),
    hora: intakeFields.hora.value.trim(),
    observacion: intakeFields.observacion.value.trim()
  };

  if (!/^\d{10}$/.test(data.cedula)) {
    showIntakeFieldError("cedula", "La cedula debe tener exactamente 10 digitos.");
    isValid = false;
  } else {
    clearIntakeFieldError("cedula");
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.nombre)) {
    showIntakeFieldError("nombre", "Ingresa solo letras en nombre.");
    isValid = false;
  } else {
    clearIntakeFieldError("nombre");
  }

  if (!/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.apellido)) {
    showIntakeFieldError("apellido", "Ingresa solo letras en apellido.");
    isValid = false;
  } else {
    clearIntakeFieldError("apellido");
  }

  if (!/^\d{10}$/.test(data.telefono)) {
    showIntakeFieldError("telefono", "El telefono debe tener 10 digitos.");
    isValid = false;
  } else {
    clearIntakeFieldError("telefono");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.correo)) {
    showIntakeFieldError("correo", "Ingresa un correo valido.");
    isValid = false;
  } else {
    clearIntakeFieldError("correo");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
    showIntakeFieldError("fecha", "La fecha actual es obligatoria.");
    isValid = false;
  } else {
    clearIntakeFieldError("fecha");
  }

  if (!/^\d{2}:\d{2}$/.test(data.hora)) {
    showIntakeFieldError("hora", "La hora actual es obligatoria.");
    isValid = false;
  } else {
    clearIntakeFieldError("hora");
  }

  if (data.observacion && !/^[A-ZÁÉÍÓÚÑ ]+$/.test(data.observacion)) {
    showIntakeFieldError("observacion", "La observacion solo permite letras.");
    isValid = false;
  } else {
    clearIntakeFieldError("observacion");
  }

  return isValid;
}

function fillIntakePatientData(patient) {
  intakeFields.nombre.value = patient.nombre || "";
  intakeFields.apellido.value = patient.apellido || "";
  intakeFields.telefono.value = patient.telefono || "";
  intakeFields.correo.value = patient.correo || "";
}

function clearIntakePatientData() {
  intakeFields.nombre.value = "";
  intakeFields.apellido.value = "";
  intakeFields.telefono.value = "";
  intakeFields.correo.value = "";
}

function setCurrentDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  intakeFields.fecha.value = `${year}-${month}-${day}`;
  intakeFields.fechaDisplay.value = `${day}/${month}/${year}`;
  intakeFields.hora.value = `${hours}:${minutes}`;
  intakeFields.horaDisplay.value = `${hours}:${minutes}`;
}

function onlyDigits(value) {
  return value.replace(/\D/g, "");
}

function sanitizeCedula(value) {
  return onlyDigits(String(value || "").trim()).slice(0, 10);
}

function normalizeLetters(value) {
  return value
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

function showIntakeFieldError(fieldName, message) {
  document.querySelector(`#${fieldName}-error`).textContent = message;
}

function clearIntakeFieldError(fieldName) {
  document.querySelector(`#${fieldName}-error`).textContent = "";
}

function clearIntakeMessages() {
  setIntakeFormMessage("Completa la informacion para registrar el ingreso.", "neutral");
}

function setIntakeLookupMessage(message, type) {
  intakeLookupMessage.textContent = message;
  intakeLookupMessage.className = `lookup-message ${type}`;
}

function setIntakeFormMessage(message, type) {
  intakeFormMessage.textContent = message;
  intakeFormMessage.className = `form-message ${type}`;
}

function setIntakeSubmitState(isLoading) {
  intakeSubmitButton.disabled = isLoading;
  intakeSubmitButton.querySelector(".button-main").textContent = isLoading ? "Ingresando..." : "Ingresar paciente";
  intakeSubmitButton.querySelector(".button-sub").textContent = isLoading
    ? "Guardando datos del paciente"
    : "Guardar datos e ingreso";
}

function resetIntakeForm() {
  intakeForm.reset();
  lastIntakeLookupValue = "";
  clearIntakePatientData();
  clearIntakeFieldError("cedula");
  clearIntakeFieldError("nombre");
  clearIntakeFieldError("apellido");
  clearIntakeFieldError("telefono");
  clearIntakeFieldError("correo");
  clearIntakeFieldError("fecha");
  clearIntakeFieldError("hora");
  clearIntakeFieldError("observacion");
  setCurrentDateTime();
}
