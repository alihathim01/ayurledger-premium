import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/StoreContext';
import { formatSAR } from '@/lib/currency';

type CashEntry = {
  id: number;
  branch_id: number;
  type: 'in' | 'out';
  amount: number;
  category: string;
  note: string | null;
  date: string;
};

type CashSummary = {
  balance: number;
  totalIn: number;
  totalOut: number;
  entries: CashEntry[];
};

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};

export function CashInHand() {
  const { currentBranch } = useStore();
  const [summary, setSummary] = useState<CashSummary>({ balance: 0, totalIn: 0, totalOut: 0, entries: [] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: 'in' as 'in' | 'out',
    amount: '',
    category: '',
    note: '',
    date: getTodayIsoDate(),
  });

  useEffect(() => {
    if (currentBranch) {
      fetchLedger();
    }
  }, [currentBranch]);

  const fetchLedger = async () => {
    if (!currentBranch) return;
    try {
      const res = await fetch(`/api/cash-hand?branchId=${currentBranch.id}`);
      const data = await res.json();
      setSummary(data);
    } catch (error) {
      console.error('Failed to fetch cash-in-hand ledger', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentBranch) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !form.category.trim()) {
      alert('Enter valid amount and category.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/cash-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          type: form.type,
          amount,
          category: form.category.trim(),
          note: form.note.trim(),
          date: form.date,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to save entry.');
        return;
      }
      setForm({
        type: 'in',
        amount: '',
        category: '',
        note: '',
        date: getTodayIsoDate(),
      });
      await fetchLedger();
    } catch (error) {
      console.error('Failed to save cash-in-hand entry', error);
      alert('Failed to save entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Cash In Hand</h2>
        <p className="text-stone-500 mt-1">Manage office cash balance and movement log.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-stone-500">Current Balance</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatSAR(summary.balance)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-stone-500">Total Added</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-emerald-700">{formatSAR(summary.totalIn)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-stone-500">Total Used</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-rose-700">{formatSAR(summary.totalOut)}</p></CardContent>
        </Card>
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader>
          <CardTitle>New Cash Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="text-xs text-stone-500 uppercase">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'in' | 'out' })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <option value="in">Add Cash</option>
                <option value="out">Use Cash</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Amount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                placeholder="e.g. Petty cash top-up"
              />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-stone-500 uppercase">Note</label>
              <div className="flex gap-2">
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  placeholder="Optional"
                />
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cash In Hand History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Type</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Category</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Note</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.entries.map((entry) => (
                  <tr key={entry.id} className="odd:bg-white even:bg-stone-50">
                    <td className="border border-stone-300 px-3 py-2">{entry.date}</td>
                    <td className="border border-stone-300 px-3 py-2">
                      <span className={entry.type === 'in' ? 'text-emerald-700' : 'text-rose-700'}>
                        {entry.type === 'in' ? 'Add Cash' : 'Use Cash'}
                      </span>
                    </td>
                    <td className="border border-stone-300 px-3 py-2">{entry.category}</td>
                    <td className="border border-stone-300 px-3 py-2">{entry.note || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(entry.amount)}</td>
                  </tr>
                ))}
                {summary.entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No cash-in-hand entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
