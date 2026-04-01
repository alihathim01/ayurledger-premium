import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatSAR } from '@/lib/currency';
import { Search } from 'lucide-react';

type Branch = { id: number; name: string; branch_type?: string | null };
type WarehouseItem = {
  id: number;
  product_id: number;
  name: string;
  category: string;
  barcode: string | null;
  sku: string | null;
  stock_level: number;
  reorder_point: number;
  cost: number;
  price: number;
  mfg_date: string | null;
  expiry_date: string | null;
};
type Product = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost: number;
  price: number;
};

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};

const addDays = (dateStr: string, days: number) => {
  const base = new Date(`${dateStr}T00:00:00`);
  base.setDate(base.getDate() + days);
  const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};

const isWarehouseBranch = (branch: Branch & { branch_type?: string | null }) => {
  if (typeof branch.branch_type === 'string' && branch.branch_type.toLowerCase() === 'warehouse') {
    return true;
  }
  return /warehouse/i.test(branch.name || '');
};

const uniqueBranches = (branches: Branch[]) => {
  const seen = new Set<number>();
  const result: Branch[] = [];
  for (const branch of branches) {
    if (Number.isInteger(branch.id) && !seen.has(branch.id)) {
      seen.add(branch.id);
      result.push(branch);
    }
  }
  return result;
};

const pickWarehouseBranch = (branches: Branch[]) => {
  const byType = branches.find((b) => (b.branch_type || '').toLowerCase() === 'warehouse');
  if (byType) return byType;
  const byName = branches.find((b) => /warehouse/i.test(b.name || ''));
  if (byName) return byName;
  return null;
};

