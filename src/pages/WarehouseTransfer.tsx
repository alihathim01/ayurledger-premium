import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/StoreContext';

type Branch = { id: number; name: string; branch_type: 'store' | 'warehouse' };
type WarehouseProduct = {
  product_id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock_level: number;
};
type Transfer = { id: number; from_branch_name: string; to_branch_name: string; note: string | null; date: string };

export function WarehouseTransfer() {
  const { currentBranch } = useStore();
  const [warehouses, setWarehouses] = useState<Branch[]>([]);
  const [stores, setStores] = useState<Branch[]>([]);
  const [products, setProducts] = useState<WarehouseProduct[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    from_branch_id: '',
    to_branch_id: '',
    product_id: '',
    quantity: '1',
    note: '',
  });

  useEffect(() => {
    fetchInitial();
  }, []);

  useEffect(() => {
    if (currentBranch && stores.length > 0 && !form.to_branch_id) {
      const match = stores.find((s) => s.id === currentBranch.id);
      if (match) setForm((prev) => ({ ...prev, to_branch_id: String(match.id) }));
    }
  }, [currentBranch, stores, form.to_branch_id]);

  useEffect(() => {
    if (form.from_branch_id) {
      fetchWarehouseProducts(form.from_branch_id);
    }
  }, [form.from_branch_id]);

  const fetchInitial = async () => {
    try {
      const bRes = await fetch('/api/branches');
      const b = await bRes.json();

      const allBranches = Array.isArray(b) ? (b as Array<Partial<Branch> & { id: number; name: string }>) : [];
      const inferredWarehouses = allBranches.filter((branch) =>
        (typeof branch.branch_type === 'string' && branch.branch_type.toLowerCase() === 'warehouse') ||
        /warehouse/i.test(branch.name || '')
      ) as Branch[];
      const inferredStores = allBranches.filter((branch) =>
        !(
          (typeof branch.branch_type === 'string' && branch.branch_type.toLowerCase() === 'warehouse') ||
          /warehouse/i.test(branch.name || '')
        )
      ) as Branch[];

      setWarehouses(inferredWarehouses);
      setStores(inferredStores);
      const initialWarehouseId = inferredWarehouses[0] ? String(inferredWarehouses[0].id) : '';
      const initialStoreId = inferredStores[0] ? String(inferredStores[0].id) : '';
      if (initialWarehouseId) {
        await fetchWarehouseProducts(initialWarehouseId);
      } else {
        setProducts([]);
      }
      setForm((prev) => ({
        ...prev,
        from_branch_id: inferredWarehouses.some((w) => String(w.id) === prev.from_branch_id)
          ? prev.from_branch_id
          : initialWarehouseId,
        to_branch_id: inferredStores.some((s) => String(s.id) === prev.to_branch_id)
          ? prev.to_branch_id
          : initialStoreId,
        product_id: prev.product_id || '',
      }));

      try {
        const tRes = await fetch('/api/transfers');
        if (tRes.ok) {
          const t = await tRes.json();
          setTransfers(Array.isArray(t) ? t : []);
        } else {
          setTransfers([]);
        }
      } catch {
        setTransfers([]);
      }
    } catch (error) {
      console.error('Failed to load transfer data', error);
    }
  };

  const fetchWarehouseProducts = async (warehouseId: string) => {
    try {
      const res = await fetch(`/api/warehouse/inventory?warehouse_branch_id=${warehouseId}`);
      let nextProducts: WarehouseProduct[] = [];

      if (res.ok) {
        const data = await res.json();
        nextProducts = Array.isArray(data) ? data : [];
      } else {
        const fallbackRes = await fetch(`/api/inventory?branchId=${warehouseId}`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          nextProducts = (Array.isArray(fallbackData) ? fallbackData : [])
            .filter((row) => Number(row?.stock_level) > 0)
            .map((row) => ({
              product_id: Number(row.product_id),
              name: String(row.name || ''),
              sku: row.sku || null,
              barcode: row.barcode || null,
              stock_level: Number(row.stock_level || 0),
            }));
        }
      }

      setProducts(nextProducts);
      setForm((prev) => ({
        ...prev,
        product_id: nextProducts.some((p) => String(p.product_id) === prev.product_id)
          ? prev.product_id
          : (nextProducts[0] ? String(nextProducts[0].product_id) : ''),
      }));
    } catch (error) {
      console.error('Failed to load warehouse inventory', error);
      setProducts([]);
      setForm((prev) => ({ ...prev, product_id: '' }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      from_branch_id: Number(form.from_branch_id),
      to_branch_id: Number(form.to_branch_id),
      items: [{ product_id: Number(form.product_id), quantity: Number(form.quantity) }],
      note: form.note.trim(),
    };
    if (
      !Number.isInteger(payload.from_branch_id) || payload.from_branch_id <= 0 ||
      !Number.isInteger(payload.to_branch_id) || payload.to_branch_id <= 0 ||
      !Number.isInteger(payload.items[0].product_id) || payload.items[0].product_id <= 0 ||
      !Number.isInteger(payload.items[0].quantity) || payload.items[0].quantity <= 0
    ) {
      alert('Enter valid transfer details.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Transfer failed.');
        return;
      }
      setForm((prev) => ({ ...prev, quantity: '1', note: '' }));
      await fetchInitial();
    } catch (error) {
      console.error('Transfer failed', error);
      alert('Transfer failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Warehouse Transfer</h2>
        <p className="text-stone-500 mt-1">Move stock from warehouse to stores.</p>
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader><CardTitle>New Transfer</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="text-xs text-stone-500 uppercase">From Warehouse</label>
              <select value={form.from_branch_id} onChange={(e) => setForm({ ...form, from_branch_id: e.target.value, product_id: '' })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                {warehouses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">To Store</label>
              <select value={form.to_branch_id} onChange={(e) => setForm({ ...form, to_branch_id: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                {stores.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-stone-500 uppercase">Product</label>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                {products.length === 0 && <option value="">No warehouse products available</option>}
                {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.sku || p.barcode || 'No Code'}) | Stock: {p.stock_level}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Quantity</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Note</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-6">
              <Button type="submit" disabled={saving || products.length === 0}>{saving ? 'Transferring...' : 'Create Transfer'}</Button>
              {products.length === 0 && (
                <p className="text-xs text-stone-500 mt-2">No products currently in selected warehouse inventory.</p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Transfers</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Transfer #</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">From</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">To</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Note</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="odd:bg-white even:bg-stone-50">
                    <td className="border border-stone-300 px-3 py-2">{t.date}</td>
                    <td className="border border-stone-300 px-3 py-2">#{t.id}</td>
                    <td className="border border-stone-300 px-3 py-2">{t.from_branch_name}</td>
                    <td className="border border-stone-300 px-3 py-2">{t.to_branch_name}</td>
                    <td className="border border-stone-300 px-3 py-2">{t.note || '-'}</td>
                  </tr>
                ))}
                {transfers.length === 0 && (
                  <tr><td colSpan={5} className="border border-stone-300 px-3 py-8 text-center text-stone-500">No transfers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
