const SERVER_ORIGIN =
  window.location.port === "3000"
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:3000`;

const allowedEmailLabel = document.getElementById("allowedEmailLabel");
const statusLabel = document.getElementById("loginStatus");
const googleBtn = document.getElementById("googleBtn");

initLogin();

async function initLogin() {
  const status = await fetchJson(`${SERVER_ORIGIN}/auth/status`, {
    method: "GET",
  });
  if (status?.authenticated) {
    window.location.href = `${SERVER_ORIGIN}/index.html`;
    return;
  }

  const config = await fetchJson(`${SERVER_ORIGIN}/auth/config`, {
    method: "GET",
  });
  const allowedEmail = String(config?.allowedEmail || "");
  const googleClientId = String(config?.googleClientId || "");

  allowedEmailLabel.textContent = allowedEmail
    ? `Tài khoản được phép: ${allowedEmail}`
    : "Chưa có email được phép trên server.";

  if (!googleClientId) {
    statusLabel.textContent =
      "Thiếu GOOGLE_CLIENT_ID trên server. Chưa thể login Google.";
    statusLabel.style.color = "#ff9abb";
    return;
  }

  const loaded = await waitForGoogleScript();
  if (!loaded) {
    statusLabel.textContent = "Không tải được Google Sign-In script.";
    statusLabel.style.color = "#ff9abb";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: onGoogleCredential,
  });

  window.google.accounts.id.renderButton(googleBtn, {
    theme: "outline",
    size: "large",
    width: getGoogleButtonWidth(),
    text: "continue_with",
    shape: "pill",
  });
}

function getGoogleButtonWidth() {
  const width = Math.min(360, Math.max(240, window.innerWidth - 72));
  return width;
}

async function onGoogleCredential(response) {
  try {
    statusLabel.textContent = "Đang xác thực...";
    statusLabel.style.color = "#8aa0bd";

    const result = await fetchJson(`${SERVER_ORIGIN}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });

    if (!result?.success) {
      throw new Error("Google login failed.");
    }

    statusLabel.textContent = "Đăng nhập thành công, đang chuyển trang...";
    statusLabel.style.color = "#52f6b7";
    window.location.href = `${SERVER_ORIGIN}/index.html`;
  } catch (error) {
    statusLabel.textContent = error.message || "Không thể đăng nhập.";
    statusLabel.style.color = "#ff9abb";
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function waitForGoogleScript() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (window.google?.accounts?.id) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  return false;
}
