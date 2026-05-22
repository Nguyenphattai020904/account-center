const API_BASE =
  window.location.port === "3000"
    ? "/api"
    : `${window.location.protocol}//${window.location.hostname}:3000/api`;
const AUTH_BASE =
  window.location.port === "3000"
    ? "/auth"
    : `${window.location.protocol}//${window.location.hostname}:3000/auth`;
const APP_BASE =
  window.location.port === "3000"
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:3000`;

const state = {
  accounts: [],
  filteredAccounts: [],
  selectedAccountId: null,
  pendingUnlockId: null,
  masterHash: "",
};

const els = {
  masterForm: document.getElementById("masterForm"),
  masterCurrent: document.getElementById("masterCurrent"),
  masterNew: document.getElementById("masterNew"),
  masterConfirm: document.getElementById("masterConfirm"),
  masterStatus: document.getElementById("masterStatus"),
  accountForm: document.getElementById("accountForm"),
  title: document.getElementById("title"),
  loginType: document.getElementById("loginType"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginUrl: document.getElementById("loginUrl"),
  searchInput: document.getElementById("searchInput"),
  accountList: document.getElementById("accountList"),
  detailPanel: document.getElementById("detailPanel"),
  authModal: document.getElementById("authModal"),
  authForm: document.getElementById("authForm"),
  authMaster: document.getElementById("authMaster"),
  authCancel: document.getElementById("authCancel"),
  toastContainer: document.getElementById("toastContainer"),
  logoutBtn: document.getElementById("logoutBtn"),
  userBadge: document.getElementById("userBadge"),
};

init();

async function init() {
  const isAuthorized = await ensureAuthorized();
  if (!isAuthorized) {
    return;
  }

  bindEvents();
  await loadRemoteState();
  updateMasterStatus();
  renderList();
}

function bindEvents() {
  els.masterForm.addEventListener("submit", onMasterSave);
  els.accountForm.addEventListener("submit", onAddAccount);
  els.searchInput.addEventListener("input", renderList);
  els.authForm.addEventListener("submit", onUnlockSubmit);
  els.authCancel.addEventListener("click", closeAuthModal);
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", onLogout);
  }
}

async function ensureAuthorized() {
  try {
    const response = await fetch(`${AUTH_BASE}/status`, {
      method: "GET",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.authenticated) {
      window.location.href = `${APP_BASE}/login.html`;
      return false;
    }

    if (els.userBadge && data.user?.email) {
      els.userBadge.textContent = `Logged in: ${data.user.email}`;
    }
    return true;
  } catch (_error) {
    window.location.href = `${APP_BASE}/login.html`;
    return false;
  }
}

async function onLogout() {
  try {
    await fetch(`${AUTH_BASE}/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    window.location.href = `${APP_BASE}/login.html`;
  }
}

async function onMasterSave(event) {
  event.preventDefault();

  const currentHash = state.masterHash;
  const currentInput = els.masterCurrent.value.trim();
  const nextPassword = els.masterNew.value.trim();
  const confirmPassword = els.masterConfirm.value.trim();

  if (!nextPassword || nextPassword.length < 4) {
    showToast("Master password must be at least 4 chars.", "error");
    return;
  }

  if (nextPassword !== confirmPassword) {
    showToast("Master password confirmation mismatch.", "error");
    return;
  }

  if (currentHash && !verifyMasterPassword(currentInput)) {
    showToast("Current master password is incorrect.", "error");
    return;
  }

  try {
    const nextHash = simpleHash(nextPassword);
    await apiRequest("POST", "master", { masterHash: nextHash });
    state.masterHash = nextHash;
    els.masterForm.reset();
    updateMasterStatus();
    showToast("Master password saved.", "success");
  } catch (error) {
    showToast(error.message || "Failed to save master password.", "error");
  }
}

