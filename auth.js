(function () {
  const STORAGE_KEY = "fisiosalud-auth-session";
  const LAST_ACTIVITY_KEY = "fisiosalud-auth-last-activity";
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;
  const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
  const ROLE_ORDER = {
    USER: 1,
    ADMIN: 2,
    SUPERADMIN: 3
  };
  let heartbeatTimer = null;
  let activityBound = false;

  function getSession() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function saveSession(session) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    updateLastActivity();
    startHeartbeat();
  }

  async function login(username, password) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: String(username || "").trim(),
        password: String(password || "")
      })
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      return { ok: false, message: payload?.message || "No se pudo iniciar sesión." };
    }

    const session = payload?.session || null;
    if (!session) {
      return { ok: false, message: "No se pudo iniciar sesión." };
    }

    saveSession(session);
    return { ok: true, session };
  }

  async function logout(options = {}) {
    const session = getSession();
    const reason = String(options.reason || "LOGOUT");

    if (session?.sessionToken) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            sessionToken: session.sessionToken,
            reason
          }),
          keepalive: true
        });
      } catch (_error) {
        // Si falla el cierre remoto, igualmente limpiamos la sesión local.
      }
    }

    stopHeartbeat();
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(LAST_ACTIVITY_KEY);

    if (options.redirectToLogin) {
      const currentPath = window.location.pathname || "/";
      const redirect = encodeURIComponent(currentPath);
      window.location.href = `/login?redirect=${redirect}&reason=inactividad`;
    }
  }

  function hasRole(minimumRole) {
    const session = getSession();
    if (!session) {
      return false;
    }

    return (ROLE_ORDER[session.role] || 0) >= (ROLE_ORDER[minimumRole] || 0);
  }

  function guardPage(minimumRole) {
    if (hasRole(minimumRole)) {
      return true;
    }

    const redirect = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?redirect=${redirect}`;
    return false;
  }

  function getRoleLabel(role) {
    const labels = {
      USER: "Usuario",
      ADMIN: "Admin",
      SUPERADMIN: "SuperAdmin"
    };

    return labels[role] || "Invitado";
  }

  function getAuthHeaders() {
    const session = getSession();
    return {
      "Content-Type": "application/json",
      "x-role": session?.role || "",
      "x-session-token": session?.sessionToken || ""
    };
  }

  function startHeartbeat() {
    stopHeartbeat();
    bindActivityListeners();

    const session = getSession();
    if (!session?.sessionToken) {
      return;
    }

    updateLastActivity();
    sendHeartbeat();
    heartbeatTimer = window.setInterval(async () => {
      if (isInactive()) {
        await logout({
          reason: "SESION_CERRADA_POR_INACTIVIDAD",
          redirectToLogin: true
        });
        return;
      }

      await sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function sendHeartbeat() {
    const session = getSession();
    if (!session?.sessionToken) {
      stopHeartbeat();
      return;
    }

    try {
      await fetch("/api/auth/heartbeat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ sessionToken: session.sessionToken }),
        keepalive: true
      });
    } catch (_error) {
      // Si falla por red momentanea, el siguiente pulso reintentara.
    }
  }

  function bindActivityListeners() {
    if (activityBound) {
      return;
    }

    const events = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    events.forEach((eventName) => {
      window.addEventListener(eventName, handleUserActivity, { passive: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleUserActivity();
      }
    });

    activityBound = true;
  }

  function handleUserActivity() {
    if (!getSession()) {
      return;
    }

    updateLastActivity();
  }

  function updateLastActivity() {
    window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }

  function getLastActivity() {
    const raw = window.sessionStorage.getItem(LAST_ACTIVITY_KEY);
    const value = Number(raw);
    return Number.isFinite(value) ? value : Date.now();
  }

  function isInactive() {
    return Date.now() - getLastActivity() >= INACTIVITY_LIMIT_MS;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  window.AppAuth = {
    getSession,
    login,
    logout,
    hasRole,
    guardPage,
    getRoleLabel,
    getAuthHeaders
  };

  startHeartbeat();
}());
