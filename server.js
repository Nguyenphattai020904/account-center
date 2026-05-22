require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const session = require("express-session");
const { OAuth2Client } = require("google-auth-library");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const allowedGoogleEmail = "phattai02092004@gmail.com";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const oauthClient = new OAuth2Client();
const dbConfig = {
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "ServBay.dev",
};
const dbName = "center";

let pool;

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isLocalOrigin =
    typeof origin === "string" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  if (isLocalOrigin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use(
  session({
    secret: process.env.SESSION_SECRET || "account-center-local-session",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

function isAllowedSession(req) {
  const email = String(req.session?.user?.email || "").toLowerCase();
  return email === allowedGoogleEmail;
}

function requireAuth(req, res, next) {
  if (isAllowedSession(req)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: "Unauthorized. Please login with allowed Google account.",
  });
}

function fromIso(iso) {
  if (!iso || typeof iso !== "string") {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toIso(mysqlDateTime) {
  const date = new Date(`${mysqlDateTime}Z`);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function safeJsonArray(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function ensureSchema() {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      login_type VARCHAR(120) NOT NULL,
      username VARCHAR(255) NOT NULL,
      password_enc TEXT NOT NULL,
      login_url TEXT NULL,
      password_history LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getSetting(key) {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  const [rows] = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1",
    [key],
  );
  return rows[0]?.setting_value || "";
}

async function saveSetting(key, value) {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  await pool.query(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [key, value],
  );
}

async function getState() {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  const masterHash = await getSetting("masterHash");
  const [rows] = await pool.query(
    "SELECT id, title, login_type, username, password_enc, login_url, password_history, created_at, updated_at FROM accounts ORDER BY created_at DESC",
  );

  const accounts = rows.map((row) => ({
    id: row.id,
    title: row.title,
    loginType: row.login_type,
    username: row.username,
    passwordEnc: row.password_enc,
    loginUrl: row.login_url || "",
    passwordHistory: safeJsonArray(row.password_history),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));

  return { success: true, masterHash, accounts };
}

async function initDatabase() {
  const bootstrap = await mysql.createConnection(dbConfig);

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await bootstrap.end();
  }

  pool = mysql.createPool({
    ...dbConfig,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
  });
}

app.get("/auth/config", (req, res) => {
  return res.json({
    success: true,
    googleClientId,
    allowedEmail: allowedGoogleEmail,
  });
});

app.get("/auth/status", (req, res) => {
  return res.json({
    success: true,
    authenticated: isAllowedSession(req),
    user: isAllowedSession(req) ? req.session.user : null,
    allowedEmail: allowedGoogleEmail,
  });
});

app.post("/auth/google", async (req, res) => {
  try {
    if (!googleClientId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLIENT_ID is not configured on server.",
      });
    }

    const idToken = String(req.body?.credential || "").trim();
    if (!idToken) {
      return res.status(422).json({
        success: false,
        error: "Google credential is required.",
      });
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").toLowerCase();
    const isVerified = Boolean(payload?.email_verified);

    if (!isVerified || email !== allowedGoogleEmail) {
      req.session.user = null;
      return res.status(403).json({
        success: false,
        error: "Google account is not allowed.",
      });
    }

    req.session.user = {
      email,
      name: String(payload?.name || ""),
      picture: String(payload?.picture || ""),
    };

    return res.json({
      success: true,
      user: req.session.user,
    });
  } catch (_error) {
    return res.status(401).json({
      success: false,
      error: "Invalid Google token.",
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    return res.json({ success: true });
  });
});

app.get("/", (req, res) => {
  if (isAllowedSession(req)) {
    return res.sendFile(path.resolve(__dirname, "index.html"));
  }
  return res.redirect("/login.html");
});

app.get("/index.html", (req, res) => {
  if (isAllowedSession(req)) {
    return res.sendFile(path.resolve(__dirname, "index.html"));
  }
  return res.redirect("/login.html");
});

app.use(express.static(path.resolve(__dirname), { index: false }));

app.use("/api", requireAuth);

app.get("/api", async (req, res) => {
  try {
    const action = req.query.action || "state";
    if (action !== "state") {
      return res
        .status(404)
        .json({ success: false, error: "Unsupported route" });
    }

    const payload = await getState();
    return res.json(payload);
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: error.message || "Server error" });
  }
});

app.post("/api", async (req, res) => {
  try {
    const action = req.query.action;

    if (action === "master") {
      const masterHash = String(req.body?.masterHash || "").trim();
      if (!masterHash) {
        return res
          .status(422)
          .json({ success: false, error: "masterHash is required" });
      }
      await saveSetting("masterHash", masterHash);
      return res.json({ success: true });
    }

    if (action === "create") {
      const account = req.body?.account;
      if (!account || typeof account !== "object") {
        return res
          .status(422)
          .json({ success: false, error: "account payload is required" });
      }

      const id = String(account.id || "").trim();
      const title = String(account.title || "").trim();
      const loginType = String(account.loginType || "").trim();
      const username = String(account.username || "").trim();
      const passwordEnc = String(account.passwordEnc || "").trim();
      const loginUrl = String(account.loginUrl || "").trim();
      const passwordHistory = Array.isArray(account.passwordHistory)
        ? account.passwordHistory
        : [];
      const createdAt = fromIso(String(account.createdAt || ""));
      const updatedAt = fromIso(String(account.updatedAt || ""));

      if (!id || !title || !loginType || !username || !passwordEnc) {
        return res
          .status(422)
          .json({ success: false, error: "Invalid account payload" });
      }

      await pool.query(
        "INSERT INTO accounts (id, title, login_type, username, password_enc, login_url, password_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          title,
          loginType,
          username,
          passwordEnc,
          loginUrl || null,
          JSON.stringify(passwordHistory),
          createdAt,
          updatedAt,
        ],
      );

      return res.json({ success: true });
    }

    return res.status(404).json({ success: false, error: "Unsupported route" });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: error.message || "Server error" });
  }
});

app.put("/api", async (req, res) => {
  try {
    const action = req.query.action;
    const id = String(req.query.id || "").trim();
    const account = req.body?.account;

    if (action !== "update") {
      return res
        .status(404)
        .json({ success: false, error: "Unsupported route" });
    }

    if (!id || !account || typeof account !== "object") {
      return res
        .status(422)
        .json({ success: false, error: "id and account payload are required" });
    }

    const title = String(account.title || "").trim();
    const loginType = String(account.loginType || "").trim();
    const username = String(account.username || "").trim();
    const passwordEnc = String(account.passwordEnc || "").trim();
    const loginUrl = String(account.loginUrl || "").trim();
    const passwordHistory = Array.isArray(account.passwordHistory)
      ? account.passwordHistory
      : [];
    const updatedAt = fromIso(String(account.updatedAt || ""));

    if (!title || !loginType || !username || !passwordEnc) {
      return res
        .status(422)
        .json({ success: false, error: "Invalid account payload" });
    }

    await pool.query(
      "UPDATE accounts SET title = ?, login_type = ?, username = ?, password_enc = ?, login_url = ?, password_history = ?, updated_at = ? WHERE id = ?",
      [
        title,
        loginType,
        username,
        passwordEnc,
        loginUrl || null,
        JSON.stringify(passwordHistory),
        updatedAt,
        id,
      ],
    );

    return res.json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: error.message || "Server error" });
  }
});

app.delete("/api", async (req, res) => {
  try {
    const action = req.query.action;
    const id = String(req.query.id || "").trim();

    if (action !== "delete") {
      return res
        .status(404)
        .json({ success: false, error: "Unsupported route" });
    }

    if (!id) {
      return res.status(422).json({ success: false, error: "id is required" });
    }

    await pool.query("DELETE FROM accounts WHERE id = ?", [id]);
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: error.message || "Server error" });
  }
});

(async () => {
  try {
    await initDatabase();
    await ensureSchema();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Account Center server running at http://localhost:${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", error.message || error);
    process.exit(1);
  }
})();
