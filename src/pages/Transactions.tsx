import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { format } from 'date-fns';
import { useStore } from '@/context/StoreContext';
import { formatSAR } from '@/lib/currency';

interface Transaction {
  id: number;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  description: string;
  date: string;
}

export function Transactions() {
  const { currentBranch } = useStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    type: 'income',
    category: '',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (currentBranch) {
      fetchTransactions();
    }
  }, [currentBranch]);

  const fetchTransactions = async () => {
    try {
      const res = await fetch(`/api/transactions?branchId=${currentBranch?.id}`);
      const data = await res.json();
      setTransactions(data);
    } catch (error) {
      console.error('Failed to fetch transactions', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBranch) return;
    const amount = Number(formData.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      alert('Please enter a valid non-negative amount.');
      return;
    }

    try {
      await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, amount, branch_id: currentBranch.id }),
      });
      setIsFormOpen(false);
      fetchTransactions();
      setFormData({
        type: 'income',
        category: '',
        amount: '',
        description: '',
        date: new Date().toISOString().split('T')[0]
      });
    } catch (error) {
      console.error('Failed to add transaction', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Transactions</h2>
          <p className="text-stone-500 mt-1">Record for {currentBranch?.name}</p>
        </div>
        <Button onClick={() => setIsFormOpen(!isFormOpen)} className="bg-stone-900 text-white">
          <Plus className="mr-2 h-4 w-4" /> New Entry
        </Button>
      </div>

      {isFormOpen && (
        <Card className="bg-stone-50 border-stone-200">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 uppercase">Type</label>
                <select
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 uppercase">Category</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sales, Rent"
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 uppercase">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <label className="text-xs font-medium text-stone-500 uppercase">Description</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Details..."
                    className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                  <Button type="submit">Save</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-4 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-full ${tx.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {tx.type === 'income' ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="font-medium text-stone-900">{tx.description || tx.category}</p>
                    <p className="text-xs text-stone-500">{format(new Date(tx.date), 'MMM dd, yyyy')} | {tx.category}</p>
                  </div>
                </div>
                <div className={`font-bold ${tx.type === 'income' ? 'text-emerald-700' : 'text-stone-900'}`}>
                  {tx.type === 'income' ? '+' : '-'}{formatSAR(tx.amount)}
                </div>
              </div>
            ))}
            {transactions.length === 0 && !loading && (
              <p className="text-center text-stone-500 py-8">No transactions recorded yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