export function WarehouseInventory() {
  const [warehouse, setWarehouse] = useState<Branch | null>(null);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [form, setForm] = useState({
    barcode: '',
    quantity: '1',
    cost: '',
    selling_price: '',
    mfg_date: getTodayIsoDate(),
    expiry_days: '30',
  });

  useEffect(() => {
    fetchInitial();
  }, []);

  useEffect(() => {
    if (warehouse?.id) fetchWarehouseInventory(warehouse.id);
  }, [warehouse?.id]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => {
        const barcode = (p.barcode || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        const name = p.name.toLowerCase();
        return barcode.includes(q) || sku.includes(q) || name.includes(q);
      })
      .slice(0, 20);
  }, [products, search]);

  const resolveWarehouseBranch = async () => {
    const [typedRes, allRes] = await Promise.all([
      fetch('/api/branches?type=warehouse').catch(() => null),
      fetch('/api/branches').catch(() => null),
    ]);
    const typed = typedRes && typedRes.ok ? await typedRes.json().catch(() => []) : [];
    const all = allRes && allRes.ok ? await allRes.json().catch(() => []) : [];
    const candidates = uniqueBranches([
      ...(Array.isArray(typed) ? (typed as Branch[]) : []),
      ...(Array.isArray(all) ? (all as Branch[]) : []),
    ]);
    return pickWarehouseBranch(candidates);
  };

  const fetchInitial = async () => {
    try {
      const [allBranchesRes, typedWarehousesRes, pRes] = await Promise.all([
        fetch('/api/branches'),
        fetch('/api/branches?type=warehouse'),
        fetch('/api/products'),
      ]);
      const allBranches = await allBranchesRes.json();
      const typedWarehouses = await typedWarehousesRes.json().catch(() => []);
      const p = await pRes.json();
      setProducts(p);

      const candidates = uniqueBranches([
        ...(Array.isArray(typedWarehouses) ? (typedWarehouses as Branch[]) : []),
        ...(Array.isArray(allBranches) ? (allBranches as Branch[]) : []),
      ]);
      const strictWarehouse = pickWarehouseBranch(candidates);

      const metadataWarehouses = candidates.filter(isWarehouseBranch);
      const orderedCandidates = [...metadataWarehouses, ...candidates.filter((c) => !isWarehouseBranch(c))];

      let selectedWarehouse: Branch | null = strictWarehouse;
      for (const candidate of orderedCandidates) {
        if (selectedWarehouse) break;
        try {
          const probeRes = await fetch(`/api/warehouse/inventory?warehouse_branch_id=${candidate.id}`);
          if (probeRes.ok) {
            selectedWarehouse = candidate;
            break;
          }
        } catch {
          // Ignore probe errors and continue trying other candidates.
        }
      }

      if (selectedWarehouse) {
        setWarehouse(selectedWarehouse);
        fetchWarehouseInventory(selectedWarehouse.id);
      } else {
        setWarehouse(null);
      }
    } catch (error) {
      console.error('Failed to load warehouse inventory setup', error);
    }
  };

  const fetchWarehouseInventory = async (warehouseId: number) => {
    try {
      const res = await fetch(`/api/warehouse/inventory?warehouse_branch_id=${warehouseId}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
        return;
      }

      const fallbackRes = await fetch(`/api/inventory?branchId=${warehouseId}`);
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        setItems((Array.isArray(fallbackData) ? fallbackData : []).filter((row: WarehouseItem) => Number(row.stock_level) > 0));
      } else {
        setItems([]);
      }
    } catch (error) {
      console.error('Failed to load warehouse inventory', error);
      setItems([]);
    }
  };

  const clearForm = () => {
    setSelectedProduct(null);
    setSearch('');
    setForm({
      barcode: '',
      quantity: '1',
      cost: '',
      selling_price: '',
      mfg_date: getTodayIsoDate(),
      expiry_days: '30',
    });
  };

  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    setSearch(p.name);
    setForm((prev) => ({
      ...prev,
      barcode: p.barcode || '',
      cost: String(p.cost ?? ''),
      selling_price: String(p.price ?? ''),
    }));
  };

  const addStock = async () => {
    const resolvedWarehouse = await resolveWarehouseBranch();
    if (!resolvedWarehouse) {
      alert('No warehouse branch found. Stock was not added.');
      return;
    }
    if (!isWarehouseBranch(resolvedWarehouse)) {
      alert('Selected branch is not a warehouse. Stock was not added.');
      return;
    }
    const quantity = Number(form.quantity);
    const cost = Number(form.cost);
    const sellingPrice = Number(form.selling_price);
    const expiryDays = Number(form.expiry_days);
    const productName = search.trim();
    const barcode = form.barcode.trim();

    if (
      !productName ||
      !Number.isInteger(quantity) || quantity <= 0 ||
      !Number.isFinite(cost) || cost < 0 ||
      !Number.isFinite(sellingPrice) || sellingPrice < 0 ||
      !Number.isInteger(expiryDays) || expiryDays < 0 ||
      !form.mfg_date
    ) {
      alert('Enter valid product, quantity, pricing, MFG date, and expiry days.');
      return;
    }

    const expiryDate = addDays(form.mfg_date, expiryDays);

    setSaving(true);
    try {
      const res = await fetch('/api/warehouse/inventory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_branch_id: resolvedWarehouse.id,
          barcode,
          name: productName,
          quantity,
          cost,
          price: sellingPrice,
          mfg_date: form.mfg_date,
          expiry_date: expiryDate,
        }),
      });
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        if (res.status === 404) {
          // Legacy compatibility path for older backend versions.
          const productLookupQuery = barcode || productName;
          const pRes = await fetch(`/api/products?q=${encodeURIComponent(productLookupQuery)}`);
          const pData = await pRes.json().catch(() => []);
          let product = (pData as Product[]).find((p) =>
            (barcode && (p.barcode || '').toLowerCase() === barcode.toLowerCase()) ||
            p.name.toLowerCase() === productName.toLowerCase()
          );

          if (!product) {
            const createRes = await fetch('/api/products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: productName,
                category: 'Warehouse',
                barcode: barcode || null,
                price: sellingPrice,
                cost,
                sku: selectedProduct?.sku || null,
              }),
            });
            const createData = await createRes.json().catch(() => null);
            if (!createRes.ok) {
              alert(createData?.error || `Failed to save product (${createRes.status}).`);
              return;
            }
            const createdId = Number(createData?.id);
            if (!Number.isInteger(createdId) || createdId <= 0) {
              alert('Product was created but no product id was returned.');
              return;
            }
            product = {
              id: createdId,
              name: productName,
              sku: selectedProduct?.sku || null,
              barcode: barcode || null,
              cost,
              price: sellingPrice,
            };
          }

          const stockRes = await fetch('/api/inventory/stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              branch_id: resolvedWarehouse.id,
              product_id: product.id,
              quantity,
              reorder_point: 10,
              mfg_date: form.mfg_date,
              expiry_date: expiryDate,
            }),
          });
          const stockData = await stockRes.json().catch(() => null);
          if (!stockRes.ok) {
            alert(stockData?.error || 'Failed to add warehouse stock.');
            return;
          }

          await Promise.all([fetchWarehouseInventory(resolvedWarehouse.id), fetchInitial()]);
          clearForm();
          return;
        }
        const rawText = responseText?.trim();
        const fallback = rawText && rawText.length < 300 ? rawText : `Request failed (${res.status})`;
        alert(data?.error || fallback || 'Failed to add warehouse stock.');
        return;
      }

      await Promise.all([fetchWarehouseInventory(resolvedWarehouse.id), fetchInitial()]);
      clearForm();
    } catch (error) {
      console.error('Failed to add warehouse stock', error);
      alert('Failed to add warehouse stock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-bold text-stone-900">Warehouse Inventory</h2>
        <p className="text-stone-500 mt-1">
          Main warehouse stock: {warehouse?.name || 'No warehouse found'}
        </p>
        {!warehouse && (
          <p className="text-xs text-red-600 mt-1">Warehouse branch not detected. Please restart the server so latest warehouse APIs and branch setup load.</p>
        )}
      </div>

      <Card className="bg-stone-50 border-stone-200">
        <CardHeader>
          <CardTitle>Add / Refill Warehouse Stock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-stone-500 uppercase">Product Name Search</label>
            <div className="relative mt-1">
              <Search className="h-4 w-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name / SKU / barcode"
                className="w-full h-10 rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm"
              />
            </div>
            {filteredProducts.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-stone-200 bg-white">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProduct(p)}
                    className="w-full text-left px-3 py-2 border-b border-stone-100 hover:bg-stone-50"
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-stone-500">Barcode: {p.barcode || '-'} | SKU: {p.sku || '-'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-stone-500 uppercase">Barcode</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Quantity</label>
              <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Cost</label>
              <input type="number" min={0} step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Wholesale Selling Price</label>
              <input type="number" min={0} step="0.01" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">MFG Date</label>
              <input type="date" value={form.mfg_date} onChange={(e) => setForm({ ...form, mfg_date: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase">Expiry In Days</label>
              <input type="number" min={0} value={form.expiry_days} onChange={(e) => setForm({ ...form, expiry_days: e.target.value })} className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2 flex items-end gap-2">
              <Button type="button" onClick={addStock} disabled={saving || !warehouse}>
                {saving ? 'Saving...' : 'Add Stock'}
              </Button>
              <Button type="button" variant="outline" onClick={clearForm}>Clear</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Warehouse Stock</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Barcode</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">SKU</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Product</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">MFG</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Expiry</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Stock</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Cost</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Wholesale Price</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={`${item.product_id}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                    <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{item.barcode || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{item.sku || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{item.name}</td>
                    <td className="border border-stone-300 px-3 py-2">{item.mfg_date || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{item.expiry_date || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{item.stock_level}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(item.cost)}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(item.price)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No inventory found in warehouse.
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
