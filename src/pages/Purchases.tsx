import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/StoreContext';
import { Distributor, Product, PurchaseOrder } from '@/types';
import { formatSAR } from '@/lib/currency';

type PurchaseForm = {
  distributor_id: string;
  product_id: string;
  quantity: string;
  cost: string;
  amount_paid: string;
};

const initialForm: PurchaseForm = {
  distributor_id: '',
  product_id: '',
  quantity: '1',
  cost: '',
  amount_paid: '0',
};

export function Purchases() {
  const { currentBranch } = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<PurchaseForm>(initialForm);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === Number(formData.product_id)),
    [products, formData.product_id]
  );

  useEffect(() => {
    fetchDistributors();
    fetchProducts();
  }, []);

  useEffect(() => {
    if (currentBranch) {
      fetchOrders(currentBranch.id);
    }
  }, [currentBranch]);

  useEffect(() => {
    if (selectedProduct && !formData.cost) {
      setFormData((prev) => ({ ...prev, cost: String(selectedProduct.cost) }));
    }
  }, [selectedProduct, formData.cost]);

  const fetchDistributors = async () => {
    try {
      const res = await fetch('/api/distributors');
      const data = await res.json();
      setDistributors(data);
      if (data.length > 0 && !formData.distributor_id) {
        setFormData((prev) => ({ ...prev, distributor_id: String(data[0].id) }));
      }
    } catch (error) {
      console.error('Failed to fetch distributors', error);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      setProducts(data);
      if (data.length > 0 && !formData.product_id) {
        setFormData((prev) => ({
          ...prev,
          product_id: String(data[0].id),
          cost: prev.cost || String(data[0].cost),
        }));
      }
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const fetchOrders = async (branchId: number) => {
    try {
      const res = await fetch(`/api/purchase-orders?branchId=${branchId}`);
      const data = await res.json();
      setOrders(data);
    } catch (error) {
      console.error('Failed to fetch purchase orders', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentBranch) return;

    const distributorId = Number(formData.distributor_id);
    const productId = Number(formData.product_id);
    const quantity = Number(formData.quantity);
    const cost = Number(formData.cost);
    const amountPaid = Number(formData.amount_paid);

    if (
      !Number.isInteger(distributorId) ||
      distributorId <= 0 ||
      !Number.isInteger(productId) ||
      productId <= 0 ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      !Number.isFinite(amountPaid) ||
      amountPaid < 0
    ) {
      alert('Enter valid purchase details.');
      return;
    }

    const total = quantity * cost;
    if (amountPaid > total) {
      alert('Amount paid cannot exceed total purchase amount.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          distributor_id: distributorId,
          amount_paid: amountPaid,
          items: [{ product_id: productId, quantity, cost }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to save purchase.');
        return;
      }
      setFormData((prev) => ({
        ...initialForm,
        distributor_id: prev.distributor_id,
        product_id: prev.product_id,
        cost: prev.cost,
      }));
      await Promise.all([
        fetchOrders(currentBranch.id),
        fetchDistributors(),
      ]);
    } catch (error) {
      console.error('Failed to save purchase', error);
      alert('Failed to save purchase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Purchase Entry</h2>
        <p className="text-stone-500 mt-1">Add purchased stock and track distributor pending balances.</p>
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader>
          <CardTitle>New Purchase</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-stone-500 uppercase">Distributor</label>
              <select
                value={formData.distributor_id}
                onChange={(e) => setFormData({ ...formData, distributor_id: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                {distributors.map((distributor) => (
                  <option key={distributor.id} value={distributor.id}>
                    {distributor.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stone-500 uppercase">Product</label>
              <select
                value={formData.product_id}
                onChange={(e) => {
                  const nextProduct = products.find((product) => product.id === Number(e.target.value));
                  setFormData({
                    ...formData,
                    product_id: e.target.value,
                    cost: nextProduct ? String(nextProduct.cost) : formData.cost,
                  });
                }}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku || 'No SKU'})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stone-500 uppercase">Qty</label>
              <input
                type="number"
                min={1}
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stone-500 uppercase">Cost / Unit</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.cost}
                onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stone-500 uppercase">Amount Paid</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.amount_paid}
                onChange={(e) => setFormData({ ...formData, amount_paid: e.target.value })}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={saving || !currentBranch}>
                {saving ? 'Saving...' : 'Save Purchase'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Purchases</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">PO #</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Distributor</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Total</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Paid</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Pending</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const pending = Math.max(0, order.total_amount - order.paid_amount);
                  return (
                    <tr key={order.id} className="odd:bg-white even:bg-stone-50">
                      <td className="border border-stone-300 px-3 py-2">{order.date}</td>
                      <td className="border border-stone-300 px-3 py-2">#{order.id}</td>
                      <td className="border border-stone-300 px-3 py-2">{order.distributor_name}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(order.total_amount)}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(order.paid_amount)}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(pending)}</td>
                      <td className="border border-stone-300 px-3 py-2">
                        <span className={order.status === 'pending' ? 'text-orange-700' : 'text-emerald-700'}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No purchase entries found.
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
