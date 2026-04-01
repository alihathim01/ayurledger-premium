import { useState, useEffect, FormEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Distributor } from '@/types';
import { formatSAR } from '@/lib/currency';
import { useStore } from '@/context/StoreContext';

export function Distributors() {
  const { currentBranch } = useStore();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', address: '' });
  const [paymentEditorId, setPaymentEditorId] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState<'register_cash' | 'office_cash'>('register_cash');

  useEffect(() => {
    fetchDistributors();
  }, []);

  const fetchDistributors = async () => {
    try {
      const res = await fetch('/api/distributors');
      const data = await res.json();
      setDistributors(data);
    } catch (error) {
      console.error('Failed to fetch distributors', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/distributors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setIsFormOpen(false);
      fetchDistributors();
      setFormData({ name: '', phone: '', address: '' });
    } catch (error) {
      console.error('Failed to add distributor', error);
    }
  };

  const handleRecordPayment = async (distributorId: number) => {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid payment amount.');
      return;
    }

    try {
      const res = await fetch(`/api/distributors/${distributorId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          branch_id: currentBranch?.id,
          payment_source: paymentSource === 'register_cash' ? 'drawer' : 'hand',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to save payment.');
        return;
      }
      setPaymentEditorId(null);
      setPaymentAmount('');
      setPaymentSource('register_cash');
      fetchDistributors();
    } catch (error) {
      console.error('Failed to record payment', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Distributors</h2>
          <p className="text-stone-500 mt-1">Manage suppliers and pending balances.</p>
        </div>
        <Button onClick={() => setIsFormOpen(!isFormOpen)} className="bg-stone-900 text-white">
          <Plus className="mr-2 h-4 w-4" /> Add Distributor
        </Button>
      </div>

      {isFormOpen && (
        <Card className="bg-stone-50 border-stone-200">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <input
                type="text"
                required
                placeholder="Name"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Phone"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Address"
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
                <Button type="submit">Save</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="border-stone-300">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">#</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Name</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Phone</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Email</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Address</th>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">Pending Amount</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Payment Action</th>
                </tr>
              </thead>
              <tbody>
                {distributors.map((dist, index) => (
                  <tr key={dist.id} className={index % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                    <td className="border border-stone-300 px-3 py-2 text-right text-stone-500">{index + 1}</td>
                    <td className="border border-stone-300 px-3 py-2 font-medium">{dist.name}</td>
                    <td className="border border-stone-300 px-3 py-2">{dist.phone || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{dist.email || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{dist.address || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">
                      <span className={dist.pending_amount > 0 ? 'text-orange-700 font-semibold' : 'text-emerald-700'}>
                        {formatSAR(dist.pending_amount || 0)}
                      </span>
                    </td>
                    <td className="border border-stone-300 px-3 py-2">
                      {paymentEditorId === dist.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            placeholder="Amount"
                            className="h-8 w-28 rounded border border-stone-200 bg-white px-2 py-1 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant={paymentSource === 'register_cash' ? 'default' : 'outline'}
                            onClick={() => setPaymentSource('register_cash')}
                          >
                            Cash Register
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={paymentSource === 'office_cash' ? 'default' : 'outline'}
                            onClick={() => setPaymentSource('office_cash')}
                          >
                            Office Cash
                          </Button>
                          <Button type="button" size="sm" onClick={() => handleRecordPayment(dist.id)}>
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPaymentEditorId(null);
                              setPaymentAmount('');
                              setPaymentSource('register_cash');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPaymentEditorId(dist.id);
                            setPaymentAmount('');
                            setPaymentSource('register_cash');
                          }}
                        >
                          Record Payment
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {distributors.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No distributors found.
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
