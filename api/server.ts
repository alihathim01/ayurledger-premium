import dotenv from "dotenv";
import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import db from "../src/db.ts";
import { GoogleGenAI } from "@google/genai";
import { isSupabaseServerConfigured, supabaseAdmin } from "../src/lib/supabase-admin.ts";

dotenv.config({ path: ".env.local" });
dotenv.config();

type AuthUser = { id: number; username: string; role: string };
type UserRole =
  | "admin"
  | "accountant"
  | "auditor"
  | "warehouse_manager"
  | "store_manager"
  | "cashier"
  | "massage_manager";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

type PosItemInput = {
  product_id: number;
  quantity: number;
  price: number;
};

type PosReturnInput = {
  product_id: number;
  quantity: number;
};

type RestockItemInput = {
  product_id: number;
  quantity: number;
  cost: number;
};

type TransferItemInput = {
  product_id: number;
  quantity: number;
};

type WholesaleItemInput = {
  product_id: number;
  quantity: number;
  price: number;
};

type OpenSalesRecord = {
  id: number;
  branch_id: number;
  opening_cash: number;
  cash_taken_out: number;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  notes: string | null;
};

type SupabaseBranch = {
  id: number;
  name: string;
  location: string;
  branch_type: "store" | "warehouse" | "massage_center";
  phone: string | null;
  manager_name: string | null;
  is_active: boolean;
};

type SupabaseProduct = {
  id: number;
  name: string;
  category: string;
  barcode: string | null;
  price: number;
  cost: number;
  sku: string | null;
  is_active: boolean;
};

type SupabaseInventoryRow = {
  id: number;
  product_id: number;
  branch_id: number;
  stock_level: number;
  reorder_point: number | null;
  mfg_date: string | null;
  expiry_date: string | null;
  products: SupabaseProduct | SupabaseProduct[] | null;
  branches: Pick<SupabaseBranch, "name"> | Pick<SupabaseBranch, "name">[] | null;
};

type BranchTypeRow = {
  id: number;
  branch_type: "store" | "warehouse" | "massage_center";
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;
const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

const parsePositiveInt = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseNonNegativeNumber = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const parseDateString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

const getOpenRecordByBranch = (branchId: number) => {
  return db
    .prepare("SELECT * FROM sales_records WHERE branch_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(branchId) as OpenSalesRecord | undefined;
};

const getOpenRecordByBranchSupabase = async (branchId: number) => {
  if (!useSupabaseBackend || !supabaseAdmin) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("sales_records")
    .select("id, branch_id, opening_cash, cash_taken_out, opened_at, closed_at, status, notes")
    .eq("branch_id", branchId)
    .eq("status", "open")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: Number(data.id),
    branch_id: Number(data.branch_id),
    opening_cash: Number(data.opening_cash),
    cash_taken_out: Number(data.cash_taken_out),
    opened_at: data.opened_at,
    closed_at: data.closed_at,
    status: data.status,
    notes: data.notes,
  } as OpenSalesRecord;
};

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
};

const toLocalIsoDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
};

const getRecordBusinessDate = (record: OpenSalesRecord) => toLocalIsoDate(record.opened_at);

const JWT_SECRET = process.env.AYURLEDGER_JWT_SECRET || "CHANGE_ME_DEV_SECRET";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const USER_ROLES: UserRole[] = [
  "admin",
  "accountant",
  "auditor",
  "warehouse_manager",
  "store_manager",
  "cashier",
  "massage_manager",
];

const base64UrlEncode = (input: Buffer | string) => {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const signJwt = (payload: Record<string, unknown>) => {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const head = base64UrlEncode(JSON.stringify(header));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${head}.${body}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest();
  return `${data}.${base64UrlEncode(sig)}`;
};

const base64UrlDecode = (input: string) => {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, "=").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
};

const parseBearerToken = (authHeader: string | undefined) => {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
};

const verifyJwt = (token: string): AuthUser | null => {
  try {
    const [head, body, sig] = token.split(".");
    if (!head || !body || !sig) return null;
    const data = `${head}.${body}`;
    const expectedSig = base64UrlEncode(crypto.createHmac("sha256", JWT_SECRET).update(data).digest());
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(base64UrlDecode(body).toString("utf8")) as {
      sub?: number;
      username?: string;
      role?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.username || !payload.role || !payload.exp) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: payload.sub, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
};

const parseYearMonth = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed) ? trimmed : null;
};

