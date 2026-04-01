import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

type TableConfig = {
  name: string;
  orderBy?: string;
  conflict?: string;
};

const sqlitePath = process.env.SQLITE_PATH || 'ayurledger.db';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const sqlite = new Database(sqlitePath, { readonly: true });
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const tables: TableConfig[] = [
  { name: 'branches', orderBy: 'id', conflict: 'id' },
  { name: 'distributors', orderBy: 'id', conflict: 'id' },
  { name: 'customers', orderBy: 'id', conflict: 'id' },
  { name: 'users', orderBy: 'id', conflict: 'id' },
  { name: 'user_branch_access', orderBy: 'user_id, branch_id', conflict: 'user_id,branch_id' },
  { name: 'products', orderBy: 'id', conflict: 'id' },
  { name: 'inventory', orderBy: 'id', conflict: 'id' },
  { name: 'stock_adjustments', orderBy: 'id', conflict: 'id' },
  { name: 'sales_records', orderBy: 'id', conflict: 'id' },
  { name: 'sales', orderBy: 'id', conflict: 'id' },
  { name: 'sale_items', orderBy: 'id', conflict: 'id' },
  { name: 'transactions', orderBy: 'id', conflict: 'id' },
  { name: 'purchase_orders', orderBy: 'id', conflict: 'id' },
  { name: 'purchase_items', orderBy: 'id', conflict: 'id' },
  { name: 'cash_hand_entries', orderBy: 'id', conflict: 'id' },
  { name: 'stock_transfers', orderBy: 'id', conflict: 'id' },
  { name: 'stock_transfer_items', orderBy: 'id', conflict: 'id' },
  { name: 'wholesale_sales', orderBy: 'id', conflict: 'id' },
  { name: 'wholesale_sale_items', orderBy: 'id', conflict: 'id' },
  { name: 'massage_clients', orderBy: 'id', conflict: 'id' },
  { name: 'massage_services', orderBy: 'id', conflict: 'id' },
  { name: 'massage_therapists', orderBy: 'id', conflict: 'id' },
  { name: 'massage_sessions', orderBy: 'id', conflict: 'id' },
  { name: 'working_schedule', orderBy: 'id', conflict: 'id' },
  { name: 'break_periods', orderBy: 'id', conflict: 'id' },
  { name: 'audit_log', orderBy: 'id', conflict: 'id' },
];

function loadRows(table: TableConfig) {
  const orderClause = table.orderBy ? ` ORDER BY ${table.orderBy}` : '';
  return sqlite.prepare(`SELECT * FROM ${table.name}${orderClause}`).all() as Record<string, unknown>[];
}

async function pushTable(table: TableConfig) {
  const rows = loadRows(table);
  if (rows.length === 0) {
    console.log(`Skipping ${table.name}: no rows`);
    return;
  }

  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const query = supabase.from(table.name).upsert(chunk, {
      onConflict: table.conflict,
      ignoreDuplicates: false,
    });

    const { error } = await query;
    if (error) {
      throw new Error(`Failed syncing ${table.name}: ${error.message}`);
    }
  }

  console.log(`Synced ${table.name}: ${rows.length} rows`);
}

async function main() {
  for (const table of tables) {
    await pushTable(table);
  }

  console.log('SQLite to Supabase sync complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
  });
