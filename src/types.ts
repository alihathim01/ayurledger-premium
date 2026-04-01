export interface Branch {
  id: number;
  name: string;
  location: string;
  branch_type: 'store' | 'warehouse' | 'massage_center';
  phone: string | null;
  manager_name: string | null;
  is_active: number;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  cost: number;
  barcode: string | null;
  sku: string | null;
  is_active: number;
}

export interface InventoryItem extends Product {
  product_id: number;
  branch_id: number;
  stock_level: number;
  reorder_point: number;
  mfg_date: string | null;
  expiry_date: string | null;
  branch_name: string;
}

export interface InventoryAlert extends InventoryItem {
  alert_type: 'low_stock' | 'out_of_stock' | 'expiring_soon';
  branch_type: string;
}

export interface InventoryAlerts {
  low_stock: InventoryAlert[];
  out_of_stock: InventoryAlert[];
  expiring_soon: InventoryAlert[];
  summary: {
    low_stock_count: number;
    out_of_stock_count: number;
    expiring_soon_count: number;
    total_alerts: number;
  };
}

export interface Distributor {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  vendor_type: 'distributor' | 'individual' | 'utility' | 'landlord';
  pending_amount: number;
  is_active: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  company_name: string | null;
  vat_number: string | null;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
}

export interface PurchaseOrder {
  id: number;
  distributor_id: number;
  distributor_name: string;
  branch_id: number;
  branch_name: string;
  total_amount: number;
  paid_amount: number;
  status: 'pending' | 'received' | 'cancelled';
  date: string;
}

export interface SalesRecord {
  id: number;
  branch_id: number;
  branch_name?: string;
  opening_cash: number;
  cash_taken_out: number;
  taken_by: string | null;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  notes: string | null;
}

export interface SalesRecordSummary {
  totalSales: number;
  cashSales: number;
  cardSales: number;
  totalExpenses: number;
  openingCash: number;
  cashTakenOut: number;
  expectedClosingCash: number;
}

export interface CartItem extends InventoryItem {
  quantity: number;
}

export interface StockAdjustment {
  id: number;
  branch_id: number;
  product_id: number;
  quantity_change: number;
  reason: 'damaged' | 'expired' | 'manual_count' | 'theft' | 'write_off' | 'other';
  note: string | null;
  date: string;
  created_at: string;
}

export interface MassageClient {
  id: number;
  name: string;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  visit_count: number;
  created_at: string;
}

export interface MassageService {
  id: number;
  name: string;
  duration_minutes: number;
  price: number;
  description: string | null;
  is_active: number;
}

export interface MassageTherapist {
  id: number;
  name: string;
  phone: string | null;
  branch_id: number;
  is_active: number;
}

export interface MassageSession {
  id: number;
  branch_id: number;
  client_id: number | null;
  client_name: string | null;
  client_mobile: string | null;
  therapist_id: number | null;
  service_id: number | null;
  booking_date: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  price_charged: number | null;
  payment_method: string;
  notes: string | null;
  created_at: string;
  client_name_ref?: string;
  therapist_name?: string;
  service_name?: string;
  service_duration?: number;
}

export interface WholesaleSale {
  id: number;
  warehouse_branch_id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_amount: number;
  payment_method: string;
  payment_status: 'paid' | 'pending' | 'partial';
  date: string;
  created_at: string;
  warehouse_name?: string;
  company_name?: string;
  vat_number?: string;
}

export interface AdminUser {
  id: number;
  username: string;
  full_name: string | null;
  role:
    | 'admin'
    | 'accountant'
    | 'auditor'
    | 'warehouse_manager'
    | 'store_manager'
    | 'cashier'
    | 'massage_manager';
  is_active: number;
  assigned_branch_id: number | null;
  assigned_branch_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyBranchSummary {
  branch_id: number;
  branch_name: string;
  branch_type: 'store' | 'warehouse' | 'massage_center';
  location: string;
  is_active: number;
  sales_total: number;
  other_income_total: number;
  expense_total: number;
  revenue_total: number;
  profit_loss: number;
}