const getMonthRange = (month: string) => {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const mon = Number(monthPart);
  const start = `${yearPart}-${monthPart}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  const endExclusive = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, endExclusive };
};

const csvEscape = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
};

const toCsv = (headers: string[], rows: Array<Array<string | number | null>>) => {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
};

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
};

const verifyPassword = (password: string, stored: string) => {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltHex, "hex");
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
};

const useSupabaseBackend = isSupabaseServerConfigured() && Boolean(supabaseAdmin);
const hasSqliteFallback = Boolean(db);

const asSingle = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const toSqliteBool = (value: boolean | number | null | undefined) => (value ? 1 : 0);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getBranchByIdSupabase = async (branchId: number): Promise<BranchTypeRow | null> => {
  if (!useSupabaseBackend || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("branches")
    .select("id, branch_type")
    .eq("id", branchId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: Number(data.id), branch_type: data.branch_type };
};

const getMonthlySummarySupabase = async (month: string, branchId: number | null) => {
  if (!useSupabaseBackend || !supabaseAdmin) return null;

  const { start, endExclusive } = getMonthRange(month);
  let branchesQuery = supabaseAdmin
    .from("branches")
    .select("id, name, branch_type, location, is_active")
    .order("name", { ascending: true });

  if (branchId) {
    branchesQuery = branchesQuery.eq("id", branchId);
  }

  const [{ data: branches, error: branchError }, { data: sales, error: salesError }, { data: transactions, error: txError }] =
    await Promise.all([
      branchesQuery,
      supabaseAdmin
        .from("sales")
        .select("branch_id, total_amount, date")
        .gte("date", start)
        .lt("date", endExclusive),
      supabaseAdmin
        .from("transactions")
        .select("branch_id, type, category, amount, date")
        .gte("date", start)
        .lt("date", endExclusive),
    ]);

  if (branchError || salesError || txError || !branches) {
    return null;
  }

  const salesByBranch = new Map<number, number>();
  for (const sale of sales ?? []) {
    const id = Number(sale.branch_id);
    salesByBranch.set(id, roundToCents((salesByBranch.get(id) ?? 0) + Number(sale.total_amount)));
  }

  const expenseByBranch = new Map<number, number>();
  const otherIncomeByBranch = new Map<number, number>();
  for (const tx of transactions ?? []) {
    const id = Number(tx.branch_id);
    const amount = Number(tx.amount);
    if (tx.type === "expense") {
      expenseByBranch.set(id, roundToCents((expenseByBranch.get(id) ?? 0) + amount));
    } else if (tx.type === "income" && String(tx.category || "").toLowerCase() !== "sales") {
      otherIncomeByBranch.set(id, roundToCents((otherIncomeByBranch.get(id) ?? 0) + amount));
    }
  }

  const summary = branches.map((branch) => {
    const sales_total = roundToCents(salesByBranch.get(Number(branch.id)) ?? 0);
    const other_income_total = roundToCents(otherIncomeByBranch.get(Number(branch.id)) ?? 0);
    const expense_total = roundToCents(expenseByBranch.get(Number(branch.id)) ?? 0);
    const revenue_total = roundToCents(sales_total + other_income_total);
    const profit_loss = roundToCents(revenue_total - expense_total);

    return {
      branch_id: Number(branch.id),
      branch_name: branch.name,
      branch_type: branch.branch_type,
      location: branch.location,
      is_active: toSqliteBool(branch.is_active),
      sales_total,
      other_income_total,
      expense_total,
      revenue_total,
      profit_loss,
    };
  });

  return { start, endExclusive, summary };
};

const ensureDefaultAdmin = () => {
  if (!hasSqliteFallback) {
    return;
  }

  try {
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!hasUsers) return;

    const count = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
    if (count > 0) return;

    const adminUser = process.env.AYURLEDGER_ADMIN_USER || "admin";
    const adminPass = process.env.AYURLEDGER_ADMIN_PASSWORD || "ChangeMe123!";

    db.prepare("INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(adminUser, "System Admin", hashPassword(adminPass), "admin");

    console.warn(
      `[AyurLedger] Default admin created. username='${adminUser}'. Set AYURLEDGER_ADMIN_PASSWORD and AYURLEDGER_JWT_SECRET in env.`,
    );
  } catch (error) {
    console.warn("[AyurLedger] Could not seed default admin:", error);
  }
};

export async function createApp() {
  const app = express();

  app.use(express.json());
  ensureDefaultAdmin();

  app.post("/api/auth/login", async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required." });
    }

    let userRow:
      | { id: number; username: string; password_hash: string; role: string; is_active: number }
      | undefined;

    let supabaseLookupFailed = false;

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("users")
        .select("id, username, password_hash, role, is_active")
        .eq("username", username)
        .maybeSingle();

      if (error) {
        console.error("[auth/login] Supabase lookup failed:", error.message);
        supabaseLookupFailed = true;
      }

      if (!error && data) {
        userRow = {
          id: Number(data.id),
          username: data.username,
          password_hash: data.password_hash,
          role: data.role,
          is_active: toSqliteBool(data.is_active),
        };
      }
    }

    if (!userRow && hasSqliteFallback) {
      userRow = db
        .prepare("SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?")
        .get(username) as
        | { id: number; username: string; password_hash: string; role: string; is_active: number }
        | undefined;
    }

    if (!userRow && !hasSqliteFallback) {
      if (!useSupabaseBackend || !supabaseAdmin) {
        return res.status(500).json({ error: "Server is missing Supabase configuration." });
      }
      if (supabaseLookupFailed) {
        return res.status(500).json({ error: "Supabase login lookup failed." });
      }
    }

    if (!userRow || userRow.is_active !== 1) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    if (!verifyPassword(password, userRow.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = signJwt({ sub: userRow.id, username: userRow.username, role: userRow.role });
    return res.json({
      token,
      user: {
        id: userRow.id,
        username: userRow.username,
        role: userRow.role,
      },
    });
  });

  const getAllowedBranchIds = async (userId: number) => {
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", userId);

      if (!error && data) {
        return data.map((row) => Number(row.branch_id));
      }
    }

    const rows = db.prepare("SELECT branch_id FROM user_branch_access WHERE user_id = ?").all(userId) as Array<{ branch_id: number }>;
    return rows.map((row) => row.branch_id);
  };

  const hasBranchAccess = async (user: AuthUser, branchId: number) => {
    if (user.role === "admin") return true;

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", user.id)
        .eq("branch_id", branchId)
        .maybeSingle();

      if (!error) {
        return Boolean(data?.branch_id);
      }
    }

    const row = db
      .prepare("SELECT 1 as ok FROM user_branch_access WHERE user_id = ? AND branch_id = ? LIMIT 1")
      .get(user.id, branchId) as { ok: number } | undefined;
    return Boolean(row?.ok);
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    const user = verifyJwt(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    req.user = user;
    next();
  };

  app.use("/api", (req, res, next) => {
    if (req.path === "/auth/login") return next();
    return requireAuth(req, res, next);
  });

  app.use("/api", async (req, res, next) => {
    const user = req.user;
    if (!user || user.role === "admin") return next();

    const candidateKeys = [
      req.query.branchId,
      req.query.branch_id,
      req.query.warehouseBranchId,
      req.query.warehouse_branch_id,
      req.body?.branchId,
      req.body?.branch_id,
      req.body?.warehouseBranchId,
      req.body?.warehouse_branch_id,
      req.body?.from_branch_id,
      req.body?.to_branch_id,
    ];

    for (const raw of candidateKeys) {
      if (raw === undefined || raw === null || raw === "") continue;
      const parsed = parsePositiveInt(raw);
      if (parsed && !(await hasBranchAccess(user, parsed))) {
        return res.status(403).json({ error: "Access denied for this branch." });
      }
    }
    next();
  });

  const requireAdmin: express.RequestHandler = (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  };

  // Admin: user management
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: users, error: usersError }, { data: accessRows, error: accessError }, { data: branches, error: branchesError }] =
        await Promise.all([
          supabaseAdmin
            .from("users")
            .select("id, username, full_name, role, is_active, created_at, updated_at")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false }),
          supabaseAdmin.from("user_branch_access").select("user_id, branch_id"),
          supabaseAdmin.from("branches").select("id, name"),
        ]);

      if (!usersError && !accessError && !branchesError && users) {
        const branchById = new Map((branches ?? []).map((branch) => [Number(branch.id), branch.name]));
        const assignedByUser = new Map<number, number>();
        for (const row of accessRows ?? []) {
          const userId = Number(row.user_id);
          const branchId = Number(row.branch_id);
          if (!assignedByUser.has(userId) || branchId < (assignedByUser.get(userId) ?? Number.MAX_SAFE_INTEGER)) {
            assignedByUser.set(userId, branchId);
          }
        }

        return res.json(
          users.map((user) => {
            const assigned_branch_id = assignedByUser.get(Number(user.id)) ?? null;
            return {
              ...user,
              id: Number(user.id),
              is_active: toSqliteBool(user.is_active),
              assigned_branch_id,
              assigned_branch_name: assigned_branch_id ? branchById.get(assigned_branch_id) ?? null : null,
            };
          }),
        );
      }
    }

    const users = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.is_active,
        u.created_at,
        u.updated_at,
        b.id AS assigned_branch_id,
        b.name AS assigned_branch_name
      FROM users u
      LEFT JOIN (
        SELECT user_id, MIN(branch_id) AS branch_id
        FROM user_branch_access
        GROUP BY user_id
      ) uba ON uba.user_id = u.id
      LEFT JOIN branches b ON b.id = uba.branch_id
      ORDER BY u.created_at DESC, u.id DESC
    `).all();
    res.json(users);
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const fullName = typeof req.body?.full_name === "string" ? req.body.full_name.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";
    const isActive = req.body?.is_active === 0 ? 0 : 1;
    const assignedBranchId = req.body?.assigned_branch_id === null ? null : parsePositiveInt(req.body?.assigned_branch_id);

    if (!username || username.length < 3) {
      return res.status(400).json({ error: "username must be at least 3 characters." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters." });
    }
    if (!USER_ROLES.includes(role as UserRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }
    if (role !== "admin" && !assignedBranchId) {
      return res.status(400).json({ error: "assigned_branch_id is required for non-admin users." });
    }
    if (assignedBranchId) {
      let branch = await getBranchByIdSupabase(assignedBranchId);
      if (!branch) {
        branch = db
          .prepare("SELECT id, branch_type FROM branches WHERE id = ?")
          .get(assignedBranchId) as BranchTypeRow | undefined;
      }
      if (!branch) {
        return res.status(400).json({ error: "Assigned branch not found." });
      }
      if (branch.branch_type !== "store") {
        return res.status(400).json({ error: "Only store branches can be assigned to users." });
      }
    }

    let existing: { id: number } | undefined;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data } = await supabaseAdmin.from("users").select("id").eq("username", username).maybeSingle();
      if (data) existing = { id: Number(data.id) };
    }
    if (!existing) {
      existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
    }
    if (existing) {
      return res.status(409).json({ error: "Username already exists." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from("users")
        .insert({
          username,
          full_name: fullName || null,
          password_hash: hashPassword(password),
          role,
          is_active: Boolean(isActive),
        })
        .select("id")
        .single();

      if (!userError && userData) {
        const userId = Number(userData.id);
        if (assignedBranchId) {
          await supabaseAdmin.from("user_branch_access").insert({
            user_id: userId,
            branch_id: assignedBranchId,
            access_level: "operate",
          });
        }
        return res.json({ success: true, id: userId });
      }
    }

    const createUser = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (username, full_name, password_hash, role, is_active)
        VALUES (?, ?, ?, ?, ?)
      `).run(username, fullName || null, hashPassword(password), role, isActive);
      const userId = Number(info.lastInsertRowid);
      if (assignedBranchId) {
        db.prepare(`
          INSERT INTO user_branch_access (user_id, branch_id, access_level)
          VALUES (?, ?, 'operate')
        `).run(userId, assignedBranchId);
      }
      return userId;
    });

    const userId = createUser();
    res.json({ success: true, id: userId });
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    let current:
      | { id: number; role: string }
      | undefined;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data } = await supabaseAdmin.from("users").select("id, role").eq("id", userId).maybeSingle();
      if (data) current = { id: Number(data.id), role: data.role };
    }
    if (!current) {
      current = db.prepare("SELECT id, role FROM users WHERE id = ?").get(userId) as { id: number; role: string } | undefined;
    }
    if (!current) {
      return res.status(404).json({ error: "User not found." });
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (typeof req.body?.full_name === "string") {
      updates.push("full_name = ?");
      values.push(req.body.full_name.trim() || null);
    }
    let targetRole = current.role;
    if (typeof req.body?.role === "string") {
      const role = req.body.role.trim();
      if (!USER_ROLES.includes(role as UserRole)) {
        return res.status(400).json({ error: "Invalid role." });
      }
      targetRole = role;
      updates.push("role = ?");
      values.push(role);
    }
    if (req.body?.is_active === 0 || req.body?.is_active === 1) {
      if (req.user?.id === userId && req.body.is_active === 0) {
        return res.status(400).json({ error: "You cannot deactivate your own admin account." });
      }
      updates.push("is_active = ?");
      values.push(req.body.is_active);
    }
    if (typeof req.body?.password === "string" && req.body.password.length > 0) {
      if (req.body.password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters." });
      }
      updates.push("password_hash = ?");
      values.push(hashPassword(req.body.password));
    }

    if (updates.length === 0) {
      if (req.body?.assigned_branch_id === undefined) {
        return res.status(400).json({ error: "No valid fields to update." });
      }
    }

    let assignedBranchId: number | null | undefined;
    if (req.body?.assigned_branch_id !== undefined) {
      if (req.body.assigned_branch_id === null || req.body.assigned_branch_id === "") {
        assignedBranchId = null;
      } else {
        assignedBranchId = parsePositiveInt(req.body.assigned_branch_id);
        if (!assignedBranchId) {
          return res.status(400).json({ error: "Invalid assigned_branch_id." });
        }
        let branch = await getBranchByIdSupabase(assignedBranchId);
        if (!branch) {
          branch = db
            .prepare("SELECT id, branch_type FROM branches WHERE id = ?")
            .get(assignedBranchId) as BranchTypeRow | undefined;
        }
        if (!branch) {
          return res.status(400).json({ error: "Assigned branch not found." });
        }
        if (branch.branch_type !== "store") {
          return res.status(400).json({ error: "Only store branches can be assigned to users." });
        }
      }
    }

    let existingAssigned: { branch_id: number } | undefined;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data } = await supabaseAdmin.from("user_branch_access").select("branch_id").eq("user_id", userId).limit(1).maybeSingle();
      if (data) existingAssigned = { branch_id: Number(data.branch_id) };
    }
    if (!existingAssigned) {
      existingAssigned = db
        .prepare("SELECT branch_id FROM user_branch_access WHERE user_id = ? LIMIT 1")
        .get(userId) as { branch_id: number } | undefined;
    }

    if (targetRole !== "admin") {
      if (assignedBranchId === null) {
        return res.status(400).json({ error: "assigned_branch_id is required for non-admin users." });
      }
      if (assignedBranchId === undefined && !existingAssigned?.branch_id) {
        return res.status(400).json({ error: "assigned_branch_id is required for non-admin users." });
      }
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const updatePayload: Record<string, string | boolean | null> = {};
      if (typeof req.body?.full_name === "string") updatePayload.full_name = req.body.full_name.trim() || null;
      if (typeof req.body?.role === "string") updatePayload.role = req.body.role.trim();
      if (req.body?.is_active === 0 || req.body?.is_active === 1) updatePayload.is_active = Boolean(req.body.is_active);
      if (typeof req.body?.password === "string" && req.body.password.length > 0) updatePayload.password_hash = hashPassword(req.body.password);
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin.from("users").update(updatePayload).eq("id", userId);
        if (error) {
          return res.status(500).json({ error: error.message });
        }
      }
      if (assignedBranchId !== undefined) {
        await supabaseAdmin.from("user_branch_access").delete().eq("user_id", userId);
        if (assignedBranchId) {
          await supabaseAdmin.from("user_branch_access").insert({
            user_id: userId,
            branch_id: assignedBranchId,
            access_level: "operate",
          });
        }
      }
      return res.json({ success: true });
    }

    const applyUpdate = db.transaction(() => {
      if (updates.length > 0) {
        updates.push("updated_at = CURRENT_TIMESTAMP");
        db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values, userId);
      }
      if (assignedBranchId !== undefined) {
        db.prepare("DELETE FROM user_branch_access WHERE user_id = ?").run(userId);
        if (assignedBranchId) {
          db.prepare(`
            INSERT INTO user_branch_access (user_id, branch_id, access_level)
            VALUES (?, ?, 'operate')
          `).run(userId, assignedBranchId);
        }
      }
    });
    applyUpdate();
    res.json({ success: true });
  });

  // Admin: branch management
  app.get("/api/admin/branches", requireAdmin, async (_req, res) => {
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("branches")
        .select("id, name, location, branch_type, phone, manager_name, is_active")
        .order("name", { ascending: true });
      if (!error && data) {
        return res.json(data.map((branch) => ({ ...branch, id: Number(branch.id), is_active: toSqliteBool(branch.is_active) })));
      }
    }

    const branches = db.prepare(`
      SELECT id, name, location, branch_type, phone, manager_name, is_active
      FROM branches
      ORDER BY name ASC
    `).all();
    res.json(branches);
  });

  app.post("/api/admin/branches", requireAdmin, async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const location = typeof req.body?.location === "string" ? req.body.location.trim() : "";
    const branchType = typeof req.body?.branch_type === "string" ? req.body.branch_type.trim() : "store";
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const managerName = typeof req.body?.manager_name === "string" ? req.body.manager_name.trim() : "";
    const isActive = req.body?.is_active === 0 ? 0 : 1;

    if (!name || !location) {
      return res.status(400).json({ error: "name and location are required." });
    }
    if (!["store", "warehouse", "massage_center"].includes(branchType)) {
      return res.status(400).json({ error: "Invalid branch_type." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("branches")
        .insert({
          name,
          location,
          branch_type: branchType,
          phone: phone || null,
          manager_name: managerName || null,
          is_active: Boolean(isActive),
        })
        .select("id")
        .single();
      if (!error && data) {
        return res.json({ success: true, id: data.id });
      }
    }

    const info = db.prepare(`
      INSERT INTO branches (name, location, branch_type, phone, manager_name, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, location, branchType, phone || null, managerName || null, isActive);

    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.patch("/api/admin/branches/:id", requireAdmin, async (req, res) => {
    const branchId = parsePositiveInt(req.params.id);
    if (!branchId) {
      return res.status(400).json({ error: "Invalid branch id." });
    }

    let existing: { id: number } | undefined;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data } = await supabaseAdmin.from("branches").select("id").eq("id", branchId).maybeSingle();
      if (data) existing = { id: Number(data.id) };
    }
    if (!existing) {
      existing = db.prepare("SELECT id FROM branches WHERE id = ?").get(branchId) as { id: number } | undefined;
    }
    if (!existing) {
      return res.status(404).json({ error: "Branch not found." });
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty." });
      updates.push("name = ?");
      values.push(name);
    }
    if (typeof req.body?.location === "string") {
      const location = req.body.location.trim();
      if (!location) return res.status(400).json({ error: "location cannot be empty." });
      updates.push("location = ?");
      values.push(location);
    }
    if (typeof req.body?.branch_type === "string") {
      const branchType = req.body.branch_type.trim();
      if (!["store", "warehouse", "massage_center"].includes(branchType)) {
        return res.status(400).json({ error: "Invalid branch_type." });
      }
      updates.push("branch_type = ?");
      values.push(branchType);
    }
    if (typeof req.body?.phone === "string") {
      updates.push("phone = ?");
      values.push(req.body.phone.trim() || null);
    }
    if (typeof req.body?.manager_name === "string") {
      updates.push("manager_name = ?");
      values.push(req.body.manager_name.trim() || null);
    }
    if (req.body?.is_active === 0 || req.body?.is_active === 1) {
      updates.push("is_active = ?");
      values.push(req.body.is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const updatePayload: Record<string, string | boolean | null> = {};
      if (typeof req.body?.name === "string") updatePayload.name = req.body.name.trim();
      if (typeof req.body?.location === "string") updatePayload.location = req.body.location.trim();
      if (typeof req.body?.branch_type === "string") updatePayload.branch_type = req.body.branch_type.trim();
      if (typeof req.body?.phone === "string") updatePayload.phone = req.body.phone.trim() || null;
      if (typeof req.body?.manager_name === "string") updatePayload.manager_name = req.body.manager_name.trim() || null;
      if (req.body?.is_active === 0 || req.body?.is_active === 1) updatePayload.is_active = Boolean(req.body.is_active);
      const { error } = await supabaseAdmin.from("branches").update(updatePayload).eq("id", branchId);
      if (!error) {
        return res.json({ success: true });
      }
    }

    db.prepare(`UPDATE branches SET ${updates.join(", ")} WHERE id = ?`).run(...values, branchId);
    res.json({ success: true });
  });

  // Admin: monthly summary and CSV exports
  app.get("/api/admin/reports/monthly", requireAdmin, async (req, res) => {
    const month = parseYearMonth(req.query.month);
    if (!month) {
      return res.status(400).json({ error: "month is required in YYYY-MM format." });
    }
    const branchId = req.query.branchId !== undefined ? parsePositiveInt(req.query.branchId) : null;
    if (req.query.branchId !== undefined && !branchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    const supabaseSummary = await getMonthlySummarySupabase(month, branchId);
    if (supabaseSummary) {
      const totals = supabaseSummary.summary.reduce(
        (acc, row) => {
          acc.sales_total += row.sales_total;
          acc.other_income_total += row.other_income_total;
          acc.expense_total += row.expense_total;
          acc.revenue_total += row.revenue_total;
          acc.profit_loss += row.profit_loss;
          return acc;
        },
        { sales_total: 0, other_income_total: 0, expense_total: 0, revenue_total: 0, profit_loss: 0 },
      );

      return res.json({
        month,
        summary: supabaseSummary.summary,
        totals: {
          sales_total: roundToCents(totals.sales_total),
          other_income_total: roundToCents(totals.other_income_total),
          expense_total: roundToCents(totals.expense_total),
          revenue_total: roundToCents(totals.revenue_total),
          profit_loss: roundToCents(totals.profit_loss),
        },
      });
    }

    const { start, endExclusive } = getMonthRange(month);
    const rows = db.prepare(`
      SELECT
        b.id AS branch_id,
        b.name AS branch_name,
        b.branch_type,
        b.location,
        b.is_active,
        ROUND(COALESCE(s.sales_total, 0), 2) AS sales_total,
        ROUND(COALESCE(tx.other_income_total, 0), 2) AS other_income_total,
        ROUND(COALESCE(tx.expense_total, 0), 2) AS expense_total
      FROM branches b
      LEFT JOIN (
        SELECT branch_id, SUM(total_amount) AS sales_total
        FROM sales
        WHERE date >= ? AND date < ?
        GROUP BY branch_id
      ) s ON s.branch_id = b.id
      LEFT JOIN (
        SELECT
          branch_id,
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense_total,
          SUM(CASE WHEN type = 'income' AND lower(category) != 'sales' THEN amount ELSE 0 END) AS other_income_total
        FROM transactions
        WHERE date >= ? AND date < ?
        GROUP BY branch_id
      ) tx ON tx.branch_id = b.id
      WHERE (? IS NULL OR b.id = ?)
      ORDER BY b.name ASC
    `).all(start, endExclusive, start, endExclusive, branchId, branchId) as Array<{
      branch_id: number;
      branch_name: string;
      branch_type: string;
      location: string;
      is_active: number;
      sales_total: number;
      other_income_total: number;
      expense_total: number;
    }>;

    const summary = rows.map((row) => {
      const revenue = roundToCents(row.sales_total + row.other_income_total);
      const profit_loss = roundToCents(revenue - row.expense_total);
      return {
        ...row,
        revenue_total: revenue,
        profit_loss,
      };
    });

    const totals = summary.reduce(
      (acc, row) => {
        acc.sales_total += row.sales_total;
        acc.other_income_total += row.other_income_total;
        acc.expense_total += row.expense_total;
        acc.revenue_total += row.revenue_total;
        acc.profit_loss += row.profit_loss;
        return acc;
      },
      { sales_total: 0, other_income_total: 0, expense_total: 0, revenue_total: 0, profit_loss: 0 },
    );

    res.json({
      month,
      summary,
      totals: {
        sales_total: roundToCents(totals.sales_total),
        other_income_total: roundToCents(totals.other_income_total),
        expense_total: roundToCents(totals.expense_total),
        revenue_total: roundToCents(totals.revenue_total),
        profit_loss: roundToCents(totals.profit_loss),
      },
    });
  });

  app.get("/api/admin/reports/monthly/branch-details", requireAdmin, async (req, res) => {
    const month = parseYearMonth(req.query.month);
    const branchId = parsePositiveInt(req.query.branchId);
    if (!month) {
      return res.status(400).json({ error: "month is required in YYYY-MM format." });
    }
    if (!branchId) {
      return res.status(400).json({ error: "branchId is required." });
    }

    const { start, endExclusive } = getMonthRange(month);
    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: sales, error: salesError }, { data: expenses, error: expensesError }, { data: income, error: incomeError }] =
        await Promise.all([
          supabaseAdmin
            .from("sales")
            .select("id, date, payment_method, total_amount")
            .eq("branch_id", branchId)
            .gte("date", start)
            .lt("date", endExclusive)
            .order("date", { ascending: true })
            .order("id", { ascending: true }),
          supabaseAdmin
            .from("transactions")
            .select("id, date, category, description, amount")
            .eq("branch_id", branchId)
            .eq("type", "expense")
            .gte("date", start)
            .lt("date", endExclusive)
            .order("date", { ascending: true })
            .order("id", { ascending: true }),
          supabaseAdmin
            .from("transactions")
            .select("id, date, category, description, amount")
            .eq("branch_id", branchId)
            .eq("type", "income")
            .gte("date", start)
            .lt("date", endExclusive)
            .order("date", { ascending: true })
            .order("id", { ascending: true }),
        ]);

      if (!salesError && !expensesError && !incomeError) {
        return res.json({
          month,
          branch_id: branchId,
          sales: (sales ?? []).map((row) => ({ ...row, total_amount: Number(row.total_amount) })),
          expenses: (expenses ?? []).map((row) => ({ ...row, amount: Number(row.amount) })),
          income: (income ?? [])
            .filter((row) => String(row.category || "").toLowerCase() !== "sales")
            .map((row) => ({ ...row, amount: Number(row.amount) })),
        });
      }
    }

    const sales = db.prepare(`
      SELECT id, date, payment_method, total_amount
      FROM sales
      WHERE branch_id = ? AND date >= ? AND date < ?
      ORDER BY date ASC, id ASC
    `).all(branchId, start, endExclusive);
    const expenses = db.prepare(`
      SELECT id, date, category, description, amount
      FROM transactions
      WHERE branch_id = ? AND type = 'expense' AND date >= ? AND date < ?
      ORDER BY date ASC, id ASC
    `).all(branchId, start, endExclusive);
    const income = db.prepare(`
      SELECT id, date, category, description, amount
      FROM transactions
      WHERE branch_id = ? AND type = 'income' AND lower(category) != 'sales' AND date >= ? AND date < ?
      ORDER BY date ASC, id ASC
    `).all(branchId, start, endExclusive);

    res.json({ month, branch_id: branchId, sales, expenses, income });
  });

  app.get("/api/admin/reports/monthly/export", requireAdmin, async (req, res) => {
    const month = parseYearMonth(req.query.month);
    const scope = typeof req.query.scope === "string" ? req.query.scope.trim() : "summary";
    const branchId = req.query.branchId !== undefined ? parsePositiveInt(req.query.branchId) : null;
    if (!month) {
      return res.status(400).json({ error: "month is required in YYYY-MM format." });
    }
    if (req.query.branchId !== undefined && !branchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    const { start, endExclusive } = getMonthRange(month);

    if (scope === "summary") {
      const supabaseSummary = await getMonthlySummarySupabase(month, branchId);
      if (supabaseSummary) {
        const csvRows = supabaseSummary.summary.map((row) => [
          month,
          row.branch_name,
          row.branch_type,
          row.sales_total,
          row.other_income_total,
          row.revenue_total,
          row.expense_total,
          row.profit_loss,
        ]);
        const csv = toCsv(
          ["month", "branch_name", "branch_type", "sales_total", "other_income_total", "revenue_total", "expense_total", "profit_loss"],
          csvRows,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=\"monthly-summary-${month}.csv\"`);
        return res.send(csv);
      }

      const rows = db.prepare(`
        SELECT
          b.name AS branch_name,
          b.branch_type,
          ROUND(COALESCE(s.sales_total, 0), 2) AS sales_total,
          ROUND(COALESCE(tx.other_income_total, 0), 2) AS other_income_total,
          ROUND(COALESCE(tx.expense_total, 0), 2) AS expense_total
        FROM branches b
        LEFT JOIN (
          SELECT branch_id, SUM(total_amount) AS sales_total
          FROM sales
          WHERE date >= ? AND date < ?
          GROUP BY branch_id
        ) s ON s.branch_id = b.id
        LEFT JOIN (
          SELECT
            branch_id,
            SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense_total,
            SUM(CASE WHEN type = 'income' AND lower(category) != 'sales' THEN amount ELSE 0 END) AS other_income_total
          FROM transactions
          WHERE date >= ? AND date < ?
          GROUP BY branch_id
        ) tx ON tx.branch_id = b.id
        WHERE (? IS NULL OR b.id = ?)
        ORDER BY b.name ASC
      `).all(start, endExclusive, start, endExclusive, branchId, branchId) as Array<{
        branch_name: string;
        branch_type: string;
        sales_total: number;
        other_income_total: number;
        expense_total: number;
      }>;

      const csvRows = rows.map((row) => {
        const revenue = roundToCents(row.sales_total + row.other_income_total);
        const profitLoss = roundToCents(revenue - row.expense_total);
        return [
          month,
          row.branch_name,
          row.branch_type,
          row.sales_total,
          row.other_income_total,
          revenue,
          row.expense_total,
          profitLoss,
        ];
      });
      const csv = toCsv(
        [
          "month",
          "branch_name",
          "branch_type",
          "sales_total",
          "other_income_total",
          "revenue_total",
          "expense_total",
          "profit_loss",
        ],
        csvRows,
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"monthly-summary-${month}.csv\"`);
      return res.send(csv);
    }

    if (!branchId) {
      return res.status(400).json({ error: "branchId is required for details export." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: branch }, { data: sales }, { data: expenses }, { data: income }] = await Promise.all([
        supabaseAdmin.from("branches").select("name").eq("id", branchId).maybeSingle(),
        supabaseAdmin
          .from("sales")
          .select("date, payment_method, total_amount")
          .eq("branch_id", branchId)
          .gte("date", start)
          .lt("date", endExclusive),
        supabaseAdmin
          .from("transactions")
          .select("date, category, description, amount")
          .eq("branch_id", branchId)
          .eq("type", "expense")
          .gte("date", start)
          .lt("date", endExclusive),
        supabaseAdmin
          .from("transactions")
          .select("date, category, description, amount")
          .eq("branch_id", branchId)
          .eq("type", "income")
          .gte("date", start)
          .lt("date", endExclusive),
      ]);

      if (branch) {
        const detailsRows: Array<{ date: string; entry_type: string; category: string; description: string; amount: number }> = [
          ...(sales ?? []).map((row) => ({
            date: row.date,
            entry_type: "sale",
            category: row.payment_method,
            description: "",
            amount: Number(row.total_amount),
          })),
          ...(expenses ?? []).map((row) => ({
            date: row.date,
            entry_type: "expense",
            category: row.category,
            description: row.description ?? "",
            amount: Number(row.amount),
          })),
          ...(income ?? [])
            .filter((row) => String(row.category || "").toLowerCase() !== "sales")
            .map((row) => ({
              date: row.date,
              entry_type: "other_income",
              category: row.category,
              description: row.description ?? "",
              amount: Number(row.amount),
            })),
        ].sort((a, b) => a.date.localeCompare(b.date) || a.entry_type.localeCompare(b.entry_type));

        const csv = toCsv(
          ["month", "branch_name", "date", "entry_type", "category", "description", "amount"],
          detailsRows.map((row) => [month, branch.name, row.date, row.entry_type, row.category, row.description, row.amount]),
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=\"store-details-${branchId}-${month}.csv\"`);
        return res.send(csv);
      }
    }

    const branch = db.prepare("SELECT name FROM branches WHERE id = ?").get(branchId) as { name: string } | undefined;
    if (!branch) {
      return res.status(404).json({ error: "Branch not found." });
    }

    const detailsRows = db.prepare(`
      SELECT date, 'sale' AS entry_type, payment_method AS category, '' AS description, total_amount AS amount
      FROM sales
      WHERE branch_id = ? AND date >= ? AND date < ?
      UNION ALL
      SELECT date, 'expense' AS entry_type, category, COALESCE(description, '') AS description, amount
      FROM transactions
      WHERE branch_id = ? AND type = 'expense' AND date >= ? AND date < ?
      UNION ALL
      SELECT date, 'other_income' AS entry_type, category, COALESCE(description, '') AS description, amount
      FROM transactions
      WHERE branch_id = ? AND type = 'income' AND lower(category) != 'sales' AND date >= ? AND date < ?
      ORDER BY date ASC, entry_type ASC
    `).all(
      branchId, start, endExclusive,
      branchId, start, endExclusive,
      branchId, start, endExclusive,
    ) as Array<{ date: string; entry_type: string; category: string; description: string; amount: number }>;

    const csv = toCsv(
      ["month", "branch_name", "date", "entry_type", "category", "description", "amount"],
      detailsRows.map((row) => [month, branch.name, row.date, row.entry_type, row.category, row.description, row.amount]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"store-details-${branchId}-${month}.csv\"`);
    return res.send(csv);
  });

  // --- API Routes ---

  // 0. Sales Records
  app.get("/api/sales-records", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("sales_records")
        .select("id, branch_id, opening_cash, cash_taken_out, taken_by, opened_at, closed_at, status, notes")
        .eq("branch_id", parsedBranchId)
        .order("id", { ascending: false });

      if (!error && data) {
        return res.json(
          data.map((record) => ({
            ...record,
            opening_cash: Number(record.opening_cash),
            cash_taken_out: Number(record.cash_taken_out),
          })),
        );
      }
    }

    const records = db.prepare(`
      SELECT sr.*, b.name AS branch_name
      FROM sales_records sr
      JOIN branches b ON sr.branch_id = b.id
      WHERE sr.branch_id = ?
      ORDER BY sr.id DESC
    `).all(parsedBranchId);
    res.json(records);
  });

  app.get("/api/sales-records/open", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }
    const record = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    res.json(record || null);
  });

  app.post("/api/sales-records", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.body?.branch_id);
    const openingCash = parseNonNegativeNumber(req.body?.opening_cash);
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

    if (!parsedBranchId || openingCash === null) {
      return res.status(400).json({ error: "Invalid sales record input." });
    }
    const existing = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    if (existing) {
      return res.status(400).json({ error: "An open sales record already exists for this branch." });
    }

    const openedAt = new Date().toISOString();

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("sales_records")
        .insert({
          branch_id: parsedBranchId,
          opening_cash: roundToCents(openingCash),
          opened_at: openedAt,
          status: "open",
          notes: notes || null,
        })
        .select("id")
        .single();

      if (!error && data) {
        return res.json({ success: true, id: data.id });
      }
    }

    const info = db.prepare(`
      INSERT INTO sales_records (branch_id, opening_cash, opened_at, status, notes)
      VALUES (?, ?, ?, 'open', ?)
    `).run(parsedBranchId, roundToCents(openingCash), openedAt, notes || null);

    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.post("/api/sales-records/:id/close", async (req, res) => {
    const recordId = parsePositiveInt(req.params.id);
    const cashTakenOut = parseNonNegativeNumber(req.body?.cash_taken_out);
    if (!recordId || cashTakenOut === null) {
      return res.status(400).json({ error: "Invalid close record input." });
    }

    let record: OpenSalesRecord | undefined;

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("sales_records")
        .select("id, branch_id, opening_cash, cash_taken_out, opened_at, closed_at, status, notes")
        .eq("id", recordId)
        .maybeSingle();

      if (!error && data) {
        record = {
          id: Number(data.id),
          branch_id: Number(data.branch_id),
          opening_cash: Number(data.opening_cash),
          cash_taken_out: Number(data.cash_taken_out),
          opened_at: data.opened_at,
          closed_at: data.closed_at,
          status: data.status,
          notes: data.notes,
        };
      }
    }

    if (!record) {
      record = db.prepare("SELECT * FROM sales_records WHERE id = ?").get(recordId) as OpenSalesRecord | undefined;
    }
    if (!record) {
      return res.status(404).json({ error: "Sales record not found." });
    }
    if (record.status !== "open") {
      return res.status(400).json({ error: "Sales record already closed." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const roundedCashTakenOut = roundToCents(cashTakenOut);
      const closedAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("sales_records")
        .update({
          status: "closed",
          closed_at: closedAt,
          cash_taken_out: roundedCashTakenOut,
        })
        .eq("id", recordId);

      if (!updateError) {
        if (roundedCashTakenOut > 0) {
          const businessDate = getRecordBusinessDate(record);
          await supabaseAdmin.from("cash_hand_entries").insert({
            branch_id: record.branch_id,
            type: "in",
            amount: roundedCashTakenOut,
            category: "Record Close Transfer",
            note: `From Sales Record #${recordId}`,
            date: businessDate,
          });
        }

        return res.json({ success: true });
      }
    }

    const closeRecord = db.transaction(() => {
      const roundedCashTakenOut = roundToCents(cashTakenOut);
      const closedAt = new Date().toISOString();

      db.prepare(`
        UPDATE sales_records
        SET status = 'closed', closed_at = ?, cash_taken_out = ?
        WHERE id = ?
      `).run(closedAt, roundedCashTakenOut, recordId);

      if (roundedCashTakenOut > 0) {
        const businessDate = getRecordBusinessDate(record);
        db.prepare(`
          INSERT INTO cash_hand_entries (branch_id, type, amount, category, note, date)
          VALUES (?, 'in', ?, ?, ?, ?)
        `).run(
          record.branch_id,
          roundedCashTakenOut,
          'Record Close Transfer',
          `From Sales Record #${recordId}`,
          businessDate
        );
      }
    });

    closeRecord();

    res.json({ success: true });
  });

  app.get("/api/sales-records/:id/report", async (req, res) => {
    const recordId = parsePositiveInt(req.params.id);
    if (!recordId) {
      return res.status(400).json({ error: "Invalid record id." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data: recordData, error: recordError } = await supabaseAdmin
        .from("sales_records")
        .select("id, branch_id, opening_cash, cash_taken_out, taken_by, opened_at, closed_at, status, notes, branches(name)")
        .eq("id", recordId)
        .maybeSingle();

      if (!recordError && recordData) {
        const recordBranch = asSingle(recordData.branches as { name: string } | { name: string }[] | null);
        const { data: salesData } = await supabaseAdmin
          .from("sales")
          .select("id, total_amount, payment_method, date")
          .eq("record_id", recordId)
          .order("id", { ascending: true });

        const { data: txData } = await supabaseAdmin
          .from("transactions")
          .select("id, type, category, amount, description, date")
          .eq("sales_record_id", recordId)
          .order("id", { ascending: true });

        const sales = (salesData ?? []).map((sale) => ({
          ...sale,
          total_amount: Number(sale.total_amount),
        }));
        const expenses = (txData ?? [])
          .filter((tx) => tx.type === "expense")
          .map((tx) => ({ ...tx, amount: Number(tx.amount) }));

        const totalSales = roundToCents(sales.reduce((sum, sale) => sum + sale.total_amount, 0));
        const cashSales = roundToCents(sales.filter((sale) => sale.payment_method === "cash").reduce((sum, sale) => sum + sale.total_amount, 0));
        const cardSales = roundToCents(sales.filter((sale) => sale.payment_method === "card").reduce((sum, sale) => sum + sale.total_amount, 0));
        const totalIncome = roundToCents((txData ?? []).filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount), 0));
        const totalExpenses = roundToCents(expenses.reduce((sum, tx) => sum + tx.amount, 0));
        const openingCash = Number(recordData.opening_cash);
        const cashTakenOut = Number(recordData.cash_taken_out);
        const expectedClosingCash = roundToCents(openingCash + cashSales - totalExpenses - cashTakenOut);
        const netProfit = roundToCents(totalIncome - totalExpenses);

        return res.json({
          record: {
            ...recordData,
            branch_name: recordBranch?.name ?? "",
            opening_cash: openingCash,
            cash_taken_out: cashTakenOut,
          },
          summary: {
            totalSales,
            cashSales,
            cardSales,
            totalIncome,
            totalExpenses,
            netProfit,
            openingCash,
            cashTakenOut,
            expectedClosingCash,
          },
          sales,
          expenses,
        });
      }
    }

    const record = db.prepare(`
      SELECT sr.*, b.name AS branch_name
      FROM sales_records sr
      JOIN branches b ON sr.branch_id = b.id
      WHERE sr.id = ?
    `).get(recordId) as (OpenSalesRecord & { branch_name: string }) | undefined;

    if (!record) {
      return res.status(404).json({ error: "Sales record not found." });
    }

    const saleStats = db.prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total_amount ELSE 0 END), 0) AS card_sales
      FROM sales
      WHERE record_id = ?
    `).get(recordId) as { total_sales: number; cash_sales: number; card_sales: number };

    const txStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total
      FROM transactions
      WHERE sales_record_id = ?
    `).get(recordId) as { income_total: number; expense_total: number };

    const expensesExcludingSales = roundToCents(Math.max(0, txStats.expense_total));
    const expectedCash = roundToCents(record.opening_cash + saleStats.cash_sales - expensesExcludingSales - record.cash_taken_out);
    const totalIncome = roundToCents(txStats.income_total);
    const netProfit = roundToCents(totalIncome - expensesExcludingSales);

    const sales = db.prepare(`
      SELECT id, total_amount, payment_method, date
      FROM sales
      WHERE record_id = ?
      ORDER BY id ASC
    `).all(recordId);

    const expenses = db.prepare(`
      SELECT id, category, amount, description, date
      FROM transactions
      WHERE sales_record_id = ? AND type = 'expense'
      ORDER BY id ASC
    `).all(recordId);

    res.json({
      record,
      summary: {
        totalSales: roundToCents(saleStats.total_sales),
        cashSales: roundToCents(saleStats.cash_sales),
        cardSales: roundToCents(saleStats.card_sales),
        totalIncome,
        totalExpenses: expensesExcludingSales,
        netProfit,
        openingCash: roundToCents(record.opening_cash),
        cashTakenOut: roundToCents(record.cash_taken_out),
        expectedClosingCash: expectedCash,
      },
      sales,
      expenses,
    });
  });

  // 1. Branches
  app.get("/api/branches", async (req, res) => {
    const user = req.user!;
    const branchType =
      req.query.type === "warehouse" || req.query.type === "store" || req.query.type === "massage_center"
        ? req.query.type
        : null;

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("branches")
        .select("id, name, location, branch_type, phone, manager_name, is_active")
        .order("name", { ascending: true });

      if (branchType) {
        query = query.eq("branch_type", branchType);
      }

      if (user.role !== "admin") {
        const allowedBranchIds = await getAllowedBranchIds(user.id);
        if (allowedBranchIds.length === 0) {
          return res.json([]);
        }
        query = query.in("id", allowedBranchIds);
      }

      const { data, error } = await query;
      if (!error && data) {
        return res.json(
          data.map((branch: SupabaseBranch) => ({
            ...branch,
            is_active: toSqliteBool(branch.is_active),
          })),
        );
      }
    }

    let branches;
    if (user.role === "admin") {
      branches = branchType
        ? db.prepare("SELECT * FROM branches WHERE branch_type = ? ORDER BY name ASC").all(branchType)
        : db.prepare("SELECT * FROM branches ORDER BY name ASC").all();
    } else {
      const allowedBranchIds = await getAllowedBranchIds(user.id);
      if (allowedBranchIds.length === 0) {
        return res.json([]);
      }
      const placeholders = allowedBranchIds.map(() => "?").join(", ");
      if (branchType) {
        branches = db
          .prepare(`SELECT * FROM branches WHERE id IN (${placeholders}) AND branch_type = ? ORDER BY name ASC`)
          .all(...allowedBranchIds, branchType);
      } else {
        branches = db.prepare(`SELECT * FROM branches WHERE id IN (${placeholders}) ORDER BY name ASC`).all(...allowedBranchIds);
      }
    }
    res.json(branches);
  });

  // 2. Distributors
  app.get("/api/distributors", async (req, res) => {
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("distributors")
        .select("*")
        .order("name", { ascending: true });

      if (!error && data) {
        return res.json(
          data.map((row) => ({
            ...row,
            is_active: toSqliteBool(row.is_active),
          })),
        );
      }
    }

    const distributors = db.prepare('SELECT * FROM distributors ORDER BY name ASC').all();
    res.json(distributors);
  });

  app.post("/api/distributors", (req, res) => {
    const { name, phone, email, address, pending_amount } = req.body;
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim() : "";
    const normalizedAddress = typeof address === "string" ? address.trim() : "";
    const parsedPendingAmount = pending_amount === undefined || pending_amount === null
      ? 0
      : parseNonNegativeNumber(pending_amount);

    if (!normalizedName || parsedPendingAmount === null) {
      return res.status(400).json({ error: "Invalid distributor input." });
    }

    const stmt = db.prepare('INSERT INTO distributors (name, phone, email, address, pending_amount) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(normalizedName, normalizedPhone || null, normalizedEmail || null, normalizedAddress || null, roundToCents(parsedPendingAmount));
    res.json({ id: info.lastInsertRowid });
  });

  app.post("/api/distributors/:id/payment", (req, res) => {
    const distributorId = parsePositiveInt(req.params.id);
    const amount = parseNonNegativeNumber(req.body?.amount);
    const paymentSource = req.body?.payment_source === "hand" ? "hand" : "drawer";
    const parsedBranchId = req.body?.branch_id === undefined || req.body?.branch_id === null
      ? null
      : parsePositiveInt(req.body.branch_id);
    if (!distributorId || amount === null || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment input." });
    }
    if (req.body?.branch_id !== undefined && req.body?.branch_id !== null && !parsedBranchId) {
      return res.status(400).json({ error: "Invalid branch_id for payment." });
    }

    const distributor = db.prepare('SELECT id, name, pending_amount FROM distributors WHERE id = ?').get(distributorId) as { id: number; name: string; pending_amount: number } | undefined;
    if (!distributor) {
      return res.status(404).json({ error: "Distributor not found." });
    }
    const appliedAmount = roundToCents(Math.min(amount, distributor.pending_amount));
    if (appliedAmount <= 0) {
      return res.status(400).json({ error: "No pending balance to pay for this distributor." });
    }

    const nextPending = roundToCents(Math.max(0, distributor.pending_amount - appliedAmount));
    const applyPayment = db.transaction(() => {
      db.prepare('UPDATE distributors SET pending_amount = ? WHERE id = ?').run(nextPending, distributorId);
      if (parsedBranchId) {
        const openRecord = getOpenRecordByBranch(parsedBranchId);
        const isDrawerSource = paymentSource === "drawer";
        const txDate = isDrawerSource && openRecord ? getRecordBusinessDate(openRecord) : getTodayIsoDate();
        db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(
            parsedBranchId,
            isDrawerSource ? (openRecord?.id || null) : null,
            'expense',
            'Distributor Payment',
            appliedAmount,
            `${distributor.name} payment (${isDrawerSource ? "cash from drawer" : "cash in hand"})`,
            txDate
          );
        if (!isDrawerSource) {
          db.prepare('INSERT INTO cash_hand_entries (branch_id, type, amount, category, note, date) VALUES (?, ?, ?, ?, ?, ?)')
            .run(parsedBranchId, 'out', appliedAmount, 'Distributor Payment', `${distributor.name} payment`, txDate);
        }
      }
    });

    applyPayment();
    res.json({ success: true, pending_amount: nextPending, applied_amount: appliedAmount });
  });

  // 3. Product Master
  app.get("/api/products", async (req, res) => {
    const { q } = req.query;
    const queryText = typeof q === "string" ? q.trim() : "";

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("products")
        .select("id, name, category, barcode, price, cost, sku, is_active")
        .order("name", { ascending: true });

      if (queryText) {
        const escaped = queryText.replace(/[%_,]/g, "");
        query = query.or(`name.ilike.%${escaped}%,category.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%`);
      }

      const { data, error } = await query;
      if (!error && data) {
        return res.json(
          data.map((product: SupabaseProduct) => ({
            ...product,
            is_active: toSqliteBool(product.is_active),
          })),
        );
      }
    }

    if (!queryText) {
      const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
      return res.json(products);
    }
    const products = db.prepare(`
      SELECT * FROM products
      WHERE name LIKE ? OR category LIKE ? OR sku LIKE ? OR barcode LIKE ?
      ORDER BY name ASC
    `).all(`%${queryText}%`, `%${queryText}%`, `%${queryText}%`, `%${queryText}%`);
    return res.json(products);
  });

  app.post("/api/products", async (req, res) => {
    const { name, category, barcode, price, cost, sku } = req.body;
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedCategory = typeof category === "string" ? category.trim() : "";
    const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
    const normalizedSku = typeof sku === "string" ? sku.trim() : "";
    const parsedPrice = parseNonNegativeNumber(price);
    const parsedCost = parseNonNegativeNumber(cost);

    if (!normalizedName || !normalizedCategory || parsedPrice === null || parsedCost === null) {
      return res.status(400).json({ error: "Invalid product input." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("products")
        .insert({
          name: normalizedName,
          category: normalizedCategory,
          barcode: normalizedBarcode || null,
          price: roundToCents(parsedPrice),
          cost: roundToCents(parsedCost),
          sku: normalizedSku || null,
        })
        .select("id")
        .single();

      if (!error && data) {
        return res.json({ id: data.id });
      }
    }

    const result = db.prepare("INSERT INTO products (name, category, barcode, price, cost, sku) VALUES (?, ?, ?, ?, ?, ?)")
      .run(normalizedName, normalizedCategory, normalizedBarcode || null, roundToCents(parsedPrice), roundToCents(parsedCost), normalizedSku || null);
    return res.json({ success: true, id: result.lastInsertRowid });
  });

  app.post("/api/products/bulk-upsert", (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) {
      return res.status(400).json({ error: "Invalid bulk payload." });
    }

    const findByBarcode = db.prepare("SELECT id FROM products WHERE barcode = ?");
    const findBySku = db.prepare("SELECT id FROM products WHERE sku = ?");
    const updateById = db.prepare(`
      UPDATE products
      SET name = ?, category = ?, barcode = ?, price = ?, cost = ?, sku = ?
      WHERE id = ?
    `);
    const insertProduct = db.prepare(`
      INSERT INTO products (name, category, barcode, price, cost, sku)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const applyBulkUpsert = db.transaction(() => {
      for (const row of rows) {
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        const category = typeof row?.category === "string" ? row.category.trim() : "";
        const barcode = typeof row?.barcode === "string" ? row.barcode.trim() : "";
        const sku = typeof row?.sku === "string" ? row.sku.trim() : "";
        const cost = parseNonNegativeNumber(row?.cost);
        const price = parseNonNegativeNumber(row?.price);

        if (!name || !category || cost === null || price === null) {
          skipped += 1;
          continue;
        }

        let existingId: number | null = null;
        if (barcode) {
          const existing = findByBarcode.get(barcode) as { id: number } | undefined;
          if (existing) existingId = existing.id;
        }
        if (!existingId && sku) {
          const existing = findBySku.get(sku) as { id: number } | undefined;
          if (existing) existingId = existing.id;
        }

        if (existingId) {
          updateById.run(
            name,
            category,
            barcode || null,
            roundToCents(price),
            roundToCents(cost),
            sku || null,
            existingId
          );
          updated += 1;
        } else {
          insertProduct.run(
            name,
            category,
            barcode || null,
            roundToCents(price),
            roundToCents(cost),
            sku || null
          );
          created += 1;
        }
      }
    });

    try {
      applyBulkUpsert();
      res.json({ success: true, created, updated, skipped, total: rows.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3b. Cash In Hand Ledger
  app.get("/api/cash-hand", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("cash_hand_entries")
        .select("*")
        .eq("branch_id", parsedBranchId)
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .limit(200);
      if (!error && data) {
        const entries = data.map((row) => ({ ...row, amount: Number(row.amount) }));
        const totalIn = roundToCents(entries.filter((e) => e.type === "in").reduce((sum, e) => sum + e.amount, 0));
        const totalOut = roundToCents(entries.filter((e) => e.type === "out").reduce((sum, e) => sum + e.amount, 0));
        return res.json({ balance: roundToCents(totalIn - totalOut), totalIn, totalOut, entries });
      }
    }

    const entries = db.prepare(`
      SELECT *
      FROM cash_hand_entries
      WHERE branch_id = ?
      ORDER BY date DESC, id DESC
      LIMIT 200
    `).all(parsedBranchId);

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_hand_entries
      WHERE branch_id = ?
    `).get(parsedBranchId) as { total_in: number; total_out: number };

    const balance = roundToCents(totals.total_in - totals.total_out);
    res.json({
      balance,
      totalIn: roundToCents(totals.total_in),
      totalOut: roundToCents(totals.total_out),
      entries,
    });
  });

  app.post("/api/cash-hand", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.body?.branch_id);
    const entryType = req.body?.type === "in" ? "in" : req.body?.type === "out" ? "out" : null;
    const parsedAmount = parseNonNegativeNumber(req.body?.amount);
    const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : getTodayIsoDate();

    if (!parsedBranchId || !entryType || parsedAmount === null || parsedAmount <= 0 || !category) {
      return res.status(400).json({ error: "Invalid cash in hand entry." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("cash_hand_entries")
        .insert({
          branch_id: parsedBranchId,
          type: entryType,
          amount: roundToCents(parsedAmount),
          category,
          note: note || null,
          date,
        })
        .select("id")
        .single();
      if (!error && data) {
        return res.json({ success: true, id: data.id });
      }
    }

    const info = db.prepare(`
      INSERT INTO cash_hand_entries (branch_id, type, amount, category, note, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(parsedBranchId, entryType, roundToCents(parsedAmount), category, note || null, date);

    res.json({ success: true, id: info.lastInsertRowid });
  });

  // 4. Inventory (Per Branch)
  app.get("/api/inventory", async (req, res) => {
    const { branchId } = req.query;

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("inventory")
        .select(`
          id,
          product_id,
          branch_id,
          stock_level,
          reorder_point,
          mfg_date,
          expiry_date,
          products:products(id, name, category, barcode, price, cost, sku),
          branches:branches(name)
        `);

      if (branchId) {
        query = query.eq("branch_id", branchId);
      }

      const { data, error } = await query;
      if (!error && data) {
        return res.json(
          (data as SupabaseInventoryRow[]).map((item) => {
            const product = asSingle(item.products);
            const branch = asSingle(item.branches);
            return {
              id: item.id,
              product_id: item.product_id,
              branch_id: item.branch_id,
              stock_level: item.stock_level,
              reorder_point: item.reorder_point ?? 10,
              mfg_date: item.mfg_date,
              expiry_date: item.expiry_date,
              name: product?.name ?? null,
              category: product?.category ?? null,
              barcode: product?.barcode ?? null,
              price: product?.price ?? 0,
              cost: product?.cost ?? 0,
              sku: product?.sku ?? null,
              branch_name: branch?.name ?? null,
            };
          }),
        );
      }
    }

    let query = `
      SELECT i.*, p.name, p.category, p.barcode, p.price, p.cost, p.sku, b.name as branch_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
    `;
    const params = [];
    
    if (branchId) {
      query += ` WHERE i.branch_id = ?`;
      params.push(branchId);
    }
    
    const items = db.prepare(query).all(...params);
    res.json(items);
  });

  app.get("/api/warehouse/inventory", async (req, res) => {
    const warehouseBranchId = parsePositiveInt(req.query.warehouse_branch_id);
    if (!warehouseBranchId) {
      return res.status(400).json({ error: "Invalid warehouse_branch_id." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const warehouse = await getBranchByIdSupabase(warehouseBranchId);
      if (warehouse && warehouse.branch_type !== "warehouse") {
        return res.status(400).json({ error: "Invalid warehouse branch." });
      }

      const { data, error } = await supabaseAdmin
        .from("inventory")
        .select(`
          id,
          product_id,
          branch_id,
          stock_level,
          reorder_point,
          mfg_date,
          expiry_date,
          products:products(id, name, category, barcode, price, cost, sku),
          branches:branches(name)
        `)
        .eq("branch_id", warehouseBranchId)
        .gt("stock_level", 0)
        .order("product_id", { ascending: true });

      if (!error && data) {
        return res.json(
          (data as SupabaseInventoryRow[]).map((item) => {
            const product = asSingle(item.products);
            const branch = asSingle(item.branches);
            return {
              id: item.id,
              product_id: item.product_id,
              branch_id: item.branch_id,
              stock_level: item.stock_level,
              reorder_point: item.reorder_point ?? 10,
              mfg_date: item.mfg_date,
              expiry_date: item.expiry_date,
              name: product?.name ?? null,
              category: product?.category ?? null,
              barcode: product?.barcode ?? null,
              price: product?.price ?? 0,
              cost: product?.cost ?? 0,
              sku: product?.sku ?? null,
              branch_name: branch?.name ?? null,
            };
          }),
        );
      }
    }

    const warehouse = db.prepare("SELECT id, branch_type FROM branches WHERE id = ?").get(warehouseBranchId) as { id: number; branch_type: string } | undefined;
    if (!warehouse || warehouse.branch_type !== "warehouse") {
      return res.status(400).json({ error: "Invalid warehouse branch." });
    }

    const items = db.prepare(`
      SELECT i.*, p.name, p.category, p.barcode, p.price, p.cost, p.sku, b.name as branch_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE i.branch_id = ? AND i.stock_level > 0
      ORDER BY p.name ASC
    `).all(warehouseBranchId);

    res.json(items);
  });

  app.post("/api/warehouse/inventory/add", async (req, res) => {
    const warehouseBranchId = parsePositiveInt(req.body?.warehouse_branch_id);
    const quantity = parsePositiveInt(req.body?.quantity);
    const cost = parseNonNegativeNumber(req.body?.cost);
    const price = parseNonNegativeNumber(req.body?.price);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const barcode = typeof req.body?.barcode === "string" ? req.body.barcode.trim() : "";
    const parsedMfgDate = parseDateString(req.body?.mfg_date);
    const parsedExpiryDate = parseDateString(req.body?.expiry_date);

    if (!warehouseBranchId || !name || !quantity || cost === null || price === null) {
      return res.status(400).json({ error: "Invalid warehouse stock input." });
    }
    if (req.body?.mfg_date !== undefined && req.body?.mfg_date !== null && !parsedMfgDate) {
      return res.status(400).json({ error: "Invalid manufacturing date." });
    }
    if (req.body?.expiry_date !== undefined && req.body?.expiry_date !== null && !parsedExpiryDate) {
      return res.status(400).json({ error: "Invalid expiry date." });
    }
    if (parsedMfgDate && parsedExpiryDate && parsedExpiryDate < parsedMfgDate) {
      return res.status(400).json({ error: "Expiry date cannot be before manufacturing date." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const warehouse = await getBranchByIdSupabase(warehouseBranchId);
      if (warehouse && warehouse.branch_type !== "warehouse") {
        return res.status(400).json({ error: "Invalid warehouse branch." });
      }

      let productId: number | null = null;

      if (barcode) {
        const { data } = await supabaseAdmin.from("products").select("id").eq("barcode", barcode).maybeSingle();
        if (data) productId = Number(data.id);
      }

      if (!productId) {
        const { data } = await supabaseAdmin.from("products").select("id").ilike("name", name).limit(1).maybeSingle();
        if (data) productId = Number(data.id);
      }

      if (productId) {
        const { error } = await supabaseAdmin
          .from("products")
          .update({
            name,
            category: "Warehouse",
            ...(barcode ? { barcode } : {}),
            price: roundToCents(price),
            cost: roundToCents(cost),
          })
          .eq("id", productId);
        if (error) productId = null;
      }

      if (!productId) {
        const { data, error } = await supabaseAdmin
          .from("products")
          .insert({
            name,
            category: "Warehouse",
            barcode: barcode || null,
            price: roundToCents(price),
            cost: roundToCents(cost),
            sku: null,
          })
          .select("id")
          .single();
        if (!error && data) productId = Number(data.id);
      }

      if (productId) {
        const { data: existingInventory, error: invError } = await supabaseAdmin
          .from("inventory")
          .select("id, stock_level")
          .eq("branch_id", warehouseBranchId)
          .eq("product_id", productId)
          .maybeSingle();

        if (!invError) {
          if (existingInventory) {
            const { error: updateError } = await supabaseAdmin
              .from("inventory")
              .update({
                stock_level: Number(existingInventory.stock_level) + quantity,
                ...(parsedMfgDate ? { mfg_date: parsedMfgDate } : {}),
                ...(parsedExpiryDate ? { expiry_date: parsedExpiryDate } : {}),
              })
              .eq("id", existingInventory.id);
            if (!updateError) {
              return res.json({ success: true, productId });
            }
          } else {
            const { error: insertError } = await supabaseAdmin
              .from("inventory")
              .insert({
                product_id: productId,
                branch_id: warehouseBranchId,
                stock_level: quantity,
                reorder_point: 10,
                mfg_date: parsedMfgDate ?? null,
                expiry_date: parsedExpiryDate ?? null,
              });
            if (!insertError) {
              return res.json({ success: true, productId });
            }
          }
        }
      }
    }

    const warehouse = db.prepare("SELECT id, branch_type FROM branches WHERE id = ?").get(warehouseBranchId) as { id: number; branch_type: string } | undefined;
    if (!warehouse || warehouse.branch_type !== "warehouse") {
      return res.status(400).json({ error: "Invalid warehouse branch." });
    }

    const applyWarehouseStock = db.transaction(() => {
      let productId: number | null = null;

      if (barcode) {
        const byBarcode = db.prepare("SELECT id FROM products WHERE barcode = ?").get(barcode) as { id: number } | undefined;
        if (byBarcode) {
          productId = byBarcode.id;
        }
      }

      if (!productId) {
        const byName = db.prepare("SELECT id FROM products WHERE name = ? COLLATE NOCASE LIMIT 1").get(name) as { id: number } | undefined;
        if (byName) {
          productId = byName.id;
        }
      }

      if (productId) {
        db.prepare(`
          UPDATE products
          SET name = ?, category = ?, barcode = COALESCE(?, barcode), price = ?, cost = ?
          WHERE id = ?
        `).run(name, "Warehouse", barcode || null, roundToCents(price), roundToCents(cost), productId);
      } else {
        const productResult = db.prepare(`
          INSERT INTO products (name, category, barcode, price, cost, sku)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, "Warehouse", barcode || null, roundToCents(price), roundToCents(cost), null);
        productId = Number(productResult.lastInsertRowid);
      }

      const existingInventory = db.prepare("SELECT id FROM inventory WHERE branch_id = ? AND product_id = ?")
        .get(warehouseBranchId, productId) as { id: number } | undefined;

      if (existingInventory) {
        db.prepare(`
          UPDATE inventory
          SET stock_level = stock_level + ?, mfg_date = COALESCE(?, mfg_date), expiry_date = COALESCE(?, expiry_date)
          WHERE branch_id = ? AND product_id = ?
        `).run(quantity, parsedMfgDate ?? null, parsedExpiryDate ?? null, warehouseBranchId, productId);
      } else {
        db.prepare(`
          INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point, mfg_date, expiry_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(productId, warehouseBranchId, quantity, 10, parsedMfgDate ?? null, parsedExpiryDate ?? null);
      }

      return productId;
    });

    try {
      const productId = applyWarehouseStock();
      res.json({ success: true, productId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/inventory", (req, res) => {
    const { branch_id, name, category, barcode, price, cost, sku, stock_level, reorder_point, mfg_date, expiry_date } = req.body;
    const parsedBranchId = parsePositiveInt(branch_id);
    const parsedPrice = parseNonNegativeNumber(price);
    const parsedCost = parseNonNegativeNumber(cost);
    const parsedStock = parsePositiveInt(stock_level);
    const parsedReorderPoint = reorder_point === undefined || reorder_point === null
      ? 10
      : parseNonNegativeNumber(reorder_point);
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedCategory = typeof category === "string" ? category.trim() : "";
    const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
    const normalizedSku = typeof sku === "string" ? sku.trim() : "";
    const parsedMfgDate = parseDateString(mfg_date);
    const parsedExpiryDate = parseDateString(expiry_date);
    if (mfg_date !== undefined && mfg_date !== null && !parsedMfgDate) {
      return res.status(400).json({ error: "Invalid manufacturing date." });
    }
    if (expiry_date !== undefined && expiry_date !== null && !parsedExpiryDate) {
      return res.status(400).json({ error: "Invalid expiry date." });
    }
    if (parsedMfgDate && parsedExpiryDate && parsedExpiryDate < parsedMfgDate) {
      return res.status(400).json({ error: "Expiry date cannot be before manufacturing date." });
    }

    if (!parsedBranchId || !normalizedName || !normalizedCategory || parsedPrice === null || parsedCost === null || !parsedStock || parsedReorderPoint === null) {
      return res.status(400).json({ error: "Invalid inventory input." });
    }

    const createInventoryItem = db.transaction(() => {
      const productResult = db
        .prepare("INSERT INTO products (name, category, barcode, price, cost, sku) VALUES (?, ?, ?, ?, ?, ?)")
        .run(normalizedName, normalizedCategory, normalizedBarcode || null, roundToCents(parsedPrice), roundToCents(parsedCost), normalizedSku || null);
      const productId = Number(productResult.lastInsertRowid);

      db.prepare("INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point) VALUES (?, ?, ?, ?)")
        .run(productId, parsedBranchId, parsedStock, Math.round(parsedReorderPoint));

      db.prepare("UPDATE inventory SET mfg_date = ?, expiry_date = ? WHERE product_id = ? AND branch_id = ?")
        .run(parsedMfgDate, parsedExpiryDate, productId, parsedBranchId);

      return productId;
    });

    try {
      const productId = createInventoryItem();
      res.json({ success: true, productId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/inventory/stock", async (req, res) => {
    const { branch_id, product_id, quantity, reorder_point, mfg_date, expiry_date } = req.body;
    const parsedBranchId = parsePositiveInt(branch_id);
    const parsedProductId = parsePositiveInt(product_id);
    const parsedQuantity = parsePositiveInt(quantity);
    const reorderProvided = !(reorder_point === undefined || reorder_point === null || reorder_point === "");
    const parsedReorderPoint = reorderProvided ? parseNonNegativeNumber(reorder_point) : null;
    const parsedMfgDate = parseDateString(mfg_date);
    const parsedExpiryDate = parseDateString(expiry_date);

    if (!parsedBranchId || !parsedProductId || !parsedQuantity || (reorderProvided && parsedReorderPoint === null)) {
      return res.status(400).json({ error: "Invalid stock update input." });
    }
    if (mfg_date !== undefined && mfg_date !== null && !parsedMfgDate) {
      return res.status(400).json({ error: "Invalid manufacturing date." });
    }
    if (expiry_date !== undefined && expiry_date !== null && !parsedExpiryDate) {
      return res.status(400).json({ error: "Invalid expiry date." });
    }
    if (parsedMfgDate && parsedExpiryDate && parsedExpiryDate < parsedMfgDate) {
      return res.status(400).json({ error: "Expiry date cannot be before manufacturing date." });
    }

    const product = db.prepare("SELECT id FROM products WHERE id = ?").get(parsedProductId) as { id: number } | undefined;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data: supabaseProduct, error: productError } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("id", parsedProductId)
        .maybeSingle();

      if (!productError && !supabaseProduct) {
        return res.status(404).json({ error: "Product not found in product database." });
      }

      if (!productError && supabaseProduct) {
        const { data: existingInventory, error: inventoryError } = await supabaseAdmin
          .from("inventory")
          .select("id, reorder_point, stock_level, mfg_date, expiry_date")
          .eq("branch_id", parsedBranchId)
          .eq("product_id", parsedProductId)
          .maybeSingle();

        if (!inventoryError) {
          if (existingInventory) {
            const { error: updateError } = await supabaseAdmin
              .from("inventory")
              .update({
                stock_level: Number(existingInventory.stock_level) + parsedQuantity,
                ...(parsedReorderPoint !== null ? { reorder_point: Math.round(parsedReorderPoint) } : {}),
                ...(parsedMfgDate ? { mfg_date: parsedMfgDate } : {}),
                ...(parsedExpiryDate ? { expiry_date: parsedExpiryDate } : {}),
              })
              .eq("id", existingInventory.id);

            if (!updateError) {
              return res.json({ success: true });
            }
          } else {
            const { error: insertError } = await supabaseAdmin
              .from("inventory")
              .insert({
                product_id: parsedProductId,
                branch_id: parsedBranchId,
                stock_level: parsedQuantity,
                reorder_point: parsedReorderPoint !== null ? Math.round(parsedReorderPoint) : 10,
                mfg_date: parsedMfgDate,
                expiry_date: parsedExpiryDate,
              });

            if (!insertError) {
              return res.json({ success: true });
            }
          }
        }
      }
    }

    if (!product) {
      return res.status(404).json({ error: "Product not found in product database." });
    }

    const applyStock = db.transaction(() => {
      const existingInventory = db.prepare("SELECT id, reorder_point FROM inventory WHERE branch_id = ? AND product_id = ?")
        .get(parsedBranchId, parsedProductId) as { id: number; reorder_point: number } | undefined;

      if (existingInventory) {
        const updateMfgDate = parsedMfgDate ?? null;
        const updateExpiryDate = parsedExpiryDate ?? null;
        if (parsedReorderPoint !== null) {
          db.prepare(`
            UPDATE inventory
            SET stock_level = stock_level + ?, reorder_point = ?, mfg_date = COALESCE(?, mfg_date), expiry_date = COALESCE(?, expiry_date)
            WHERE branch_id = ? AND product_id = ?
          `).run(parsedQuantity, Math.round(parsedReorderPoint), updateMfgDate, updateExpiryDate, parsedBranchId, parsedProductId);
        } else {
          db.prepare(`
            UPDATE inventory
            SET stock_level = stock_level + ?, mfg_date = COALESCE(?, mfg_date), expiry_date = COALESCE(?, expiry_date)
            WHERE branch_id = ? AND product_id = ?
          `).run(parsedQuantity, updateMfgDate, updateExpiryDate, parsedBranchId, parsedProductId);
        }
      } else {
        db.prepare(`
          INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point, mfg_date, expiry_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(parsedProductId, parsedBranchId, parsedQuantity, parsedReorderPoint !== null ? Math.round(parsedReorderPoint) : 10, parsedMfgDate, parsedExpiryDate);
      }
    });

    try {
      applyStock();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Transactions (Per Branch)
  app.get("/api/transactions", async (req, res) => {
    const { branchId, type, date } = req.query;

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("transactions")
        .select("id, branch_id, sales_record_id, type, category, amount, description, date, created_at, branches(name)")
        .order("date", { ascending: false })
        .order("id", { ascending: false });

      if (branchId) query = query.eq("branch_id", branchId);
      if (type) query = query.eq("type", type);
      if (typeof date === "string" && date.trim()) query = query.eq("date", date.trim());

      const { data, error } = await query;
      if (!error && data) {
        return res.json(
          data.map((tx) => ({
            ...tx,
            amount: Number(tx.amount),
            branch_name: asSingle(tx.branches as { name: string } | { name: string }[] | null)?.name ?? null,
          })),
        );
      }
    }

    let query = `
      SELECT t.*, b.name as branch_name 
      FROM transactions t
      JOIN branches b ON t.branch_id = b.id
    `;
    const params = [];
    const conditions = [];

    if (branchId) {
      conditions.push('t.branch_id = ?');
      params.push(branchId);
    }
    if (type) {
      conditions.push('t.type = ?');
      params.push(type);
    }
    if (typeof date === "string" && date.trim()) {
      conditions.push('t.date = ?');
      params.push(date.trim());
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY t.date DESC, t.id DESC';
    const transactions = db.prepare(query).all(...params);
    res.json(transactions);
  });

  app.get("/api/sales", (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    const selectedDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    const conditions = ['s.branch_id = ?'];
    const params: Array<number | string> = [parsedBranchId];
    if (selectedDate) {
      conditions.push('s.date = ?');
      params.push(selectedDate);
    }

    const sales = db.prepare(`
      SELECT s.id, s.branch_id, s.record_id, s.total_amount, s.payment_method, s.date
      FROM sales s
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.id DESC
    `).all(...params);

    res.json(sales);
  });

  app.post("/api/transactions", async (req, res) => {
    const { branch_id, type, category, amount, description, date } = req.body;
    const parsedBranchId = parsePositiveInt(branch_id);
    const parsedAmount = parseNonNegativeNumber(amount);
    const normalizedType = type === "income" || type === "expense" ? type : null;
    const normalizedCategory = typeof category === "string" ? category.trim() : "";
    const normalizedDate = typeof date === "string" ? date : "";
    const normalizedDescription = typeof description === "string" ? description.trim() : "";

    if (!parsedBranchId || !normalizedType || !normalizedCategory || !normalizedDate || parsedAmount === null) {
      return res.status(400).json({ error: "Invalid transaction input." });
    }

    const openRecord = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    const entryDate = openRecord ? getRecordBusinessDate(openRecord) : normalizedDate;
    const amountRounded = roundToCents(parsedAmount);

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("transactions")
        .insert({
          branch_id: parsedBranchId,
          sales_record_id: openRecord?.id || null,
          type: normalizedType,
          category: normalizedCategory,
          amount: amountRounded,
          description: normalizedDescription || null,
          date: entryDate,
        })
        .select("id")
        .single();

      if (!error && data) {
        return res.json({ id: data.id });
      }
    }

    const stmt = db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = stmt.run(parsedBranchId, openRecord?.id || null, normalizedType, normalizedCategory, amountRounded, normalizedDescription, entryDate);
    res.json({ id: info.lastInsertRowid });
  });

  // 6. POS - Process Sale
  app.post("/api/pos/sale", async (req, res) => {
    const { branch_id, items, payment_method } = req.body; // items: [{ product_id, quantity, price }]
    const parsedBranchId = parsePositiveInt(branch_id);
    const normalizedPaymentMethod = payment_method === "card" ? "card" : "cash";
    if (!parsedBranchId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid sale input." });
    }
    const openRecord = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    if (!openRecord) {
      return res.status(400).json({ error: "No open sales record. Create/open a sales record first." });
    }

    const normalizedItems: PosItemInput[] = [];
    for (const rawItem of items) {
      const productId = parsePositiveInt(rawItem?.product_id);
      const quantity = parsePositiveInt(rawItem?.quantity);
      const price = parseNonNegativeNumber(rawItem?.price);
      if (!productId || !quantity || price === null) {
        return res.status(400).json({ error: "Invalid sale item data." });
      }
      normalizedItems.push({ product_id: productId, quantity, price: roundToCents(price) });
    }

    const date = getRecordBusinessDate(openRecord);
    let totalCents = 0;

    if (useSupabaseBackend && supabaseAdmin) {
      normalizedItems.forEach((item) => {
        totalCents += toCents(item.price) * item.quantity;
      });
      const total = fromCents(totalCents);

      for (const item of normalizedItems) {
        const { data: stockRow, error } = await supabaseAdmin
          .from("inventory")
          .select("id, stock_level")
          .eq("product_id", item.product_id)
          .eq("branch_id", parsedBranchId)
          .maybeSingle();

        if (error || !stockRow) {
          return res.status(500).json({ error: `Inventory item ${item.product_id} not found for branch ${parsedBranchId}.` });
        }
        if (Number(stockRow.stock_level) < item.quantity) {
          return res.status(500).json({ error: `Insufficient stock for product ${item.product_id}. Available: ${stockRow.stock_level}, requested: ${item.quantity}.` });
        }
      }

      const { data: saleData, error: saleError } = await supabaseAdmin
        .from("sales")
        .insert({
          branch_id: parsedBranchId,
          record_id: openRecord.id,
          total_amount: total,
          payment_method: normalizedPaymentMethod,
          date,
        })
        .select("id")
        .single();

      if (!saleError && saleData) {
        const saleId = Number(saleData.id);
        for (const item of normalizedItems) {
          await supabaseAdmin.from("sale_items").insert({
            sale_id: saleId,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_sale: item.price,
          });
          const { data: stockRow } = await supabaseAdmin
            .from("inventory")
            .select("id, stock_level")
            .eq("product_id", item.product_id)
            .eq("branch_id", parsedBranchId)
            .maybeSingle();
          if (stockRow) {
            await supabaseAdmin
              .from("inventory")
              .update({ stock_level: Number(stockRow.stock_level) - item.quantity })
              .eq("id", stockRow.id);
          }
        }

        await supabaseAdmin.from("transactions").insert({
          branch_id: parsedBranchId,
          sales_record_id: openRecord.id,
          type: "income",
          category: "Sales",
          amount: total,
          description: `POS Sale #${saleId}`,
          date,
        });

        return res.json({ success: true, saleId });
      }
    }
    
    const createSale = db.transaction(() => {
      // Calculate total
      normalizedItems.forEach((item) => {
        totalCents += toCents(item.price) * item.quantity;
      });
      const total = fromCents(totalCents);

      // 1. Create Sale Record
      const saleResult = db.prepare('INSERT INTO sales (branch_id, record_id, total_amount, payment_method, date) VALUES (?, ?, ?, ?, ?)').run(parsedBranchId, openRecord.id, total, normalizedPaymentMethod, date);
      const saleId = saleResult.lastInsertRowid;

      // 2. Add Sale Items & Update Inventory
      const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)');
      const updateStock = db.prepare('UPDATE inventory SET stock_level = stock_level - ? WHERE product_id = ? AND branch_id = ?');
      const getStock = db.prepare('SELECT stock_level FROM inventory WHERE product_id = ? AND branch_id = ?');

      normalizedItems.forEach((item) => {
        const stockRow = getStock.get(item.product_id, parsedBranchId) as { stock_level: number } | undefined;
        if (!stockRow) {
          throw new Error(`Inventory item ${item.product_id} not found for branch ${parsedBranchId}.`);
        }
        if (stockRow.stock_level < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.product_id}. Available: ${stockRow.stock_level}, requested: ${item.quantity}.`);
        }
        insertItem.run(saleId, item.product_id, item.quantity, item.price);
        updateStock.run(item.quantity, item.product_id, parsedBranchId);
      });

      // 3. Add to Transactions (Income)
      db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(parsedBranchId, openRecord.id, 'income', 'Sales', total, `POS Sale #${saleId}`, date);

      return saleId;
    });

    try {
      const saleId = createSale();
      res.json({ success: true, saleId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pos/return", async (req, res) => {
    const { branch_id, items, payment_method } = req.body; // items: [{ product_id, quantity }]
    const parsedBranchId = parsePositiveInt(branch_id);
    const normalizedPaymentMethod = payment_method === "card" ? "card" : "cash";
    if (!parsedBranchId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid return input." });
    }

    const openRecord = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    if (!openRecord) {
      return res.status(400).json({ error: "No open sales record. Create/open a sales record first." });
    }

    const normalizedItems: PosReturnInput[] = [];
    for (const rawItem of items) {
      const productId = parsePositiveInt(rawItem?.product_id);
      const quantity = parsePositiveInt(rawItem?.quantity);
      if (!productId || !quantity) {
        return res.status(400).json({ error: "Invalid return item data." });
      }
      normalizedItems.push({ product_id: productId, quantity });
    }

    const date = getRecordBusinessDate(openRecord);
    let totalReturnCents = 0;

    if (useSupabaseBackend && supabaseAdmin) {
      const normalizedWithPrice: Array<PosReturnInput & { price: number }> = [];
      for (const item of normalizedItems) {
        const { data: productRow, error } = await supabaseAdmin
          .from("products")
          .select("price")
          .eq("id", item.product_id)
          .maybeSingle();
        if (error || !productRow) {
          return res.status(500).json({ error: `Product ${item.product_id} not found.` });
        }
        const unitPrice = roundToCents(Number(productRow.price));
        totalReturnCents += toCents(unitPrice) * item.quantity;
        normalizedWithPrice.push({ ...item, price: unitPrice });
      }

      const returnTotal = fromCents(totalReturnCents);
      const { data: saleData, error: saleError } = await supabaseAdmin
        .from("sales")
        .insert({
          branch_id: parsedBranchId,
          record_id: openRecord.id,
          total_amount: -returnTotal,
          payment_method: normalizedPaymentMethod,
          date,
        })
        .select("id")
        .single();

      if (!saleError && saleData) {
        const returnSaleId = Number(saleData.id);
        for (const item of normalizedWithPrice) {
          const { data: stockRow } = await supabaseAdmin
            .from("inventory")
            .select("id, stock_level")
            .eq("product_id", item.product_id)
            .eq("branch_id", parsedBranchId)
            .maybeSingle();

          if (stockRow) {
            await supabaseAdmin
              .from("inventory")
              .update({ stock_level: Number(stockRow.stock_level) + item.quantity })
              .eq("id", stockRow.id);
          } else {
            await supabaseAdmin.from("inventory").insert({
              product_id: item.product_id,
              branch_id: parsedBranchId,
              stock_level: item.quantity,
              reorder_point: 10,
            });
          }

          await supabaseAdmin.from("sale_items").insert({
            sale_id: returnSaleId,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_sale: item.price,
          });
        }

        await supabaseAdmin.from("transactions").insert({
          branch_id: parsedBranchId,
          sales_record_id: openRecord.id,
          type: "expense",
          category: "Sales Return",
          amount: returnTotal,
          description: `POS Return #${returnSaleId}`,
          date,
        });

        return res.json({ success: true, returnSaleId });
      }
    }

    const processReturn = db.transaction(() => {
      const getProductPrice = db.prepare(`
        SELECT p.price
        FROM products p
        WHERE p.id = ?
      `);
      const updateStock = db.prepare('UPDATE inventory SET stock_level = stock_level + ? WHERE product_id = ? AND branch_id = ?');
      const insertInventory = db.prepare('INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point) VALUES (?, ?, ?, ?)');

      const normalizedWithPrice = normalizedItems.map((item) => {
        const row = getProductPrice.get(item.product_id) as { price: number } | undefined;
        if (!row) {
          throw new Error(`Product ${item.product_id} not found.`);
        }
        const unitPrice = roundToCents(row.price);
        totalReturnCents += toCents(unitPrice) * item.quantity;
        return { ...item, price: unitPrice };
      });

      const returnTotal = fromCents(totalReturnCents);

      // Insert a negative sale to reduce total sales aggregates.
      const saleResult = db.prepare('INSERT INTO sales (branch_id, record_id, total_amount, payment_method, date) VALUES (?, ?, ?, ?, ?)')
        .run(parsedBranchId, openRecord.id, -returnTotal, normalizedPaymentMethod, date);
      const returnSaleId = saleResult.lastInsertRowid;

      const insertSaleItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)');
      normalizedWithPrice.forEach((item) => {
        const updateResult = updateStock.run(item.quantity, item.product_id, parsedBranchId);
        if (updateResult.changes === 0) {
          insertInventory.run(item.product_id, parsedBranchId, item.quantity, 10);
        }
        insertSaleItem.run(returnSaleId, item.product_id, item.quantity, item.price);
      });

      db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(parsedBranchId, openRecord.id, 'expense', 'Sales Return', returnTotal, `POS Return #${returnSaleId}`, date);

      return returnSaleId;
    });

    try {
      const returnSaleId = processReturn();
      res.json({ success: true, returnSaleId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 7. Restocking - Create Purchase Order
  app.post("/api/restock", async (req, res) => {
    const { branch_id, distributor_id, items, amount_paid } = req.body; // items: [{ product_id, quantity, cost }]
    const parsedBranchId = parsePositiveInt(branch_id);
    const parsedDistributorId = parsePositiveInt(distributor_id);
    const parsedAmountPaid = amount_paid === undefined || amount_paid === null ? 0 : parseNonNegativeNumber(amount_paid);
    if (!parsedBranchId || !parsedDistributorId || !Array.isArray(items) || items.length === 0 || parsedAmountPaid === null) {
      return res.status(400).json({ error: "Invalid restock input." });
    }

    const normalizedItems: RestockItemInput[] = [];
    for (const rawItem of items) {
      const productId = parsePositiveInt(rawItem?.product_id);
      const quantity = parsePositiveInt(rawItem?.quantity);
      const cost = parseNonNegativeNumber(rawItem?.cost);
      if (!productId || !quantity || cost === null) {
        return res.status(400).json({ error: "Invalid restock item data." });
      }
      normalizedItems.push({ product_id: productId, quantity, cost: roundToCents(cost) });
    }

    const openRecord = (await getOpenRecordByBranchSupabase(parsedBranchId)) || getOpenRecordByBranch(parsedBranchId);
    const date = openRecord ? getRecordBusinessDate(openRecord) : getTodayIsoDate();
    let totalCents = 0;

    if (useSupabaseBackend && supabaseAdmin) {
      normalizedItems.forEach((item) => {
        totalCents += toCents(item.cost) * item.quantity;
      });
      const total = fromCents(totalCents);
      const paidAmount = roundToCents(Math.min(total, parsedAmountPaid));
      const pendingAmount = roundToCents(total - paidAmount);
      const status = pendingAmount > 0 ? "pending" : "received";

      const { data: poData, error: poError } = await supabaseAdmin
        .from("purchase_orders")
        .insert({
          distributor_id: parsedDistributorId,
          branch_id: parsedBranchId,
          total_amount: total,
          paid_amount: paidAmount,
          status,
          date,
        })
        .select("id")
        .single();

      if (!poError && poData) {
        const poId = Number(poData.id);
        for (const item of normalizedItems) {
          await supabaseAdmin.from("purchase_items").insert({
            order_id: poId,
            product_id: item.product_id,
            quantity: item.quantity,
            cost_price: item.cost,
          });

          const { data: inventoryRow } = await supabaseAdmin
            .from("inventory")
            .select("id, stock_level")
            .eq("product_id", item.product_id)
            .eq("branch_id", parsedBranchId)
            .maybeSingle();

          if (inventoryRow) {
            await supabaseAdmin
              .from("inventory")
              .update({ stock_level: Number(inventoryRow.stock_level) + item.quantity })
              .eq("id", inventoryRow.id);
          } else {
            await supabaseAdmin.from("inventory").insert({
              product_id: item.product_id,
              branch_id: parsedBranchId,
              stock_level: item.quantity,
              reorder_point: 10,
            });
          }
        }

        if (pendingAmount > 0) {
          const { data: distributor } = await supabaseAdmin
            .from("distributors")
            .select("id, pending_amount")
            .eq("id", parsedDistributorId)
            .maybeSingle();
          if (distributor) {
            await supabaseAdmin
              .from("distributors")
              .update({ pending_amount: roundToCents(Number(distributor.pending_amount) + pendingAmount) })
              .eq("id", parsedDistributorId);
          }
        }

        if (paidAmount > 0) {
          await supabaseAdmin.from("transactions").insert({
            branch_id: parsedBranchId,
            sales_record_id: openRecord?.id || null,
            type: "expense",
            category: "Inventory Purchase",
            amount: paidAmount,
            description: `PO #${poId} - Purchase Payment`,
            date,
          });
        }

        return res.json({ success: true, poId });
      }
    }

    const createPO = db.transaction(() => {
      normalizedItems.forEach((item) => {
        totalCents += toCents(item.cost) * item.quantity;
      });
      const total = fromCents(totalCents);
      const paidAmount = roundToCents(Math.min(total, parsedAmountPaid));
      const pendingAmount = roundToCents(total - paidAmount);
      const status = pendingAmount > 0 ? 'pending' : 'received';

      // 1. Create PO
      const poResult = db.prepare('INSERT INTO purchase_orders (distributor_id, branch_id, total_amount, paid_amount, status, date) VALUES (?, ?, ?, ?, ?, ?)').run(parsedDistributorId, parsedBranchId, total, paidAmount, status, date);
      const poId = poResult.lastInsertRowid;

      // 2. Add Items & Update Stock (Assuming immediate receipt for simplicity, or we can have a 'receive' step)
      const insertItem = db.prepare('INSERT INTO purchase_items (order_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)');
      const updateStock = db.prepare('UPDATE inventory SET stock_level = stock_level + ? WHERE product_id = ? AND branch_id = ?');
      const insertInventory = db.prepare('INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point) VALUES (?, ?, ?, ?)');

      normalizedItems.forEach((item) => {
        insertItem.run(poId, item.product_id, item.quantity, item.cost);
        const updateResult = updateStock.run(item.quantity, item.product_id, parsedBranchId);
        if (updateResult.changes === 0) {
          insertInventory.run(item.product_id, parsedBranchId, item.quantity, 10);
        }
      });

      if (pendingAmount > 0) {
        db.prepare('UPDATE distributors SET pending_amount = pending_amount + ? WHERE id = ?')
          .run(pendingAmount, parsedDistributorId);
      }

      // 3. Add to Transactions (Cash Expense only for paid amount)
      if (paidAmount > 0) {
        db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(parsedBranchId, openRecord?.id || null, 'expense', 'Inventory Purchase', paidAmount, `PO #${poId} - Purchase Payment`, date);
      }
        
      return poId;
    });

    try {
      const poId = createPO();
      res.json({ success: true, poId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 7b. Warehouse -> Store stock transfer
  app.post("/api/transfers", async (req, res) => {
    const { from_branch_id, to_branch_id, items, note } = req.body;
    const fromBranchId = parsePositiveInt(from_branch_id);
    const toBranchId = parsePositiveInt(to_branch_id);
    const normalizedNote = typeof note === "string" ? note.trim() : "";

    if (!fromBranchId || !toBranchId || fromBranchId === toBranchId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid transfer input." });
    }

    const normalizedItems: TransferItemInput[] = [];
    for (const rawItem of items) {
      const productId = parsePositiveInt(rawItem?.product_id);
      const quantity = parsePositiveInt(rawItem?.quantity);
      if (!productId || !quantity) {
        return res.status(400).json({ error: "Invalid transfer item data." });
      }
      normalizedItems.push({ product_id: productId, quantity });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const fromBranch = await getBranchByIdSupabase(fromBranchId);
      const toBranch = await getBranchByIdSupabase(toBranchId);
      if (fromBranch && toBranch) {
        if (fromBranch.branch_type !== "warehouse" || toBranch.branch_type !== "store") {
          return res.status(400).json({ error: "Transfers must be from warehouse to store." });
        }

        for (const item of normalizedItems) {
          const { data: stockRow, error } = await supabaseAdmin
            .from("inventory")
            .select("id, stock_level")
            .eq("branch_id", fromBranchId)
            .eq("product_id", item.product_id)
            .maybeSingle();
          if (error || !stockRow || Number(stockRow.stock_level) < item.quantity) {
            return res.status(500).json({ error: `Insufficient warehouse stock for product ${item.product_id}.` });
          }
        }

        const { data: transferData, error: transferError } = await supabaseAdmin
          .from("stock_transfers")
          .insert({
            from_branch_id: fromBranchId,
            to_branch_id: toBranchId,
            note: normalizedNote || null,
            date: getTodayIsoDate(),
          })
          .select("id")
          .single();

        if (!transferError && transferData) {
          const transferId = Number(transferData.id);
          for (const item of normalizedItems) {
            const { data: fromStock } = await supabaseAdmin
              .from("inventory")
              .select("id, stock_level")
              .eq("branch_id", fromBranchId)
              .eq("product_id", item.product_id)
              .maybeSingle();
            if (fromStock) {
              await supabaseAdmin
                .from("inventory")
                .update({ stock_level: Number(fromStock.stock_level) - item.quantity })
                .eq("id", fromStock.id);
            }

            const { data: toStock } = await supabaseAdmin
              .from("inventory")
              .select("id, stock_level")
              .eq("branch_id", toBranchId)
              .eq("product_id", item.product_id)
              .maybeSingle();
            if (toStock) {
              await supabaseAdmin
                .from("inventory")
                .update({ stock_level: Number(toStock.stock_level) + item.quantity })
                .eq("id", toStock.id);
            } else {
              await supabaseAdmin.from("inventory").insert({
                product_id: item.product_id,
                branch_id: toBranchId,
                stock_level: item.quantity,
                reorder_point: 10,
              });
            }

            await supabaseAdmin.from("stock_transfer_items").insert({
              transfer_id: transferId,
              product_id: item.product_id,
              quantity: item.quantity,
            });
          }

          return res.json({ success: true, transferId });
        }
      }
    }

    const fromBranch = db.prepare("SELECT id, branch_type FROM branches WHERE id = ?").get(fromBranchId) as { id: number; branch_type: string } | undefined;
    const toBranch = db.prepare("SELECT id, branch_type FROM branches WHERE id = ?").get(toBranchId) as { id: number; branch_type: string } | undefined;
    if (!fromBranch || !toBranch) {
      return res.status(404).json({ error: "Branch not found." });
    }
    if (fromBranch.branch_type !== "warehouse" || toBranch.branch_type !== "store") {
      return res.status(400).json({ error: "Transfers must be from warehouse to store." });
    }

    const date = getTodayIsoDate();
    const applyTransfer = db.transaction(() => {
      const insertTransfer = db.prepare("INSERT INTO stock_transfers (from_branch_id, to_branch_id, note, date) VALUES (?, ?, ?, ?)");
      const transferInfo = insertTransfer.run(fromBranchId, toBranchId, normalizedNote || null, date);
      const transferId = Number(transferInfo.lastInsertRowid);

      const getStock = db.prepare("SELECT stock_level FROM inventory WHERE branch_id = ? AND product_id = ?");
      const decFromStock = db.prepare("UPDATE inventory SET stock_level = stock_level - ? WHERE branch_id = ? AND product_id = ?");
      const incToStock = db.prepare("UPDATE inventory SET stock_level = stock_level + ? WHERE branch_id = ? AND product_id = ?");
      const insertToInventory = db.prepare("INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point) VALUES (?, ?, ?, ?)");
      const insertTransferItem = db.prepare("INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES (?, ?, ?)");

      normalizedItems.forEach((item) => {
        const fromStock = getStock.get(fromBranchId, item.product_id) as { stock_level: number } | undefined;
        if (!fromStock || fromStock.stock_level < item.quantity) {
          throw new Error(`Insufficient warehouse stock for product ${item.product_id}.`);
        }

        decFromStock.run(item.quantity, fromBranchId, item.product_id);
        const updateTo = incToStock.run(item.quantity, toBranchId, item.product_id);
        if (updateTo.changes === 0) {
          insertToInventory.run(item.product_id, toBranchId, item.quantity, 10);
        }
        insertTransferItem.run(transferId, item.product_id, item.quantity);
      });

      return transferId;
    });

    try {
      const transferId = applyTransfer();
      res.json({ success: true, transferId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/transfers", async (req, res) => {
    const date = typeof req.query.date === "string" && req.query.date.trim() ? req.query.date.trim() : null;

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("stock_transfers")
        .select("id, from_branch_id, to_branch_id, note, date, from_branches:branches!stock_transfers_from_branch_id_fkey(name), to_branches:branches!stock_transfers_to_branch_id_fkey(name)")
        .order("id", { ascending: false })
        .limit(200);
      if (date) query = query.eq("date", date);
      const { data, error } = await query;
      if (!error && data) {
        return res.json(data.map((row) => ({
          id: row.id,
          from_branch_id: row.from_branch_id,
          to_branch_id: row.to_branch_id,
          note: row.note,
          date: row.date,
          from_branch_name: asSingle(row.from_branches as { name: string } | { name: string }[] | null)?.name ?? null,
          to_branch_name: asSingle(row.to_branches as { name: string } | { name: string }[] | null)?.name ?? null,
        })));
      }
    }

    let query = `
      SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name
      FROM stock_transfers t
      JOIN branches fb ON t.from_branch_id = fb.id
      JOIN branches tb ON t.to_branch_id = tb.id
    `;
    const params: string[] = [];
    if (date) {
      query += " WHERE t.date = ?";
      params.push(date);
    }
    query += " ORDER BY t.id DESC LIMIT 200";
    const transfers = db.prepare(query).all(...params);
    res.json(transfers);
  });

  // 7c. Warehouse wholesale sales
  app.post("/api/warehouse/wholesale-sale", async (req, res) => {
    const { warehouse_branch_id, customer_name, items, payment_method } = req.body;
    const warehouseBranchId = parsePositiveInt(warehouse_branch_id);
    const normalizedCustomer = typeof customer_name === "string" ? customer_name.trim() : "";
    const normalizedPayment = payment_method === "card" ? "card" : "cash";

    if (!warehouseBranchId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid wholesale sale input." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const warehouse = await getBranchByIdSupabase(warehouseBranchId);
      if (warehouse && warehouse.branch_type !== "warehouse") {
        return res.status(400).json({ error: "Invalid warehouse branch." });
      }
    }

    const warehouse = db.prepare("SELECT id, branch_type FROM branches WHERE id = ?").get(warehouseBranchId) as { id: number; branch_type: string } | undefined;
    if (!warehouse || warehouse.branch_type !== "warehouse") {
      return res.status(400).json({ error: "Invalid warehouse branch." });
    }

    const normalizedItems: WholesaleItemInput[] = [];
    for (const rawItem of items) {
      const productId = parsePositiveInt(rawItem?.product_id);
      const quantity = parsePositiveInt(rawItem?.quantity);
      const price = parseNonNegativeNumber(rawItem?.price);
      if (!productId || !quantity || price === null) {
        return res.status(400).json({ error: "Invalid wholesale sale item data." });
      }
      normalizedItems.push({ product_id: productId, quantity, price: roundToCents(price) });
    }

    const date = getTodayIsoDate();
    let totalCents = 0;

    if (useSupabaseBackend && supabaseAdmin) {
      for (const item of normalizedItems) {
        const { data: stock, error } = await supabaseAdmin
          .from("inventory")
          .select("id, stock_level")
          .eq("branch_id", warehouseBranchId)
          .eq("product_id", item.product_id)
          .maybeSingle();
        if (error || !stock || Number(stock.stock_level) < item.quantity) {
          return res.status(500).json({ error: `Insufficient warehouse stock for product ${item.product_id}.` });
        }
        totalCents += toCents(item.price) * item.quantity;
      }

      const total = fromCents(totalCents);
      const { data: saleData, error: saleError } = await supabaseAdmin
        .from("wholesale_sales")
        .insert({
          warehouse_branch_id: warehouseBranchId,
          customer_name: normalizedCustomer || null,
          total_amount: total,
          payment_method: normalizedPayment,
          date,
        })
        .select("id")
        .single();

      if (!saleError && saleData) {
        const saleId = Number(saleData.id);
        for (const item of normalizedItems) {
          const { data: stock } = await supabaseAdmin
            .from("inventory")
            .select("id, stock_level")
            .eq("branch_id", warehouseBranchId)
            .eq("product_id", item.product_id)
            .maybeSingle();
          if (stock) {
            await supabaseAdmin
              .from("inventory")
              .update({ stock_level: Number(stock.stock_level) - item.quantity })
              .eq("id", stock.id);
          }
          await supabaseAdmin.from("wholesale_sale_items").insert({
            wholesale_sale_id: saleId,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_sale: item.price,
          });
        }

        await supabaseAdmin.from("transactions").insert({
          branch_id: warehouseBranchId,
          sales_record_id: null,
          type: "income",
          category: "Wholesale Sales",
          amount: total,
          description: `Wholesale Sale #${saleId}`,
          date,
        });

        return res.json({ success: true, saleId });
      }
    }

    const applyWholesaleSale = db.transaction(() => {
      const getStock = db.prepare("SELECT stock_level FROM inventory WHERE branch_id = ? AND product_id = ?");
      const decStock = db.prepare("UPDATE inventory SET stock_level = stock_level - ? WHERE branch_id = ? AND product_id = ?");
      const insertSale = db.prepare("INSERT INTO wholesale_sales (warehouse_branch_id, customer_name, total_amount, payment_method, date) VALUES (?, ?, ?, ?, ?)");
      const insertItem = db.prepare("INSERT INTO wholesale_sale_items (wholesale_sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)");

      normalizedItems.forEach((item) => {
        const stock = getStock.get(warehouseBranchId, item.product_id) as { stock_level: number } | undefined;
        if (!stock || stock.stock_level < item.quantity) {
          throw new Error(`Insufficient warehouse stock for product ${item.product_id}.`);
        }
        totalCents += toCents(item.price) * item.quantity;
      });

      const total = fromCents(totalCents);
      const saleInfo = insertSale.run(warehouseBranchId, normalizedCustomer || null, total, normalizedPayment, date);
      const saleId = Number(saleInfo.lastInsertRowid);

      normalizedItems.forEach((item) => {
        decStock.run(item.quantity, warehouseBranchId, item.product_id);
        insertItem.run(saleId, item.product_id, item.quantity, item.price);
      });

      db.prepare('INSERT INTO transactions (branch_id, sales_record_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(warehouseBranchId, null, 'income', 'Wholesale Sales', total, `Wholesale Sale #${saleId}`, date);

      return saleId;
    });

    try {
      const saleId = applyWholesaleSale();
      res.json({ success: true, saleId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/warehouse/wholesale-sales", async (req, res) => {
    const warehouseBranchId = parsePositiveInt(req.query.warehouse_branch_id);
    if (!warehouseBranchId) {
      return res.status(400).json({ error: "Invalid warehouse_branch_id." });
    }
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("wholesale_sales")
        .select("id, warehouse_branch_id, customer_name, customer_phone, total_amount, payment_method, payment_status, date, created_at, branches(name)")
        .eq("warehouse_branch_id", warehouseBranchId)
        .order("id", { ascending: false })
        .limit(200);
      if (!error && data) {
        return res.json(data.map((row) => ({
          ...row,
          total_amount: Number(row.total_amount),
          warehouse_name: asSingle(row.branches as { name: string } | { name: string }[] | null)?.name ?? null,
        })));
      }
    }
    const sales = db.prepare(`
      SELECT ws.*, b.name AS warehouse_name
      FROM wholesale_sales ws
      JOIN branches b ON ws.warehouse_branch_id = b.id
      WHERE ws.warehouse_branch_id = ?
      ORDER BY ws.id DESC
      LIMIT 200
    `).all(warehouseBranchId);
    res.json(sales);
  });

  app.get("/api/purchase-orders", async (req, res) => {
    const { branchId } = req.query;
    const parsedBranchId = branchId === undefined ? null : parsePositiveInt(branchId);
    if (branchId !== undefined && !parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("purchase_orders")
        .select("id, distributor_id, branch_id, total_amount, paid_amount, status, date, distributors(name), branches(name)")
        .order("date", { ascending: false })
        .order("id", { ascending: false });
      if (parsedBranchId) query = query.eq("branch_id", parsedBranchId);
      const { data, error } = await query;
      if (!error && data) {
        return res.json(data.map((row) => ({
          id: Number(row.id),
          distributor_id: Number(row.distributor_id),
          branch_id: Number(row.branch_id),
          total_amount: Number(row.total_amount),
          paid_amount: Number(row.paid_amount),
          status: row.status,
          date: row.date,
          distributor_name: asSingle(row.distributors as { name: string } | { name: string }[] | null)?.name ?? null,
          branch_name: asSingle(row.branches as { name: string } | { name: string }[] | null)?.name ?? null,
        })));
      }
    }

    let query = `
      SELECT po.*, d.name AS distributor_name, b.name AS branch_name
      FROM purchase_orders po
      JOIN distributors d ON po.distributor_id = d.id
      JOIN branches b ON po.branch_id = b.id
    `;
    const params: number[] = [];

    if (parsedBranchId) {
      query += ' WHERE po.branch_id = ?';
      params.push(parsedBranchId);
    }

    query += ' ORDER BY po.date DESC, po.id DESC';
    const orders = db.prepare(query).all(...params);
    res.json(orders);
  });

  // 8. Stats (Per Branch)
  app.get("/api/stats", async (req, res) => {
    const { branchId } = req.query;
    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin.from("transactions").select("type, amount");
      if (branchId) query = query.eq("branch_id", branchId);
      const { data, error } = await query;
      if (!error && data) {
        const totalIncome = roundToCents(data.filter((r) => r.type === "income").reduce((sum, r) => sum + Number(r.amount), 0));
        const totalExpense = roundToCents(data.filter((r) => r.type === "expense").reduce((sum, r) => sum + Number(r.amount), 0));
        return res.json({ totalIncome, totalExpense, netProfit: roundToCents(totalIncome - totalExpense) });
      }
    }
    const conditions: string[] = [];
    const params = [];

    if (branchId) {
      conditions.push("branch_id = ?");
      params.push(branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const incomeStmt = db.prepare(`SELECT SUM(amount) as total FROM transactions ${whereClause} ${whereClause ? "AND" : "WHERE"} type = 'income'`);
    const expenseStmt = db.prepare(`SELECT SUM(amount) as total FROM transactions ${whereClause} ${whereClause ? "AND" : "WHERE"} type = 'expense'`);
    
    const totalIncome = roundToCents((incomeStmt.get(...params) as any).total || 0);
    const totalExpense = roundToCents((expenseStmt.get(...params) as any).total || 0);
    const netProfit = roundToCents(totalIncome - totalExpense);

    res.json({ totalIncome, totalExpense, netProfit });
  });

  // Massage Center APIs
  app.get("/api/massage/clients", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin.from("massage_clients").select("*").order("name", { ascending: true });
      if (q) {
        const escaped = q.replace(/[%_,]/g, "");
        query = query.or(`name.ilike.%${escaped}%,mobile.ilike.%${escaped}%`).limit(50);
      }
      const { data, error } = await query;
      if (!error && data) return res.json(data);
    }
    if (q) {
      return res.json(
        db.prepare(
          "SELECT * FROM massage_clients WHERE name LIKE ? OR mobile LIKE ? ORDER BY name ASC LIMIT 50",
        ).all(`%${q}%`, `%${q}%`),
      );
    }
    res.json(db.prepare("SELECT * FROM massage_clients ORDER BY name ASC").all());
  });

  app.post("/api/massage/clients", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Client name is required." });
    const mobile = typeof req.body?.mobile === "string" ? req.body.mobile.trim() || null : null;
    const email = typeof req.body?.email === "string" ? req.body.email.trim() || null : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("massage_clients")
        .insert({ name, mobile, email, notes })
        .select("id")
        .single();
      if (!error && data) return res.json({ success: true, id: data.id });
    }
    const info = db.prepare("INSERT INTO massage_clients (name, mobile, email, notes) VALUES (?, ?, ?, ?)")
      .run(name, mobile, email, notes);
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.get("/api/massage/services", async (_req, res) => {
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.from("massage_services").select("*").eq("is_active", true).order("name", { ascending: true });
      if (!error && data) return res.json(data.map((row) => ({ ...row, is_active: toSqliteBool(row.is_active) })));
    }
    res.json(db.prepare("SELECT * FROM massage_services WHERE is_active = 1 ORDER BY name ASC").all());
  });

  app.post("/api/massage/services", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const duration_minutes = parsePositiveInt(req.body?.duration_minutes);
    const price = parseNonNegativeNumber(req.body?.price);
    if (!name || !duration_minutes || price === null) {
      return res.status(400).json({ error: "name, duration_minutes, and price are required." });
    }
    const description = typeof req.body?.description === "string" ? req.body.description.trim() || null : null;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("massage_services")
        .insert({ name, duration_minutes, price: roundToCents(price), description })
        .select("id")
        .single();
      if (!error && data) return res.json({ success: true, id: data.id });
    }
    const info = db.prepare("INSERT INTO massage_services (name, duration_minutes, price, description) VALUES (?, ?, ?, ?)")
      .run(name, duration_minutes, roundToCents(price), description);
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.get("/api/massage/therapists", async (req, res) => {
    const parsedBranchId = req.query.branchId ? parsePositiveInt(req.query.branchId) : null;
    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin.from("massage_therapists").select("*").eq("is_active", true).order("name", { ascending: true });
      if (parsedBranchId) query = query.eq("branch_id", parsedBranchId);
      const { data, error } = await query;
      if (!error && data) return res.json(data.map((row) => ({ ...row, is_active: toSqliteBool(row.is_active) })));
    }
    const where = parsedBranchId ? "WHERE branch_id = ? AND is_active = 1" : "WHERE is_active = 1";
    const params = parsedBranchId ? [parsedBranchId] : [];
    res.json(db.prepare(`SELECT * FROM massage_therapists ${where} ORDER BY name ASC`).all(...params));
  });

  app.post("/api/massage/therapists", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const parsedBranchId = parsePositiveInt(req.body?.branch_id);
    if (!name || !parsedBranchId) return res.status(400).json({ error: "name and branch_id are required." });
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() || null : null;
    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("massage_therapists")
        .insert({ name, phone, branch_id: parsedBranchId })
        .select("id")
        .single();
      if (!error && data) return res.json({ success: true, id: data.id });
    }
    const info = db.prepare("INSERT INTO massage_therapists (name, phone, branch_id) VALUES (?, ?, ?)")
      .run(name, phone, parsedBranchId);
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.get("/api/massage/sessions", async (req, res) => {
    const parsedBranchId = req.query.branchId ? parsePositiveInt(req.query.branchId) : null;
    const date = typeof req.query.date === "string" ? req.query.date.trim() : null;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : null;
    if (useSupabaseBackend && supabaseAdmin) {
      let query = supabaseAdmin
        .from("massage_sessions")
        .select("*, massage_clients(name,mobile), massage_therapists(name), massage_services(name,duration_minutes)")
        .order("booking_date", { ascending: false })
        .order("start_time", { ascending: true });
      if (parsedBranchId) query = query.eq("branch_id", parsedBranchId);
      if (date) query = query.eq("booking_date", date);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (!error && data) {
        return res.json(data.map((row) => ({
          ...row,
          price_charged: row.price_charged === null ? null : Number(row.price_charged),
          client_name_ref: asSingle(row.massage_clients as { name: string; mobile: string | null } | { name: string; mobile: string | null }[] | null)?.name,
          client_mobile_ref: asSingle(row.massage_clients as { name: string; mobile: string | null } | { name: string; mobile: string | null }[] | null)?.mobile,
          therapist_name: asSingle(row.massage_therapists as { name: string } | { name: string }[] | null)?.name,
          service_name: asSingle(row.massage_services as { name: string; duration_minutes: number } | { name: string; duration_minutes: number }[] | null)?.name,
          service_duration: asSingle(row.massage_services as { name: string; duration_minutes: number } | { name: string; duration_minutes: number }[] | null)?.duration_minutes,
        })));
      }
    }

    const conditions: string[] = [];
    const params: (number | string)[] = [];
    if (parsedBranchId) {
      conditions.push("ms.branch_id = ?");
      params.push(parsedBranchId);
    }
    if (date) {
      conditions.push("ms.booking_date = ?");
      params.push(date);
    }
    if (status) {
      conditions.push("ms.status = ?");
      params.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sessions = db.prepare(`
      SELECT ms.*,
        mc.name AS client_name_ref, mc.mobile AS client_mobile_ref,
        mt.name AS therapist_name,
        msv.name AS service_name, msv.duration_minutes AS service_duration
      FROM massage_sessions ms
      LEFT JOIN massage_clients mc ON ms.client_id = mc.id
      LEFT JOIN massage_therapists mt ON ms.therapist_id = mt.id
      LEFT JOIN massage_services msv ON ms.service_id = msv.id
      ${where}
      ORDER BY ms.booking_date DESC, ms.start_time ASC
    `).all(...params);
    res.json(sessions);
  });

  app.post("/api/massage/sessions", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.body?.branch_id);
    const booking_date = parseDateString(req.body?.booking_date);
    const start_time = typeof req.body?.start_time === "string" ? req.body.start_time.trim() : null;
    if (!parsedBranchId || !booking_date || !start_time) {
      return res.status(400).json({ error: "branch_id, booking_date (YYYY-MM-DD), and start_time are required." });
    }

    const client_id = req.body?.client_id ? parsePositiveInt(req.body.client_id) : null;
    const client_name = typeof req.body?.client_name === "string" ? req.body.client_name.trim() || null : null;
    const client_mobile = typeof req.body?.client_mobile === "string" ? req.body.client_mobile.trim() || null : null;
    const therapist_id = req.body?.therapist_id ? parsePositiveInt(req.body.therapist_id) : null;
    const service_id = req.body?.service_id ? parsePositiveInt(req.body.service_id) : null;
    const end_time = typeof req.body?.end_time === "string" ? req.body.end_time.trim() || null : null;
    const duration_minutes = req.body?.duration_minutes ? parsePositiveInt(req.body.duration_minutes) : null;
    const status = ["scheduled", "completed", "cancelled", "no_show"].includes(req.body?.status) ? req.body.status : "scheduled";
    const price_charged = req.body?.price_charged !== undefined ? parseNonNegativeNumber(req.body.price_charged) : null;
    const payment_method = req.body?.payment_method === "card" ? "card" : "cash";
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("massage_sessions")
        .insert({
          branch_id: parsedBranchId,
          client_id: client_id ?? null,
          client_name,
          client_mobile,
          therapist_id: therapist_id ?? null,
          service_id: service_id ?? null,
          booking_date,
          start_time,
          end_time,
          duration_minutes: duration_minutes ?? null,
          status,
          price_charged: price_charged !== null ? roundToCents(price_charged) : null,
          payment_method,
          notes,
        })
        .select("id")
        .single();

      if (!error && data) {
        const sessionId = Number(data.id);
        if (client_id && status === "completed") {
          const { data: clientRow } = await supabaseAdmin.from("massage_clients").select("id, visit_count").eq("id", client_id).maybeSingle();
          if (clientRow) {
            await supabaseAdmin.from("massage_clients").update({ visit_count: Number(clientRow.visit_count) + 1 }).eq("id", client_id);
          }
        }
        if (status === "completed" && price_charged !== null && price_charged > 0) {
          const clientLabel = client_name || (client_id ? `Client #${client_id}` : "Walk-in");
          await supabaseAdmin.from("transactions").insert({
            branch_id: parsedBranchId,
            type: "income",
            category: "Massage Session",
            amount: roundToCents(price_charged),
            description: `Session #${sessionId} - ${clientLabel}`,
            date: booking_date,
          });
        }
        return res.json({ success: true, id: sessionId });
      }
    }

    const createSession = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO massage_sessions
          (branch_id, client_id, client_name, client_mobile, therapist_id, service_id,
           booking_date, start_time, end_time, duration_minutes, status, price_charged, payment_method, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        parsedBranchId,
        client_id ?? null,
        client_name,
        client_mobile,
        therapist_id ?? null,
        service_id ?? null,
        booking_date,
        start_time,
        end_time,
        duration_minutes ?? null,
        status,
        price_charged !== null ? roundToCents(price_charged) : null,
        payment_method,
        notes,
      );
      const sessionId = Number(info.lastInsertRowid);

      if (client_id && status === "completed") {
        db.prepare("UPDATE massage_clients SET visit_count = visit_count + 1 WHERE id = ?").run(client_id);
      }
      if (status === "completed" && price_charged !== null && price_charged > 0) {
        const clientLabel = client_name || (client_id ? `Client #${client_id}` : "Walk-in");
        db.prepare("INSERT INTO transactions (branch_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?)")
          .run(parsedBranchId, "income", "Massage Session", roundToCents(price_charged), `Session #${sessionId} - ${clientLabel}`, booking_date);
      }

      return sessionId;
    });

    try {
      const sessionId = createSession();
      res.json({ success: true, id: sessionId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/massage/daily-report", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    const date = typeof req.query.date === "string" ? req.query.date.trim() : getTodayIsoDate();
    if (!parsedBranchId) return res.status(400).json({ error: "Invalid branchId." });
    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: sessionsData, error: sessionError }, { data: expensesData, error: expensesError }] = await Promise.all([
        supabaseAdmin
          .from("massage_sessions")
          .select("*, massage_therapists(name), massage_services(name)")
          .eq("branch_id", parsedBranchId)
          .eq("booking_date", date)
          .order("start_time", { ascending: true }),
        supabaseAdmin
          .from("transactions")
          .select("*")
          .eq("branch_id", parsedBranchId)
          .eq("date", date)
          .eq("type", "expense")
          .order("id", { ascending: false }),
      ]);
      if (!sessionError && !expensesError) {
        const sessions = (sessionsData ?? []).map((row) => ({
          ...row,
          price_charged: row.price_charged === null ? null : Number(row.price_charged),
          therapist_name: asSingle(row.massage_therapists as { name: string } | { name: string }[] | null)?.name,
          service_name: asSingle(row.massage_services as { name: string } | { name: string }[] | null)?.name,
        })) as any[];
        const completed = sessions.filter((session) => session.status === "completed");
        const totalRevenue = completed.reduce((sum, session) => sum + (session.price_charged || 0), 0);
        const cashRevenue = completed.filter((session) => session.payment_method === "cash").reduce((sum, session) => sum + (session.price_charged || 0), 0);
        const cardRevenue = completed.filter((session) => session.payment_method === "card").reduce((sum, session) => sum + (session.price_charged || 0), 0);
        const expenses = (expensesData ?? []).map((entry) => ({ ...entry, amount: Number(entry.amount) })) as any[];
        const totalExpenses = expenses.reduce((sum, entry) => sum + entry.amount, 0);
        return res.json({
          date,
          branch_id: parsedBranchId,
          sessions,
          completed_count: completed.length,
          scheduled_count: sessions.filter((session) => session.status === "scheduled").length,
          cancelled_count: sessions.filter((session) => session.status === "cancelled").length,
          no_show_count: sessions.filter((session) => session.status === "no_show").length,
          revenue: { total: roundToCents(totalRevenue), cash: roundToCents(cashRevenue), card: roundToCents(cardRevenue) },
          expenses,
          total_expenses: roundToCents(totalExpenses),
          net_profit: roundToCents(totalRevenue - totalExpenses),
        });
      }
    }
    const sessions = db.prepare(`
      SELECT ms.*, mt.name AS therapist_name, msv.name AS service_name
      FROM massage_sessions ms
      LEFT JOIN massage_therapists mt ON ms.therapist_id = mt.id
      LEFT JOIN massage_services msv ON ms.service_id = msv.id
      WHERE ms.branch_id = ? AND ms.booking_date = ?
      ORDER BY ms.start_time ASC
    `).all(parsedBranchId, date) as any[];
    const completed = sessions.filter((session) => session.status === "completed");
    const totalRevenue = completed.reduce((sum, session) => sum + (session.price_charged || 0), 0);
    const cashRevenue = completed.filter((session) => session.payment_method === "cash").reduce((sum, session) => sum + (session.price_charged || 0), 0);
    const cardRevenue = completed.filter((session) => session.payment_method === "card").reduce((sum, session) => sum + (session.price_charged || 0), 0);
    const expenses = db.prepare(
      "SELECT * FROM transactions WHERE branch_id = ? AND date = ? AND type = 'expense' ORDER BY id DESC",
    ).all(parsedBranchId, date) as any[];
    const totalExpenses = expenses.reduce((sum, entry) => sum + entry.amount, 0);
    res.json({
      date,
      branch_id: parsedBranchId,
      sessions,
      completed_count: completed.length,
      scheduled_count: sessions.filter((session) => session.status === "scheduled").length,
      cancelled_count: sessions.filter((session) => session.status === "cancelled").length,
      no_show_count: sessions.filter((session) => session.status === "no_show").length,
      revenue: { total: roundToCents(totalRevenue), cash: roundToCents(cashRevenue), card: roundToCents(cardRevenue) },
      expenses,
      total_expenses: roundToCents(totalExpenses),
      net_profit: roundToCents(totalRevenue - totalExpenses),
    });
  });

  app.get("/api/massage/schedule", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) return res.status(400).json({ error: "Invalid branchId." });
    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: schedule, error: scheduleError }, { data: breaks, error: breaksError }] = await Promise.all([
        supabaseAdmin.from("working_schedule").select("*").eq("branch_id", parsedBranchId).order("day_of_week", { ascending: true }),
        supabaseAdmin.from("break_periods").select("*").eq("branch_id", parsedBranchId).order("day_of_week", { ascending: true }).order("break_start", { ascending: true }),
      ]);
      if (!scheduleError && !breaksError) return res.json({ schedule: schedule ?? [], breaks: breaks ?? [] });
    }
    const schedule = db.prepare("SELECT * FROM working_schedule WHERE branch_id = ? ORDER BY day_of_week ASC").all(parsedBranchId);
    const breaks = db.prepare("SELECT * FROM break_periods WHERE branch_id = ? ORDER BY day_of_week ASC, break_start ASC").all(parsedBranchId);
    res.json({ schedule, breaks });
  });

  app.post("/api/massage/schedule", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.body?.branch_id);
    const day_of_week = req.body?.day_of_week !== undefined ? Number(req.body.day_of_week) : null;
    const open_time = typeof req.body?.open_time === "string" ? req.body.open_time.trim() : null;
    const close_time = typeof req.body?.close_time === "string" ? req.body.close_time.trim() : null;
    if (!parsedBranchId || day_of_week === null || !Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6 || !open_time || !close_time) {
      return res.status(400).json({ error: "branch_id, day_of_week (0-6), open_time, close_time are required." });
    }
    if (useSupabaseBackend && supabaseAdmin) {
      const { data: existing } = await supabaseAdmin
        .from("working_schedule")
        .select("id")
        .eq("branch_id", parsedBranchId)
        .eq("day_of_week", day_of_week)
        .maybeSingle();
      if (existing) {
        const { error } = await supabaseAdmin.from("working_schedule").update({ open_time, close_time }).eq("id", existing.id);
        if (!error) return res.json({ success: true });
      } else {
        const { error } = await supabaseAdmin.from("working_schedule").insert({ branch_id: parsedBranchId, day_of_week, open_time, close_time });
        if (!error) return res.json({ success: true });
      }
    }
    db.prepare("INSERT INTO working_schedule (branch_id, day_of_week, open_time, close_time) VALUES (?, ?, ?, ?) ON CONFLICT(branch_id, day_of_week) DO UPDATE SET open_time=excluded.open_time, close_time=excluded.close_time")
      .run(parsedBranchId, day_of_week, open_time, close_time);
    res.json({ success: true });
  });

  app.get("/api/dashboard-summary", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }
    const selectedDate = typeof req.query.date === "string" && req.query.date.trim()
      ? req.query.date.trim()
      : getTodayIsoDate();

    if (useSupabaseBackend && supabaseAdmin) {
      const [{ data: salesRows, error: salesError }, { data: txRows, error: txError }, { data: cashRows, error: cashError }] = await Promise.all([
        supabaseAdmin.from("sales").select("total_amount, payment_method").eq("branch_id", parsedBranchId).eq("date", selectedDate),
        supabaseAdmin.from("transactions").select("type, amount").eq("branch_id", parsedBranchId).eq("date", selectedDate),
        supabaseAdmin.from("sales_records").select("opening_cash, cash_taken_out, opened_at").eq("branch_id", parsedBranchId),
      ]);
      if (!salesError && !txError && !cashError) {
        const matchingCashRows = (cashRows ?? []).filter((row) => String(row.opened_at).slice(0, 10) === selectedDate);
        const totalSales = roundToCents((salesRows ?? []).reduce((sum, row) => sum + Number(row.total_amount), 0));
        const cashSales = roundToCents((salesRows ?? []).filter((row) => row.payment_method === "cash").reduce((sum, row) => sum + Number(row.total_amount), 0));
        const cardSales = roundToCents((salesRows ?? []).filter((row) => row.payment_method === "card").reduce((sum, row) => sum + Number(row.total_amount), 0));
        const totalIncome = roundToCents((txRows ?? []).filter((row) => row.type === "income").reduce((sum, row) => sum + Number(row.amount), 0));
        const totalExpense = roundToCents((txRows ?? []).filter((row) => row.type === "expense").reduce((sum, row) => sum + Number(row.amount), 0));
        const openingCash = roundToCents(matchingCashRows.reduce((sum, row) => sum + Number(row.opening_cash), 0));
        const cashTakenOut = roundToCents(matchingCashRows.reduce((sum, row) => sum + Number(row.cash_taken_out), 0));
        const netProfit = roundToCents(totalIncome - totalExpense);
        const expectedClosingCash = roundToCents(openingCash + cashSales - totalExpense - cashTakenOut);
        return res.json({ date: selectedDate, totalSales, cashSales, cardSales, totalIncome, totalExpense, netProfit, openingCash, cashTakenOut, expectedClosingCash });
      }
    }

    const salesSummary = db.prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total_amount ELSE 0 END), 0) AS card_sales
      FROM sales
      WHERE branch_id = ? AND date = ?
    `).get(parsedBranchId, selectedDate) as {
      total_sales: number;
      cash_sales: number;
      card_sales: number;
    };

    const txSummary = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total
      FROM transactions
      WHERE branch_id = ? AND date = ?
    `).get(parsedBranchId, selectedDate) as {
      income_total: number;
      expense_total: number;
    };

    const cashFlowSummary = db.prepare(`
      SELECT
        COALESCE(SUM(opening_cash), 0) AS opening_cash_total,
        COALESCE(SUM(cash_taken_out), 0) AS cash_taken_out_total
      FROM sales_records
      WHERE branch_id = ? AND substr(opened_at, 1, 10) = ?
    `).get(parsedBranchId, selectedDate) as {
      opening_cash_total: number;
      cash_taken_out_total: number;
    };

    const netProfit = roundToCents(txSummary.income_total - txSummary.expense_total);
    const expectedClosingCash = roundToCents(
      cashFlowSummary.opening_cash_total + salesSummary.cash_sales - txSummary.expense_total - cashFlowSummary.cash_taken_out_total
    );

    res.json({
      date: selectedDate,
      totalSales: roundToCents(salesSummary.total_sales),
      cashSales: roundToCents(salesSummary.cash_sales),
      cardSales: roundToCents(salesSummary.card_sales),
      totalIncome: roundToCents(txSummary.income_total),
      totalExpense: roundToCents(txSummary.expense_total),
      netProfit,
      openingCash: roundToCents(cashFlowSummary.opening_cash_total),
      cashTakenOut: roundToCents(cashFlowSummary.cash_taken_out_total),
      expectedClosingCash,
    });
  });

  app.get("/api/sales-series", async (req, res) => {
    const parsedBranchId = parsePositiveInt(req.query.branchId);
    if (!parsedBranchId) {
      return res.status(400).json({ error: "Invalid branchId." });
    }

    if (useSupabaseBackend && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("sales")
        .select("date, total_amount")
        .eq("branch_id", parsedBranchId)
        .order("date", { ascending: false });

      if (!error && data) {
        const dailyMap = new Map<string, number>();
        const monthlyMap = new Map<string, number>();

        for (const row of data) {
          const date = row.date;
          const amount = Number(row.total_amount);
          dailyMap.set(date, roundToCents((dailyMap.get(date) ?? 0) + amount));
          const month = date.slice(0, 7);
          monthlyMap.set(month, roundToCents((monthlyMap.get(month) ?? 0) + amount));
        }

        const daily = Array.from(dailyMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 14)
          .reverse()
          .map(([label, amount]) => ({ label, amount }));

        const monthly = Array.from(monthlyMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 12)
          .reverse()
          .map(([label, amount]) => ({ label, amount }));

        return res.json({ daily, monthly });
      }
    }

    const daily = db.prepare(`
      SELECT date AS label, ROUND(SUM(total_amount), 2) AS amount
      FROM sales
      WHERE branch_id = ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT 14
    `).all(parsedBranchId).reverse();

    const monthly = db.prepare(`
      SELECT substr(date, 1, 7) AS label, ROUND(SUM(total_amount), 2) AS amount
      FROM sales
      WHERE branch_id = ?
      GROUP BY substr(date, 1, 7)
      ORDER BY substr(date, 1, 7) DESC
      LIMIT 12
    `).all(parsedBranchId).reverse();

    res.json({ daily, monthly });
  });

  // AI Manager Insight
  app.post("/api/insight", async (req, res) => {
    try {
      const { prompt, branchId } = req.body;
      const parsedBranchId = branchId !== undefined && branchId !== null ? parsePositiveInt(branchId) : null;
      if ((branchId !== undefined && branchId !== null) && !parsedBranchId) {
        return res.status(400).json({ error: "Invalid branchId." });
      }
      
      // Fetch context data (filtered by branch if provided)
      const transactionWhere = parsedBranchId ? "WHERE branch_id = ?" : "";
      const inventoryWhere = parsedBranchId ? "WHERE i.branch_id = ?" : "";
      const txParams = parsedBranchId ? [parsedBranchId] : [];
      const invParams = parsedBranchId ? [parsedBranchId] : [];

      const transactions = db.prepare(`SELECT * FROM transactions ${transactionWhere} ORDER BY date DESC LIMIT 20`).all(...txParams);
      const inventory = db.prepare(`
        SELECT i.stock_level, p.name 
        FROM inventory i 
        JOIN products p ON i.product_id = p.id 
        ${inventoryWhere} 
        ORDER BY i.stock_level ASC LIMIT 20
      `).all(...invParams);
      
      const stats = db.prepare(`SELECT type, SUM(amount) as total FROM transactions ${transactionWhere} GROUP BY type`).all(...txParams);

      const context = `
        You are the General Manager of AyurLedger.
        Branch Context: ${parsedBranchId ? `Branch ID ${parsedBranchId}` : 'All Branches'}
        
        Financials: ${JSON.stringify(stats)}
        Recent Tx: ${JSON.stringify(transactions)}
        Low Stock Items: ${JSON.stringify(inventory)}
        
        User Question: ${prompt || "Give me a status report."}
        
        Provide actionable insights on sales, restocking needs, and expense control.
      `;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: context,
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Failed to generate insight" });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "..", "dist");
    app.use(express.static(distPath));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}