async function onAddAccount(event) {
  event.preventDefault();

  if (!state.masterHash) {
    showToast("Set master password before adding accounts.", "error");
    return;
  }

  const account = {
    id: cryptoRandomId(),
    title: els.title.value.trim(),
    loginType: els.loginType.value.trim(),
    username: els.username.value.trim(),
    passwordEnc: encodePassword(els.password.value),
    loginUrl: els.loginUrl.value.trim(),
    passwordHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (
    !account.title ||
    !account.loginType ||
    !account.username ||
    !els.password.value
  ) {
    showToast("Please fill all required account fields.", "error");
    return;
  }

  try {
    await apiRequest("POST", "create", { account });
    await loadRemoteState();
    els.accountForm.reset();
    renderList();
    showToast("Account saved.", "success");
  } catch (error) {
    showToast(error.message || "Failed to save account.", "error");
  }
}

function onUnlockSubmit(event) {
  event.preventDefault();

  const masterInput = els.authMaster.value.trim();
  if (!verifyMasterPassword(masterInput)) {
    showToast("Master password incorrect.", "error");
    return;
  }

  state.selectedAccountId = state.pendingUnlockId;
  closeAuthModal();
  renderDetail(state.selectedAccountId);
  showToast("Account unlocked.", "success");
}

function renderList() {
  const keyword = els.searchInput.value.trim().toLowerCase();

  state.filteredAccounts = state.accounts.filter((account) => {
    if (!keyword) return true;
    return [account.title, account.username, account.loginType]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });

  if (state.filteredAccounts.length === 0) {
    els.accountList.innerHTML =
      '<div class="empty-state">No accounts found.</div>';
    return;
  }

  const cards = state.filteredAccounts
    .map((account) => {
      return `
        <article class="account-card" data-id="${escapeHtml(account.id)}">
          <h3 class="account-title">${escapeHtml(account.title)}</h3>
          <p class="account-meta">User: ${escapeHtml(account.username)}</p>
          <p class="account-meta">Type: ${escapeHtml(account.loginType)}</p>
        </article>
      `;
    })
    .join("");

  els.accountList.innerHTML = cards;

  document.querySelectorAll(".account-card").forEach((card) => {
    card.addEventListener("click", () => {
      const accountId = card.dataset.id;
      if (!state.masterHash) {
        showToast("Master password is not configured.", "error");
        return;
      }
      openAuthModal(accountId);
    });
  });
}

function renderDetail(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    els.detailPanel.innerHTML = '<p class="placeholder">Account not found.</p>';
    return;
  }

  const plainPassword = decodePassword(account.passwordEnc);
  const historyMarkup = account.passwordHistory.length
    ? account.passwordHistory
        .slice()
        .reverse()
        .map((record) => {
          return `
            <li class="history-item">
              <div><strong>Time:</strong> ${formatDate(record.changedAt)}</div>
              <div><strong>Old:</strong> ${escapeHtml(decodePassword(record.oldPasswordEnc))}</div>
              <div><strong>New:</strong> ${escapeHtml(decodePassword(record.newPasswordEnc))}</div>
            </li>
          `;
        })
        .join("")
    : '<li class="history-item">No password changes yet.</li>';

  els.detailPanel.innerHTML = `
    <form id="editForm" class="detail-grid">
      <label for="editTitle">Title</label>
      <input id="editTitle" type="text" value="${escapeAttr(account.title)}" required />

      <label for="editType">Login Type</label>
      <input id="editType" type="text" value="${escapeAttr(account.loginType)}" required />

      <label for="editUser">Username</label>
      <div class="row">
        <input id="editUser" type="text" value="${escapeAttr(account.username)}" required />
        <button type="button" class="btn btn-secondary" id="copyUser">Copy</button>
      </div>

      <label for="editPass">Password</label>
      <div class="row">
        <input id="editPass" type="password" value="${escapeAttr(plainPassword)}" required />
        <button type="button" class="btn btn-secondary" id="togglePass">Show</button>
      </div>

      <div class="inline-actions">
        <button type="button" class="btn btn-secondary" id="copyPass">Copy Password</button>
      </div>

      <label for="editUrl">Login URL</label>
      <input id="editUrl" type="url" value="${escapeAttr(account.loginUrl || "")}" placeholder="https://example.com/login" />

      ${account.loginUrl ? `<a class="link" target="_blank" rel="noreferrer" href="${escapeAttr(account.loginUrl)}">Open login link</a>` : ""}

      <div class="inline-actions">
        <button type="submit" class="btn btn-primary">Update Account</button>
        <button type="button" class="btn btn-danger" id="deleteBtn">Delete Account</button>
      </div>
    </form>

    <div class="history-box">
      <h4>Password History</h4>
      <ul class="history-list">${historyMarkup}</ul>
    </div>
  `;

  const editForm = document.getElementById("editForm");
  const editPass = document.getElementById("editPass");
  const togglePass = document.getElementById("togglePass");
  const copyUser = document.getElementById("copyUser");
  const copyPass = document.getElementById("copyPass");
  const deleteBtn = document.getElementById("deleteBtn");

  togglePass.addEventListener("click", () => {
    const isHidden = editPass.type === "password";
    editPass.type = isHidden ? "text" : "password";
    togglePass.textContent = isHidden ? "Hide" : "Show";
  });

  copyUser.addEventListener("click", () =>
    copyToClipboard(
      document.getElementById("editUser").value,
      "Username copied.",
    ),
  );
  copyPass.addEventListener("click", () =>
    copyToClipboard(editPass.value, "Password copied."),
  );

  deleteBtn.addEventListener("click", async () => {
    const ok = confirm(`Delete account \"${account.title}\"?`);
    if (!ok) return;

    try {
      await apiRequest("DELETE", "delete", null, account.id);
      await loadRemoteState();
      renderList();
      els.detailPanel.innerHTML =
        '<p class="placeholder">Account deleted. Select another account.</p>';
      showToast("Account deleted.", "success");
    } catch (error) {
      showToast(error.message || "Failed to delete account.", "error");
    }
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nextTitle = document.getElementById("editTitle").value.trim();
    const nextType = document.getElementById("editType").value.trim();
    const nextUser = document.getElementById("editUser").value.trim();
    const nextPass = document.getElementById("editPass").value;
    const nextUrl = document.getElementById("editUrl").value.trim();

    if (!nextTitle || !nextType || !nextUser || !nextPass) {
      showToast("Required fields cannot be empty.", "error");
      return;
    }

    const oldPlainPassword = decodePassword(account.passwordEnc);

    account.title = nextTitle;
    account.loginType = nextType;
    account.username = nextUser;
    account.loginUrl = nextUrl;

    if (oldPlainPassword !== nextPass) {
      account.passwordHistory.push({
        oldPasswordEnc: encodePassword(oldPlainPassword),
        newPasswordEnc: encodePassword(nextPass),
        changedAt: new Date().toISOString(),
      });
      account.passwordEnc = encodePassword(nextPass);
    }

    account.updatedAt = new Date().toISOString();

    try {
      await apiRequest("PUT", "update", { account }, account.id);
      await loadRemoteState();
      renderList();
      renderDetail(account.id);
      showToast("Account updated.", "success");
    } catch (error) {
      showToast(error.message || "Failed to update account.", "error");
    }
  });
}

