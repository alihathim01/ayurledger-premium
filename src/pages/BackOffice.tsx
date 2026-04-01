import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/api';
import type { AdminUser, Branch, MonthlyBranchSummary } from '@/types';

type BackOfficeTab = 'users' | 'branches' | 'reports';

type MonthlyReportResponse = {
  month: string;
  summary: MonthlyBranchSummary[];
  totals: {
    sales_total: number;
    other_income_total: number;
    expense_total: number;
    revenue_total: number;
    profit_loss: number;
  };
};

type BranchDetailsResponse = {
  sales: Array<{ id: number; date: string; payment_method: string; total_amount: number }>;
  expenses: Array<{ id: number; date: string; category: string; description: string; amount: number }>;
  income: Array<{ id: number; date: string; category: string; description: string; amount: number }>;
};

const ROLES: AdminUser['role'][] = [
  'admin',
  'accountant',
  'auditor',
  'warehouse_manager',
  'store_manager',
  'cashier',
  'massage_manager',
];

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0);

const defaultMonth = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 7);
};

async function downloadCsv(path: string, fileName: string) {
  const res = await fetch(path);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      message = err.error ?? message;
    } catch {}
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BackOffice() {
  const [tab, setTab] = useState<BackOfficeTab>('users');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({
    username: '',
    full_name: '',
    password: '',
    role: 'store_manager' as AdminUser['role'],
    is_active: 1,
    assigned_branch_id: '',
  });

  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [branchForm, setBranchForm] = useState({
    name: '',
    location: '',
    branch_type: 'store' as Branch['branch_type'],
    phone: '',
    manager_name: '',
    is_active: 1,
  });

  const [month, setMonth] = useState(defaultMonth());
  const [report, setReport] = useState<MonthlyReportResponse | null>(null);
  const [detailBranchId, setDetailBranchId] = useState<string>('');
  const [branchDetails, setBranchDetails] = useState<BranchDetailsResponse | null>(null);

  const detailBranch = useMemo(
    () => branches.find((branch) => branch.id === Number(detailBranchId)) ?? null,
    [branches, detailBranchId],
  );
  const assignableStoreBranches = useMemo(
    () => branches.filter((branch) => branch.branch_type === 'store'),
    [branches],
  );

  const loadUsers = async () => {
    const data = await api.get<AdminUser[]>('/api/admin/users');
    setUsers(data);
  };

  const loadBranches = async () => {
    const data = await api.get<Branch[]>('/api/admin/branches');
    setBranches(data);
  };

  const loadSummary = async (targetMonth = month) => {
    const data = await api.get<MonthlyReportResponse>(`/api/admin/reports/monthly?month=${encodeURIComponent(targetMonth)}`);
    setReport(data);
  };

  const loadBranchDetails = async (targetBranchId: string, targetMonth = month) => {
    if (!targetBranchId) {
      setBranchDetails(null);
      return;
    }
    const data = await api.get<BranchDetailsResponse>(
      `/api/admin/reports/monthly/branch-details?month=${encodeURIComponent(targetMonth)}&branchId=${targetBranchId}`,
    );
    setBranchDetails(data);
  };

  useEffect(() => {
    setBusy(true);
    Promise.all([loadUsers(), loadBranches(), loadSummary()])
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load back-office data.'))
      .finally(() => setBusy(false));
  }, []);

  const onSubmitUser = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (userForm.role !== 'admin' && !userForm.assigned_branch_id) {
      setError('Please assign a store for this user.');
      return;
    }
    setBusy(true);
    try {
      if (editingUserId) {
        await api.patch(`/api/admin/users/${editingUserId}`, {
          full_name: userForm.full_name,
          role: userForm.role,
          is_active: userForm.is_active,
          assigned_branch_id: userForm.role === 'admin' ? null : Number(userForm.assigned_branch_id),
          ...(userForm.password.trim() ? { password: userForm.password } : {}),
        });
      } else {
        await api.post('/api/admin/users', {
          ...userForm,
          assigned_branch_id: userForm.role === 'admin' ? null : Number(userForm.assigned_branch_id),
        });
      }
      setEditingUserId(null);
      setUserForm({ username: '', full_name: '', password: '', role: 'store_manager', is_active: 1, assigned_branch_id: '' });
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save user.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitBranch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editingBranchId) {
        await api.patch(`/api/admin/branches/${editingBranchId}`, branchForm);
      } else {
        await api.post('/api/admin/branches', branchForm);
      }
      setEditingBranchId(null);
      setBranchForm({ name: '', location: '', branch_type: 'store', phone: '', manager_name: '', is_active: 1 });
      await loadBranches();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save branch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Back Office</h2>
        <p className="text-stone-500 mt-1">Manage users, branches, and monthly financial reporting.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'users' ? 'default' : 'outline'} onClick={() => setTab('users')}>Users</Button>
        <Button variant={tab === 'branches' ? 'default' : 'outline'} onClick={() => setTab('branches')}>Branches</Button>
        <Button variant={tab === 'reports' ? 'default' : 'outline'} onClick={() => setTab('reports')}>Monthly Reports</Button>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>{editingUserId ? 'Edit User' : 'Create User'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmitUser} className="space-y-3">
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Username"
                  value={userForm.username}
                  disabled={Boolean(editingUserId)}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))}
                  required
                />
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Full name"
                  value={userForm.full_name}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, full_name: e.target.value }))}
                />
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder={editingUserId ? 'New password (optional)' : 'Password'}
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                  required={!editingUserId}
                />
                <select
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm bg-white"
                  value={userForm.role}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value as AdminUser['role'] }))}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                <select
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm bg-white"
                  value={userForm.assigned_branch_id}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, assigned_branch_id: e.target.value }))}
                  required={userForm.role !== 'admin'}
                  disabled={userForm.role === 'admin'}
                >
                  <option value="">Assign store</option>
                  {assignableStoreBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={userForm.is_active === 1}
                    onChange={(e) => setUserForm((prev) => ({ ...prev, is_active: e.target.checked ? 1 : 0 }))}
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>{editingUserId ? 'Update User' : 'Create User'}</Button>
                  {editingUserId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingUserId(null);
                        setUserForm({ username: '', full_name: '', password: '', role: 'store_manager', is_active: 1, assigned_branch_id: '' });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Users</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {users.map((user) => (
                <div key={user.id} className="rounded border border-stone-200 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">{user.username}</p>
                    <p className="text-xs text-stone-500">
                      {user.full_name || 'No name'} • {user.role} • {user.assigned_branch_name || 'No store assigned'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-700'}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingUserId(user.id);
                        setUserForm({
                          username: user.username,
                          full_name: user.full_name || '',
                          password: '',
                          role: user.role,
                          is_active: user.is_active,
                          assigned_branch_id: user.assigned_branch_id ? String(user.assigned_branch_id) : '',
                        });
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'branches' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle>{editingBranchId ? 'Edit Branch' : 'Create Branch'}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={onSubmitBranch} className="space-y-3">
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Branch name"
                  value={branchForm.name}
                  onChange={(e) => setBranchForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Location"
                  value={branchForm.location}
                  onChange={(e) => setBranchForm((prev) => ({ ...prev, location: e.target.value }))}
                  required
                />
                <select
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm bg-white"
                  value={branchForm.branch_type}
                  onChange={(e) => setBranchForm((prev) => ({ ...prev, branch_type: e.target.value as Branch['branch_type'] }))}
                >
                  <option value="store">store</option>
                  <option value="warehouse">warehouse</option>
                  <option value="massage_center">massage_center</option>
                </select>
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Phone"
                  value={branchForm.phone}
                  onChange={(e) => setBranchForm((prev) => ({ ...prev, phone: e.target.value }))}
                />
                <input
                  className="w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Manager name"
                  value={branchForm.manager_name}
                  onChange={(e) => setBranchForm((prev) => ({ ...prev, manager_name: e.target.value }))}
                />
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={branchForm.is_active === 1}
                    onChange={(e) => setBranchForm((prev) => ({ ...prev, is_active: e.target.checked ? 1 : 0 }))}
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>{editingBranchId ? 'Update Branch' : 'Create Branch'}</Button>
                  {editingBranchId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingBranchId(null);
                        setBranchForm({ name: '', location: '', branch_type: 'store', phone: '', manager_name: '', is_active: 1 });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Branches</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {branches.map((branch) => (
                <div key={branch.id} className="rounded border border-stone-200 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">{branch.name}</p>
                    <p className="text-xs text-stone-500">{branch.location} • {branch.branch_type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${branch.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-700'}`}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingBranchId(branch.id);
                        setBranchForm({
                          name: branch.name,
                          location: branch.location,
                          branch_type: branch.branch_type,
                          phone: branch.phone || '',
                          manager_name: branch.manager_name || '',
                          is_active: branch.is_active,
                        });
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Monthly Store Financials</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded border border-stone-200 px-3 py-2 text-sm"
                />
                <Button
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await loadSummary(month);
                      if (detailBranchId) await loadBranchDetails(detailBranchId, month);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not load monthly report.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await downloadCsv(
                        `/api/admin/reports/monthly/export?scope=summary&month=${encodeURIComponent(month)}`,
                        `monthly-summary-${month}.csv`,
                      );
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not export summary.');
                    }
                  }}
                >
                  Export Summary (Excel CSV)
                </Button>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-stone-500">
                      <th className="py-2">Branch</th>
                      <th className="py-2">Sales</th>
                      <th className="py-2">Other Income</th>
                      <th className="py-2">Expenses</th>
                      <th className="py-2">Revenue</th>
                      <th className="py-2">Profit/Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.summary || []).map((row) => (
                      <tr key={row.branch_id} className="border-b border-stone-100">
                        <td className="py-2">{row.branch_name}</td>
                        <td className="py-2">{formatMoney(row.sales_total)}</td>
                        <td className="py-2">{formatMoney(row.other_income_total)}</td>
                        <td className="py-2">{formatMoney(row.expense_total)}</td>
                        <td className="py-2">{formatMoney(row.revenue_total)}</td>
                        <td className={`py-2 font-medium ${row.profit_loss >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatMoney(row.profit_loss)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {report && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
                  <div className="rounded border border-stone-200 p-2">Sales: <strong>{formatMoney(report.totals.sales_total)}</strong></div>
                  <div className="rounded border border-stone-200 p-2">Other Income: <strong>{formatMoney(report.totals.other_income_total)}</strong></div>
                  <div className="rounded border border-stone-200 p-2">Expenses: <strong>{formatMoney(report.totals.expense_total)}</strong></div>
                  <div className="rounded border border-stone-200 p-2">Revenue: <strong>{formatMoney(report.totals.revenue_total)}</strong></div>
                  <div className="rounded border border-stone-200 p-2">P/L: <strong>{formatMoney(report.totals.profit_loss)}</strong></div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Store Monthly Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="rounded border border-stone-200 px-3 py-2 text-sm bg-white min-w-64"
                  value={detailBranchId}
                  onChange={(e) => setDetailBranchId(e.target.value)}
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
                <Button
                  onClick={async () => {
                    if (!detailBranchId) return;
                    setBusy(true);
                    setError(null);
                    try {
                      await loadBranchDetails(detailBranchId, month);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not load store details.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={!detailBranchId || busy}
                >
                  Load Details
                </Button>
                <Button
                  variant="outline"
                  disabled={!detailBranchId}
                  onClick={async () => {
                    if (!detailBranchId) return;
                    try {
                      await downloadCsv(
                        `/api/admin/reports/monthly/export?scope=details&month=${encodeURIComponent(month)}&branchId=${detailBranchId}`,
                        `store-details-${detailBranchId}-${month}.csv`,
                      );
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not export store details.');
                    }
                  }}
                >
                  Export Store Details (Excel CSV)
                </Button>
              </div>

              {branchDetails && detailBranch && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                  <div className="rounded border border-stone-200 p-2">
                    <p className="text-stone-500">Branch</p>
                    <p className="font-medium">{detailBranch.name}</p>
                  </div>
                  <div className="rounded border border-stone-200 p-2">
                    <p className="text-stone-500">Sales Entries</p>
                    <p className="font-medium">{branchDetails.sales.length}</p>
                  </div>
                  <div className="rounded border border-stone-200 p-2">
                    <p className="text-stone-500">Expense Entries</p>
                    <p className="font-medium">{branchDetails.expenses.length}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
