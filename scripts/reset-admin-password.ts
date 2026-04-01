import crypto from "crypto";
import { createRequire } from "module";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const require = createRequire(import.meta.url);

const username = process.argv[2] || "admin";
const nextPassword = process.argv[3] || "ChangeMe123!";

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
};

const passwordHash = hashPassword(nextPassword);

async function resetSupabasePassword() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("[reset-admin-password] Supabase env vars are missing. Skipping Supabase update.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error, count } = await supabase
    .from("users")
    .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .eq("username", username);

  if (error) {
    throw new Error(`Supabase update failed: ${error.message}`);
  }

  console.log(`[reset-admin-password] Supabase updated rows for '${username}'.`);
  if (typeof count === "number") {
    console.log(`[reset-admin-password] Supabase count: ${count}`);
  }
}

function resetSqlitePassword() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database("ayurledger.db");
    const info = db
      .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
      .run(passwordHash, username);
    db.close();
    console.log(`[reset-admin-password] SQLite updated rows for '${username}': ${info.changes}`);
  } catch (error) {
    console.warn(
      "[reset-admin-password] SQLite update skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function main() {
  await resetSupabasePassword();
  resetSqlitePassword();
  console.log(`[reset-admin-password] Password reset complete for '${username}'.`);
}

main().catch((error) => {
  console.error("[reset-admin-password]", error instanceof Error ? error.message : error);
  process.exit(1);
});
