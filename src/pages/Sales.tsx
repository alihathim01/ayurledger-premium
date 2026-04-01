import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/StoreContext';
import { SalesRecord, SalesRecordSummary } from '@/types';
import { formatSAR } from '@/lib/currency';

type ReportData = {
  record: SalesRecord & { branch_name: string };
  summary: SalesRecordSummary;
  sales: Array<{ id: number; total_amount: number; payment_method: 'cash' | 'card'; date: string }>;
  expenses: Array<{ id: number; category: string; amount: number; description: string; date: string }>;
};

const toDisplayDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '-');

export function Sales() {
  const { currentBranch } = useStore();
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [openRecord, setOpenRecord] = useState<SalesRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [openingCash, setOpeningCash] = useState('0');
  const [notes, setNotes] = useState('');
  const [cashTakenOut, setCashTakenOut] = useState('0');

  useEffect(() => {
    if (currentBranch) {
      refreshData();
    }
  }, [currentBranch]);

  const refreshData = async () => {
    if (!currentBranch) return;
    try {
      const [recordsRes, openRes] = await Promise.all([
        fetch(`/api/sales-records?branchId=${currentBranch.id}`),
        fetch(`/api/sales-records/open?branchId=${currentBranch.id}`),
      ]);
      setRecords(await recordsRes.json());
      setOpenRecord(await openRes.json());
    } catch (error) {
      console.error('Failed to load sales records', error);
    }
  };

  const createRecord = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentBranch) return;
    const opening = Number(openingCash);
    if (!Number.isFinite(opening) || opening < 0) {
      alert('Enter a valid opening cash amount.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/sales-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          opening_cash: opening,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to create sales record.');
        return;
      }
      setOpeningCash('0');
      setNotes('');
      await refreshData();
    } catch (error) {
      console.error('Failed to create sales record', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async (recordId: number) => {
    try {
      const res = await fetch(`/api/sales-records/${recordId}/report`);
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to load report.');
        return;
      }
      setReport(data);
    } catch (error) {
      console.error('Failed to load report', error);
    }
  };

  const closeRecord = async () => {
    if (!openRecord) return;
    const cashOut = Number(cashTakenOut);
    if (!Number.isFinite(cashOut) || cashOut < 0) {
      alert('Enter valid cash taken out amount.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/sales-records/${openRecord.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash_taken_out: cashOut }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to close record.');
        return;
      }
      await refreshData();
      setCashTakenOut('0');
      await fetchReport(openRecord.id);
    } catch (error) {
      console.error('Failed to close record', error);
    } finally {
      setLoading(false);
    }
  };

  const printReport = () => {
    if (!report) return;
    const popup = window.open('', '_blank', 'width=900,height=1000');
    if (!popup) return;

    popup.document.write(`
      <html>
        <head>
          <title>Sales Record #${report.record.id}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1, h2 { margin: 0 0 8px 0; }
            .muted { color: #6b7280; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; text-align: left; }
            th { background: #f3f4f6; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
            .card { border: 1px solid #e5e7eb; padding: 8px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <h1>Sales Ledger Report</h1>
          <p class="muted">Branch: ${report.record.branch_name} | Record #${report.record.id}</p>
          <p class="muted">From: ${toDisplayDate(report.record.opened_at)} | To: ${toDisplayDate(report.record.closed_at)}</p>
          <div class="grid">
            <div class="card">Opening Cash: ${formatSAR(report.summary.openingCash)}</div>
            <div class="card">Cash Sales: ${formatSAR(report.summary.cashSales)}</div>
            <div class="card">Card Sales: ${formatSAR(report.summary.cardSales)}</div>
            <div class="card">Total Sales: ${formatSAR(report.summary.totalSales)}</div>
            <div class="card">Expenses: ${formatSAR(report.summary.totalExpenses)}</div>
            <div class="card">Cash Taken Out: ${formatSAR(report.summary.cashTakenOut)}</div>
            <div class="card">Expected Closing Cash: ${formatSAR(report.summary.expectedClosingCash)}</div>
          </div>
          <h2>Sales Entries</h2>
          <table>
            <thead><tr><th>ID</th><th>Date</th><th>Payment</th><th>Total</th></tr></thead>
            <tbody>
              ${report.sales.map((sale) => `<tr><td>${sale.id}</td><td>${sale.date}</td><td>${sale.payment_method}</td><td>${formatSAR(sale.total_amount)}</td></tr>`).join('')}
            </tbody>
          </table>
          <h2 style="margin-top:20px;">Expense Entries</h2>
          <table>
            <thead><tr><th>ID</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              ${report.expenses.map((tx) => `<tr><td>${tx.id}</td><td>${tx.date}</td><td>${tx.category}</td><td>${tx.description || ''}</td><td>${formatSAR(tx.amount)}</td></tr>`).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Sales</h2>
        <p className="text-stone-500 mt-1">Create daily records, close them, and export consolidated reports to PDF.</p>
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader>
          <CardTitle>{openRecord ? `Open Record #${openRecord.id}` : 'Create Sales Record'}</CardTitle>
        </CardHeader>
        <CardContent>
          {!openRecord ? (
            <form onSubmit={createRecord} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1">
                <label className="text-xs text-stone-500 uppercase">Opening Cash</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-stone-500 uppercase">Notes (optional)</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" disabled={loading || !currentBranch}>
                {loading ? 'Creating...' : 'Create Record'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-stone-600">
                <p>Opened: {toDisplayDate(openRecord.opened_at)}</p>
                <p>Opening Cash: <span className="font-semibold text-stone-900">{formatSAR(openRecord.opening_cash)}</span></p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1">
                  <label className="text-xs text-stone-500 uppercase">Cash Taken Out</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={cashTakenOut}
                    onChange={(e) => setCashTakenOut(e.target.value)}
                    className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <Button onClick={closeRecord} disabled={loading}>
                    {loading ? 'Closing...' : 'Close Record'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">ID</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Opened</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Closed</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Opening Cash</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Cash Out</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Status</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="odd:bg-white even:bg-stone-50">
                    <td className="border border-stone-300 px-3 py-2">#{record.id}</td>
                    <td className="border border-stone-300 px-3 py-2">{toDisplayDate(record.opened_at)}</td>
                    <td className="border border-stone-300 px-3 py-2">{toDisplayDate(record.closed_at)}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(record.opening_cash)}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(record.cash_taken_out || 0)}</td>
                    <td className="border border-stone-300 px-3 py-2">
                      <span className={record.status === 'open' ? 'text-emerald-700' : 'text-stone-700'}>
                        {record.status}
                      </span>
                    </td>
                    <td className="border border-stone-300 px-3 py-2">
                      <Button variant="outline" size="sm" onClick={() => fetchReport(record.id)}>
                        View Report
                      </Button>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No sales records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {report && (
        <Card className="border-emerald-200">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Report: Record #{report.record.id}</CardTitle>
              <Button onClick={printReport}>Print / Save as PDF</Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded border border-stone-200 p-3 text-sm">Total Sales: <strong>{formatSAR(report.summary.totalSales)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm">Cash Sales: <strong>{formatSAR(report.summary.cashSales)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm">Card Sales: <strong>{formatSAR(report.summary.cardSales)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm">Expenses: <strong>{formatSAR(report.summary.totalExpenses)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm">Opening Cash: <strong>{formatSAR(report.summary.openingCash)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm">Cash Taken Out: <strong>{formatSAR(report.summary.cashTakenOut)}</strong></div>
            <div className="rounded border border-stone-200 p-3 text-sm md:col-span-2">Expected Closing Cash: <strong>{formatSAR(report.summary.expectedClosingCash)}</strong></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
