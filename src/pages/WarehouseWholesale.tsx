import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatSAR } from '@/lib/currency';

type Branch = { id: number; name: string; branch_type: 'store' | 'warehouse' };
type WarehouseProduct = {
  product_id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock_level: number;
  price: number;
};
type WholesaleSale = {
  id: number;
  customer_name: string | null;
  total_amount: number;
  payment_method: string;
  date: string;
};

export function WarehouseWholesale() {
  const [warehouses, setWarehouses] = useState<Branch[]>([]);
  const [products, setProducts] = useState<WarehouseProduct[]>([]);
  const [sales, setSales] = useState<WholesaleSale[]>([]);
  const [saving, setSaving] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [form, setForm] = useState({
    customer_name: '',
    product_id: '',
    quantity: '1',
    price: '',
    payment_method: 'cash' as 'cash' | 'card',
  });

  useEffect(() => {
    fetchInitial();
  }, []);

  useEffect(() => {
    if (warehouseId) {
      fetchSales(warehouseId);
      fetchWarehouseProducts(warehouseId);
    }
  }, [warehouseId]);

  const fetchInitial = async () => {
    try {
      const [wRes] = await Promise.all([
        fetch('/api/branches?type=warehouse'),
      ]);
      const w = await wRes.json();
      setWarehouses(w);
      const initialWarehouseId = w[0] ? String(w[0].id) : '';
      setWarehouseId(initialWarehouseId);
      if (initialWarehouseId) {
        await fetchWarehouseProducts(initialWarehouseId);
        fetchSales(initialWarehouseId);
      }
    } catch (error) {
      console.error('Failed to load wholesale setup', error);
    }
  };

  const fetchWarehouseProducts = async (whId: string) => {
    try {
      const res = await fetch(`/api/warehouse/inventory?warehouse_branch_id=${whId}`);
      const data = await res.json();
      setProducts(data);
      setForm((prev) => ({
        ...prev,
        product_id: data[0] ? String(data[0].product_id) : '',
        price: data[0] ? String(data[0].price) : '',
      }));
    } catch (error) {
      console.error('Failed to load warehouse inventory products', error);
      setProducts([]);
    }
  };

  const fetchSales = async (whId: string) => {
    try {
      const res = await fetch(`/api/warehouse/wholesale-sales?warehouse_branch_id=${whId}`);
      const data = await res.json();
      setSales(data);
    } catch (error) {
      console.error('Failed to fetch wholesale sales', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      warehouse_branch_id: Number(warehouseId),
      customer_name: form.customer_name.trim(),
      payment_method: form.payment_method,
      items: [{
        product_id: Number(form.product_id),
        quantity: Number(form.quantity),
        price: Number(form.price),
      }],
    };
    if (
      !Number.isInteger(payload.warehouse_branch_id) || payload.warehouse_branch_id <= 0 ||
      !Number.isInteger(payload.items[0].product_id) || payload.items[0].product_id <= 0 ||
      !Number.isInteger(payload.items[0].quantity) || payload.items[0].quantity <= 0 ||
      !Number.isFinite(payload.items[0].price) || payload.items[0].price < 0
    ) {
      alert('Enter valid wholesale sale details.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/warehouse/wholesale-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Wholesale sale failed.');
        return;
      }
      setForm((prev) => ({ ...prev, customer_name: '', quantity: '1' }));
      await fetchSales(warehouseId);
    } catch (error) {
      console.error('Wholesale sale failed', error);
      alert('Wholesale sale failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Warehouse Wholesale</h2>
        <p className="text-stone-500 mt-1">Record wholesale sales directly from warehouse stock.</p>
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader><CardTitle>New Wholesale Sale</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="text-xs text-stone-500 uppercase">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                {warehouses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Customer</label>
              <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" placeholder="Wholesale buyer" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-stone-500 uppercase">Product</label>
              <select
                value={form.product_id}
                onChange={(e) => {
                  const selected = products.find((p) => p.product_id === Number(e.target.value));
                  setForm({ ...form, product_id: e.target.value, price: selected ? String(selected.price) : form.price });
                }}
                className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.sku || p.barcode || 'No Code'}) | Stock: {p.stock_level}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Qty</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Price / Unit</label>
              <input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Payment</label>
              <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as 'cash' | 'card' })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
              </select>
            </div>
            <div className="md:col-span-5">
              <Button type="submit" disabled={saving || products.length === 0}>{saving ? 'Saving...' : 'Record Wholesale Sale'}</Button>
              {products.length === 0 && (
                <p className="text-xs text-stone-500 mt-2">No products currently in selected warehouse inventory.</p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Wholesale Sales</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Sale #</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Customer</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Payment</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="odd:bg-white even:bg-stone-50">
                    <td className="border border-stone-300 px-3 py-2">{s.date}</td>
                    <td className="border border-stone-300 px-3 py-2">#{s.id}</td>
                    <td className="border border-stone-300 px-3 py-2">{s.customer_name || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{s.payment_method}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(s.total_amount)}</td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr><td colSpan={5} className="border border-stone-300 px-3 py-8 text-center text-stone-500">No wholesale sales found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
