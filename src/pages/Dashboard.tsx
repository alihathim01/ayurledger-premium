import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore } from '@/context/StoreContext';
import { formatSAR } from '@/lib/currency';
import { RefreshCw } from 'lucide-react';
import { SalesRecord } from '@/types';

interface SalesPoint {
  label: string;
  amount: number;
}

interface SalesSeries {
  daily: SalesPoint[];
  monthly: SalesPoint[];
}

interface RecordReport {
  record: SalesRecord & { branch_name: string };
  summary: {
    totalSales: number;
    cashSales: number;
    cardSales: number;
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
    openingCash: number;
    cashTakenOut: number;
    expectedClosingCash: number;
  };
  sales: Array<{ id: number; total_amount: number; payment_method: 'cash' | 'card'; date: string }>;
  expenses: Array<{ id: number; category: string; amount: number; description: string; date: string }>;
}

export function Dashboard() {
  const { currentBranch } = useStore();
  const [salesSeries, setSalesSeries] = useState<SalesSeries>({ daily: [], monthly: [] });
  const [openRecord, setOpenRecord] = useState<SalesRecord | null>(null);
  const [report, setReport] = useState<RecordReport | null>(null);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (currentBranch) {
      refreshAll();
    }
  }, [currentBranch]);

  useEffect(() => {
    if (!currentBranch) return;
    const timer = setInterval(() => {
      refreshAll();
    }, 15000);
    return () => clearInterval(timer);
  }, [currentBranch]);

  const fetchSalesSeries = async () => {
    const res = await fetch(`/api/sales-series?branchId=${currentBranch?.id}`);
    if (!res.ok) throw new Error(`sales-series ${res.status}`);
    const data = await res.json();
    setSalesSeries({
      daily: data?.daily || [],
      monthly: data?.monthly || [],
    });
  };

  const fetchRecordReport = async (recordId: number) => {
    const res = await fetch(`/api/sales-records/${recordId}/report`);
    if (!res.ok) throw new Error(`record-report ${res.status}`);
    const data = await res.json();
    setReport(data);
  };

  const fetchOpenRecord = async () => {
    const res = await fetch(`/api/sales-records/open?branchId=${currentBranch?.id}`);
    if (!res.ok) throw new Error(`open-record ${res.status}`);
    const data = await res.json();
    setOpenRecord(data);
    if (data?.id) {
      await fetchRecordReport(data.id);
    } else {
      setReport(null);
    }
  };

  const refreshAll = async () => {
    try {
      await Promise.all([fetchSalesSeries(), fetchOpenRecord()]);
      setApiError('');
    } catch (error) {
      console.error('Dashboard refresh failed', error);
      setApiError('Dashboard could not load live record data. Restart server and refresh.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Dashboard</h2>
          <p className="text-stone-500 mt-1">Overview for {currentBranch?.name}</p>
          <p className={`text-xs mt-2 ${openRecord ? 'text-emerald-700' : 'text-orange-700'}`}>
            {openRecord ? `Tracking Open Record #${openRecord.id}` : 'No open sales record. Open one from Sales Ledger tab.'}
          </p>
          {report?.record?.opened_at && (
            <p className="text-xs text-stone-500 mt-1">
              Business Date: {new Date(report.record.opened_at).toLocaleDateString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm hover:bg-stone-50 inline-flex items-center gap-1"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {apiError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {apiError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Total Sales</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.totalSales || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Cash Sales</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.cashSales || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Card Sales</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.cardSales || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Cash Taken Out</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.cashTakenOut || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Total Income</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.totalIncome || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Total Expense</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.totalExpenses || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Opening Cash</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.openingCash || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-stone-500 uppercase">Expected Closing Cash</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{formatSAR(report?.summary.expectedClosingCash || 0)}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Daily Sales (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesSeries.daily}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#78716c', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#78716c' }} />
                <Tooltip formatter={(value: number) => formatSAR(value)} />
                <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Sales (Last 12 Months)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesSeries.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#78716c', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#78716c' }} />
                <Tooltip formatter={(value: number) => formatSAR(value)} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Sales Details (Open Record)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[320px] overflow-y-auto">
            {!report?.sales?.length && <p className="text-sm text-stone-500">No sales in open record.</p>}
            {report?.sales?.map((sale) => (
              <div key={sale.id} className="flex items-center justify-between rounded border border-stone-200 p-3 text-sm">
                <div>
                  <p className="font-medium">Sale #{sale.id}</p>
                  <p className="text-stone-500 uppercase text-xs">{sale.payment_method}</p>
                </div>
                <p className="font-semibold">{formatSAR(sale.total_amount)}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expense Details (Open Record)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[320px] overflow-y-auto">
            {!report?.expenses?.length && <p className="text-sm text-stone-500">No expenses in open record.</p>}
            {report?.expenses?.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded border border-stone-200 p-3 text-sm">
                <div>
                  <p className="font-medium">{tx.description || tx.category}</p>
                  <p className="text-stone-500 text-xs">{tx.category}</p>
                </div>
                <p className="font-semibold">{formatSAR(tx.amount)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
