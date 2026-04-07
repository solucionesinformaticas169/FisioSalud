(() => {
  const usersList = document.getElementById("users-list");
  const usersStatus = document.getElementById("users-status");
  const usersSummary = document.getElementById("users-summary");
  const reloadButton = document.getElementById("reload-users-button");
  const form = document.getElementById("create-user-form");
  const createStatus = document.getElementById("create-user-status");
  const createButton = document.getElementById("create-user-button");

  if (!usersList || !usersStatus || !usersSummary || !form) {
    return;
  }

  reloadButton?.addEventListener("click", loadUsers);
  form.addEventListener("submit", handleCreateUser);
  loadUsers();

  async function loadUsers() {
    setUsersStatus("Cargando usuarios...", "neutral");

    try {
      const response = await fetch("/api/admin/users", {
        headers: {
          "x-role": window.AppAuth.getSession()?.role || ""
        }
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo consultar los usuarios.");
      }

      const users = Array.isArray(payload.users) ? payload.users : [];
      renderUsers(users);
      usersSummary.textContent = `${users.length} usuario${users.length === 1 ? "" : "s"}`;
      setUsersStatus(users.length ? "Usuarios cargados correctamente." : "No hay usuarios registrados.", users.length ? "success" : "warning");
    } catch (error) {
      usersList.innerHTML = '<p class="results-placeholder">No fue posible cargar los usuarios.</p>';
      usersSummary.textContent = "Sin carga";
      setUsersStatus(error.message || "No se pudo consultar los usuarios.", "error");
    }
  }

  function renderUsers(users) {
    if (!users.length) {
      usersList.innerHTML = '<p class="results-placeholder">Aun no hay usuarios registrados.</p>';
      return;
    }

    usersList.innerHTML = "";

    users.forEach((user) => {
      const article = document.createElement("article");
      article.className = "user-card";
      article.innerHTML = `
        <div class="user-card-head">
          <div>
            <strong>${escapeHtml(user.nombre)}</strong>
            <p class="user-meta">@${escapeHtml(user.username)} · ${formatRole(user.role)} · ${user.activo ? "Activo" : "Inactivo"}</p>
          </div>
          <span class="badge${user.activo ? "" : " subtle"}">${user.activo ? "Activo" : "Inactivo"}</span>
        </div>
        <div class="user-actions">
          <label class="inline-field">
            <span>Rol</span>
            <select data-action="role">
              <option value="USER"${user.role === "USER" ? " selected" : ""}>Usuario</option>
              <option value="ADMIN"${user.role === "ADMIN" ? " selected" : ""}>Admin</option>
              <option value="SUPERADMIN"${user.role === "SUPERADMIN" ? " selected" : ""}>SuperAdmin</option>
            </select>
          </label>
          <label class="inline-field">
            <span>Estado</span>
            <select data-action="active">
              <option value="true"${user.activo ? " selected" : ""}>Activo</option>
              <option value="false"${!user.activo ? " selected" : ""}>Inactivo</option>
            </select>
          </label>
          <label class="inline-field">
            <span>Nueva contrasena</span>
            <input data-action="password" type="password" placeholder="Opcional">
          </label>
        </div>
        <button type="button" class="secondary-button" data-save>
          <span class="button-main">Guardar cambios</span>
          <span class="button-sub">Actualizar rol, estado o contrasena</span>
        </button>
      `;

      const saveButton = article.querySelector("[data-save]");
      saveButton.addEventListener("click", () => updateUser(user.id, article, saveButton));
      usersList.appendChild(article);
    });
  }

  async function updateUser(userId, article, saveButton) {
    const role = article.querySelector('[data-action="role"]').value;
    const activo = article.querySelector('[data-action="active"]').value === "true";
    const password = article.querySelector('[data-action="password"]').value;
    saveButton.disabled = true;

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: window.AppAuth.getAuthHeaders(),
        body: JSON.stringify({ role, activo, password })
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo actualizar el usuario.");
      }

      setUsersStatus(payload?.message || "Usuario actualizado correctamente.", "success");
      await loadUsers();
    } catch (error) {
      setUsersStatus(error.message || "No se pudo actualizar el usuario.", "error");
    } finally {
      saveButton.disabled = false;
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    createButton.disabled = true;
    setCreateStatus("Creando usuario...", "neutral");

    const payload = {
      nombre: document.getElementById("new-user-name").value.trim(),
      username: document.getElementById("new-user-username").value.trim(),
      role: document.getElementById("new-user-role").value,
      password: document.getElementById("new-user-password").value
    };

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: window.AppAuth.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const result = await safeJson(response);
      if (!response.ok) {
        throw new Error(result?.message || "No se pudo crear el usuario.");
      }

      form.reset();
      setCreateStatus(result?.message || "Usuario creado correctamente.", "success");
      await loadUsers();
    } catch (error) {
      setCreateStatus(error.message || "No se pudo crear el usuario.", "error");
    } finally {
      createButton.disabled = false;
    }
  }

  function setUsersStatus(message, level) {
    usersStatus.textContent = message;
    usersStatus.className = `form-message ${level}`;
  }

  function setCreateStatus(message, level) {
    createStatus.textContent = message;
    createStatus.className = `form-message ${level}`;
  }

  function formatRole(role) {
    return { USER: "Usuario", ADMIN: "Admin", SUPERADMIN: "SuperAdmin" }[role] || role;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }
})();
