import Database from 'better-sqlite3';

const db = new Database('ayurledger.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    branch_type TEXT CHECK(branch_type IN ('store', 'warehouse', 'massage_center')) NOT NULL DEFAULT 'store',
    phone TEXT,
    manager_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS distributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    vendor_type TEXT CHECK(vendor_type IN ('distributor', 'individual', 'utility', 'landlord')) NOT NULL DEFAULT 'distributor',
    pending_amount REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    company_name TEXT,
    vat_number TEXT,
    credit_limit REAL NOT NULL DEFAULT 0,
    outstanding_balance REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin','accountant','auditor','warehouse_manager','store_manager','cashier','massage_manager')) NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_branch_access (
    user_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    access_level TEXT CHECK(access_level IN ('view','operate','manage')) NOT NULL DEFAULT 'operate',
    PRIMARY KEY (user_id, branch_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    barcode TEXT,
    price REAL NOT NULL,
    cost REAL NOT NULL,
    sku TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    stock_level INTEGER NOT NULL DEFAULT 0,
    reorder_point INTEGER DEFAULT 10,
    mfg_date TEXT,
    expiry_date TEXT,
    UNIQUE(product_id, branch_id),
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity_change INTEGER NOT NULL,
    reason TEXT CHECK(reason IN ('damaged', 'expired', 'manual_count', 'theft', 'write_off', 'other')) NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(branch_id) REFERENCES branches(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER,
    sales_record_id INTEGER,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(branch_id) REFERENCES branches(id),
    FOREIGN KEY(sales_record_id) REFERENCES sales_records(id)
  );

  CREATE TABLE IF NOT EXISTS sales_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    opening_cash REAL NOT NULL DEFAULT 0,
    cash_taken_out REAL NOT NULL DEFAULT 0,
    taken_by TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    status TEXT CHECK(status IN ('open', 'closed')) NOT NULL DEFAULT 'open',
    notes TEXT,
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    record_id INTEGER,
    total_amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    discount_amount REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    FOREIGN KEY(branch_id) REFERENCES branches(id),
    FOREIGN KEY(record_id) REFERENCES sales_records(id)
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(sale_id) REFERENCES sales(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    distributor_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'received', 'cancelled')) DEFAULT 'pending',
    date TEXT NOT NULL,
    FOREIGN KEY(distributor_id) REFERENCES distributors(id),
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    cost_price REAL NOT NULL,
    FOREIGN KEY(order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS cash_hand_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('in', 'out')) NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_branch_id INTEGER NOT NULL,
    to_branch_id INTEGER NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_branch_id) REFERENCES branches(id),
    FOREIGN KEY(to_branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY(transfer_id) REFERENCES stock_transfers(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS wholesale_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_branch_id INTEGER NOT NULL,
    customer_id INTEGER,
    customer_name TEXT,
    customer_phone TEXT,
    total_amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    payment_status TEXT CHECK(payment_status IN ('paid', 'pending', 'partial')) NOT NULL DEFAULT 'paid',
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(warehouse_branch_id) REFERENCES branches(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS wholesale_sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wholesale_sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    FOREIGN KEY(wholesale_sale_id) REFERENCES wholesale_sales(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS massage_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT,
    email TEXT,
    notes TEXT,
    visit_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS massage_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS massage_therapists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    branch_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS massage_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    client_id INTEGER,
    client_name TEXT,
    client_mobile TEXT,
    therapist_id INTEGER,
    service_id INTEGER,
    booking_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_minutes INTEGER,
    status TEXT CHECK(status IN ('scheduled', 'completed', 'cancelled', 'no_show')) NOT NULL DEFAULT 'scheduled',
    price_charged REAL,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(branch_id) REFERENCES branches(id),
    FOREIGN KEY(client_id) REFERENCES massage_clients(id),
    FOREIGN KEY(therapist_id) REFERENCES massage_therapists(id),
    FOREIGN KEY(service_id) REFERENCES massage_services(id)
  );

  CREATE TABLE IF NOT EXISTS working_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    open_time TEXT NOT NULL DEFAULT '10:00',
    close_time TEXT NOT NULL DEFAULT '02:00',
    UNIQUE(branch_id, day_of_week),
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS break_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    break_start TEXT NOT NULL DEFAULT '13:00',
    break_end TEXT NOT NULL DEFAULT '17:00',
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    request_id TEXT,
    ip_address TEXT,
    table_name TEXT NOT NULL,
    record_id INTEGER,
    action TEXT CHECK(action IN ('insert', 'update', 'delete')) NOT NULL,
    before_json TEXT,
    after_json TEXT,
    changed_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(actor_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_branch_date ON transactions(branch_id, date);
  CREATE INDEX IF NOT EXISTS idx_inventory_branch_product ON inventory(branch_id, product_id);
  CREATE INDEX IF NOT EXISTS idx_sales_record_branch_status ON sales_records(branch_id, status);
  CREATE INDEX IF NOT EXISTS idx_cash_hand_branch_date ON cash_hand_entries(branch_id, date);
  CREATE INDEX IF NOT EXISTS idx_transfer_from_to_date ON stock_transfers(from_branch_id, to_branch_id, date);
  CREATE INDEX IF NOT EXISTS idx_wholesale_branch_date ON wholesale_sales(warehouse_branch_id, date);
  CREATE INDEX IF NOT EXISTS idx_massage_sessions_date ON massage_sessions(branch_id, booking_date);
  CREATE INDEX IF NOT EXISTS idx_massage_sessions_therapist ON massage_sessions(therapist_id, booking_date);
  CREATE INDEX IF NOT EXISTS idx_stock_adjustments_branch ON stock_adjustments(branch_id, date);
  CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, created_at);
`);

const auditColumns = db.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[];
if (!auditColumns.some((column) => column.name === 'actor_user_id')) db.exec('ALTER TABLE audit_log ADD COLUMN actor_user_id INTEGER');
if (!auditColumns.some((column) => column.name === 'request_id')) db.exec('ALTER TABLE audit_log ADD COLUMN request_id TEXT');
if (!auditColumns.some((column) => column.name === 'ip_address')) db.exec('ALTER TABLE audit_log ADD COLUMN ip_address TEXT');
if (!auditColumns.some((column) => column.name === 'before_json')) db.exec('ALTER TABLE audit_log ADD COLUMN before_json TEXT');
if (!auditColumns.some((column) => column.name === 'after_json')) db.exec('ALTER TABLE audit_log ADD COLUMN after_json TEXT');

const distributorColumns = db.prepare('PRAGMA table_info(distributors)').all() as { name: string }[];
if (!distributorColumns.some((column) => column.name === 'pending_amount')) db.exec('ALTER TABLE distributors ADD COLUMN pending_amount REAL NOT NULL DEFAULT 0');
if (!distributorColumns.some((column) => column.name === 'vendor_type')) db.exec("ALTER TABLE distributors ADD COLUMN vendor_type TEXT NOT NULL DEFAULT 'distributor'");
if (!distributorColumns.some((column) => column.name === 'is_active')) db.exec('ALTER TABLE distributors ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');

const purchaseOrderColumns = db.prepare('PRAGMA table_info(purchase_orders)').all() as { name: string }[];
if (!purchaseOrderColumns.some((column) => column.name === 'paid_amount')) db.exec('ALTER TABLE purchase_orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0');

const branchColumns = db.prepare('PRAGMA table_info(branches)').all() as { name: string }[];
if (!branchColumns.some((column) => column.name === 'branch_type')) db.exec("ALTER TABLE branches ADD COLUMN branch_type TEXT NOT NULL DEFAULT 'store'");
if (!branchColumns.some((column) => column.name === 'phone')) db.exec('ALTER TABLE branches ADD COLUMN phone TEXT');
if (!branchColumns.some((column) => column.name === 'manager_name')) db.exec('ALTER TABLE branches ADD COLUMN manager_name TEXT');
if (!branchColumns.some((column) => column.name === 'is_active')) db.exec('ALTER TABLE branches ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
db.exec("UPDATE branches SET branch_type = 'store' WHERE branch_type IS NULL OR branch_type NOT IN ('store', 'warehouse', 'massage_center')");

const productColumns = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
if (!productColumns.some((column) => column.name === 'barcode')) db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');
if (!productColumns.some((column) => column.name === 'is_active')) db.exec('ALTER TABLE products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');

let salesColumns = db.prepare('PRAGMA table_info(sales)').all() as { name: string }[];
if (!salesColumns.some((column) => column.name === 'record_id')) {
  db.exec('ALTER TABLE sales ADD COLUMN record_id INTEGER');
  salesColumns = db.prepare('PRAGMA table_info(sales)').all() as { name: string }[];
}
if (!salesColumns.some((column) => column.name === 'discount_amount')) db.exec('ALTER TABLE sales ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0');

const saleItemColumns = db.prepare('PRAGMA table_info(sale_items)').all() as { name: string }[];
if (!saleItemColumns.some((column) => column.name === 'discount_amount')) db.exec('ALTER TABLE sale_items ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0');

const transactionColumns = db.prepare('PRAGMA table_info(transactions)').all() as { name: string }[];
if (!transactionColumns.some((column) => column.name === 'sales_record_id')) db.exec('ALTER TABLE transactions ADD COLUMN sales_record_id INTEGER');

const salesRecordColumns = db.prepare('PRAGMA table_info(sales_records)').all() as { name: string }[];
if (!salesRecordColumns.some((column) => column.name === 'taken_by')) db.exec('ALTER TABLE sales_records ADD COLUMN taken_by TEXT');

const inventoryColumns = db.prepare('PRAGMA table_info(inventory)').all() as { name: string }[];
if (!inventoryColumns.some((column) => column.name === 'mfg_date')) db.exec('ALTER TABLE inventory ADD COLUMN mfg_date TEXT');
if (!inventoryColumns.some((column) => column.name === 'expiry_date')) db.exec('ALTER TABLE inventory ADD COLUMN expiry_date TEXT');

const wholesaleColumns = db.prepare('PRAGMA table_info(wholesale_sales)').all() as { name: string }[];
if (!wholesaleColumns.some((column) => column.name === 'customer_id')) db.exec('ALTER TABLE wholesale_sales ADD COLUMN customer_id INTEGER');
if (!wholesaleColumns.some((column) => column.name === 'customer_phone')) db.exec('ALTER TABLE wholesale_sales ADD COLUMN customer_phone TEXT');
if (!wholesaleColumns.some((column) => column.name === 'payment_status')) db.exec("ALTER TABLE wholesale_sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'");

if (salesColumns.some((column) => column.name === 'record_id')) db.exec('CREATE INDEX IF NOT EXISTS idx_sales_record_id ON sales(record_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_massage_sessions_date ON massage_sessions(branch_id, booking_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_massage_sessions_therapist ON massage_sessions(therapist_id, booking_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_stock_adjustments_branch ON stock_adjustments(branch_id, date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, created_at)');

const warehouseCount = db.prepare("SELECT COUNT(*) as count FROM branches WHERE branch_type = 'warehouse'").get() as { count: number };
if (warehouseCount.count === 0) {
  db.prepare("INSERT INTO branches (name, location, branch_type) VALUES (?, ?, 'warehouse')").run('Central Warehouse', 'Navi Mumbai, MH');
}

const branchCount = db.prepare('SELECT count(*) as count FROM branches').get() as { count: number };
if (branchCount.count === 0) {
  console.log('Seeding database...');
  const insertBranch = db.prepare('INSERT INTO branches (name, location, branch_type) VALUES (?, ?, ?)');
  const mainBranch = insertBranch.run('Main Store - Mumbai', 'Mumbai, MH', 'store').lastInsertRowid;
  const secondBranch = insertBranch.run('Pune Outlet', 'Pune, MH', 'store').lastInsertRowid;
  const warehouseBranch = insertBranch.run('Central Warehouse', 'Navi Mumbai, MH', 'warehouse').lastInsertRowid;

  const insertDist = db.prepare('INSERT INTO distributors (name, phone, email, address, pending_amount) VALUES (?, ?, ?, ?, ?)');
  insertDist.run('Himalaya Herbals Supply', '+91 98765 43210', 'orders@himalaya.com', 'Bangalore', 0);
  insertDist.run('Organic India Wholesale', '+91 99887 76655', 'sales@organicindia.com', 'Lucknow', 0);

  const insertProd = db.prepare('INSERT INTO products (name, category, barcode, price, cost, sku) VALUES (?, ?, ?, ?, ?, ?)');
  const p1 = insertProd.run('Ashwagandha Powder', 'Herbs', '890100100001', 15.0, 8.0, 'ASH-001').lastInsertRowid;
  const p2 = insertProd.run('Triphala Churna', 'Herbs', '890100100002', 12.5, 6.0, 'TRI-001').lastInsertRowid;
  const p3 = insertProd.run('Brahmi Oil', 'Oils', '890100100003', 25.0, 15.0, 'BRA-001').lastInsertRowid;
  const p4 = insertProd.run('Chyawanprash', 'Supplements', '890100100004', 35.0, 22.0, 'CHY-001').lastInsertRowid;
  const p5 = insertProd.run('Kumkumadi Tailam', 'Beauty', '890100100005', 85.0, 50.0, 'KUM-001').lastInsertRowid;

  const insertInv = db.prepare('INSERT INTO inventory (product_id, branch_id, stock_level, reorder_point) VALUES (?, ?, ?, ?)');
  insertInv.run(p1, mainBranch, 50, 20);
  insertInv.run(p2, mainBranch, 40, 15);
  insertInv.run(p3, mainBranch, 20, 10);
  insertInv.run(p4, mainBranch, 15, 10);
  insertInv.run(p5, mainBranch, 10, 5);
  insertInv.run(p1, secondBranch, 20, 10);
  insertInv.run(p2, secondBranch, 15, 10);
  insertInv.run(p3, secondBranch, 5, 5);
  insertInv.run(p1, warehouseBranch, 200, 40);
  insertInv.run(p2, warehouseBranch, 180, 40);
  insertInv.run(p3, warehouseBranch, 120, 20);
  insertInv.run(p4, warehouseBranch, 100, 20);
  insertInv.run(p5, warehouseBranch, 80, 15);

  const insertTx = db.prepare('INSERT INTO transactions (branch_id, type, category, amount, description, date) VALUES (?, ?, ?, ?, ?, ?)');
  const today = new Date().toISOString().split('T')[0];
  insertTx.run(mainBranch, 'income', 'Consultation', 450.0, 'Dr. Sharma Consultation', today);
  insertTx.run(mainBranch, 'expense', 'Utilities', 150.0, 'Electricity Bill', today);
  insertTx.run(secondBranch, 'expense', 'Rent', 1200.0, 'Monthly Shop Rent', today);
  console.log('Database seeded successfully.');
}

export default db;