function openAuthModal(accountId) {
  state.pendingUnlockId = accountId;
  els.authModal.classList.remove("hidden");
  els.authMaster.value = "";
  els.authMaster.focus();
}

function closeAuthModal() {
  els.authModal.classList.add("hidden");
  state.pendingUnlockId = null;
}

function updateMasterStatus() {
  els.masterStatus.textContent = state.masterHash
    ? "Master password configured. Account details are locked behind verification."
    : "Master password is not configured.";
}

async function loadRemoteState() {
  try {
    const response = await apiRequest("GET", "state");
    state.accounts = Array.isArray(response.accounts) ? response.accounts : [];
    state.masterHash = response.masterHash || "";
    if (!Array.isArray(state.accounts)) state.accounts = [];
  } catch (error) {
    state.accounts = [];
    state.masterHash = "";
    showToast(error.message || "Cannot connect to API/MySQL.", "error");
  }
}

function verifyMasterPassword(input) {
  const storedHash = state.masterHash;
  if (!storedHash) return false;
  return simpleHash(input) === storedHash;
}

async function apiRequest(method, action, payload = null, id = "") {
  const url = new URL(API_BASE, window.location.href);
  url.searchParams.set("action", action);
  if (id) {
    url.searchParams.set("id", id);
  }

  const options = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (payload && method !== "GET") {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url.toString(), options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success) {
    throw new Error(data.error || `API error (${response.status})`);
  }

  return data;
}

// Simple hash for local verification (not suitable for production-grade security).
function simpleHash(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

// Lightweight XOR + Base64 encoding keeps local data less readable at first glance.
function encodePassword(plain) {
  const xorText = xorWithKey(plain, 73);
  return utf8ToB64(xorText);
}

function decodePassword(encoded) {
  try {
    const text = b64ToUtf8(encoded);
    return xorWithKey(text, 73);
  } catch (_error) {
    return "";
  }
}

function xorWithKey(value, key) {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    out += String.fromCharCode(value.charCodeAt(i) ^ ((key + i) % 255));
  }
  return out;
}

function utf8ToB64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function b64ToUtf8(value) {
  return decodeURIComponent(escape(atob(value)));
}

function showToast(message, type) {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : "success"}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2400);
}

async function copyToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, "success");
  } catch (_error) {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
    showToast(successMessage, "success");
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
