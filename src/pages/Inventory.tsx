import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, AlertCircle, Search } from 'lucide-react';
import { useStore } from '@/context/StoreContext';
import { InventoryItem } from '@/types';
import { formatSAR } from '@/lib/currency';

type ProductLookup = {
  id: number;
  name: string;
  category: string;
  barcode: string | null;
  sku: string | null;
  cost: number;
  price: number;
};

export function Inventory() {
  const { currentBranch } = useStore();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [productMatches, setProductMatches] = useState<ProductLookup[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductLookup | null>(null);
  const [stockLevel, setStockLevel] = useState('');
  const [reorderPoint, setReorderPoint] = useState('10');
  const [mfgDate, setMfgDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  useEffect(() => {
    if (currentBranch) {
      fetchInventory();
    }
  }, [currentBranch]);

  useEffect(() => {
    if (!isFormOpen) return;
    const timer = setTimeout(() => {
      fetchProducts(productQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [productQuery, isFormOpen]);

  const fetchInventory = async () => {
    try {
      const res = await fetch(`/api/inventory?branchId=${currentBranch?.id}`);
      const data = await res.json();
      setItems(data);
    } catch (error) {
      console.error('Failed to fetch inventory', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async (query: string) => {
    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set('q', query.trim());
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/products${suffix}`);
      const data = await res.json();
      setProductMatches(data);
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const resetAddStockForm = () => {
    setProductQuery('');
    setProductMatches([]);
    setSelectedProduct(null);
    setStockLevel('');
    setReorderPoint('10');
    setMfgDate('');
    setExpiryDate('');
  };

  const handleAddStock = async () => {
    if (!currentBranch || !selectedProduct) {
      alert('Select a product from Product DB first.');
      return;
    }

    const parsedStock = Number(stockLevel);
    const parsedReorderPoint = Number(reorderPoint);
    if (
      !Number.isInteger(parsedStock) ||
      parsedStock <= 0 ||
      !Number.isFinite(parsedReorderPoint) ||
      parsedReorderPoint < 0
    ) {
      alert('Enter valid stock and reorder values.');
      return;
    }
    if (mfgDate && expiryDate && expiryDate < mfgDate) {
      alert('Expiry date cannot be before manufacturing date.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/inventory/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          product_id: selectedProduct.id,
          quantity: parsedStock,
          reorder_point: parsedReorderPoint,
          mfg_date: mfgDate || null,
          expiry_date: expiryDate || null,
        }),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        if (res.status === 404 || raw.includes('<!doctype html>')) {
          alert('Add-stock API route not found. Restart backend with npm run dev and try again.');
          return;
        }
        alert(data?.error || `Failed to add stock (HTTP ${res.status}).`);
        return;
      }
      await fetchInventory();
      setIsFormOpen(false);
      resetAddStockForm();
    } catch (error) {
      console.error('Failed to add stock', error);
      alert('Failed to add stock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Inventory</h2>
          <p className="text-stone-500 mt-1">Stock sheet for {currentBranch?.name}</p>
        </div>
        <Button
          onClick={() => {
            setIsFormOpen((prev) => !prev);
            if (isFormOpen) {
              resetAddStockForm();
            } else {
              fetchProducts('');
            }
          }}
          className="bg-stone-900 text-white"
        >
          <Plus className="mr-2 h-4 w-4" /> Add Stock
        </Button>
      </div>

      {isFormOpen && (
        <Card className="border-stone-300 bg-stone-50">
          <CardContent className="pt-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-stone-500 uppercase">Search Product DB (Name / SKU / Barcode)</label>
              <div className="relative mt-1">
                <Search className="h-4 w-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Type name, SKU, or barcode"
                  className="w-full h-10 rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm"
                />
              </div>
            </div>

            {selectedProduct ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="font-semibold text-emerald-900">{selectedProduct.name}</p>
                <p className="text-emerald-800 text-xs">
                  Barcode: {selectedProduct.barcode || 'N/A'} | SKU: {selectedProduct.sku || 'N/A'} | {selectedProduct.category} | Cost: {formatSAR(selectedProduct.cost)} | Price: {formatSAR(selectedProduct.price)}
                </p>
                <button
                  type="button"
                  className="text-xs text-emerald-900 underline mt-1"
                  onClick={() => setSelectedProduct(null)}
                >
                  Change product
                </button>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-stone-200 bg-white">
                {productMatches.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-stone-500">No products found in Product DB.</p>
                ) : (
                  productMatches.slice(0, 20).map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => setSelectedProduct(product)}
                      className="w-full border-b border-stone-100 px-3 py-2 text-left hover:bg-stone-50"
                    >
                      <p className="text-sm font-medium text-stone-900">{product.name}</p>
                      <p className="text-xs text-stone-500">Barcode: {product.barcode || 'N/A'} | SKU: {product.sku || 'N/A'} | {product.category}</p>
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase">Add Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={stockLevel}
                  onChange={(e) => setStockLevel(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase">Reorder Point</label>
                <input
                  type="number"
                  min={0}
                  value={reorderPoint}
                  onChange={(e) => setReorderPoint(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                  placeholder="10"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase">Manufacturing Date</label>
                <input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase">Expiry Date</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button type="button" onClick={handleAddStock} disabled={saving || !selectedProduct}>
                  {saving ? 'Saving...' : 'Save Stock'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsFormOpen(false);
                    resetAddStockForm();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-stone-300">
        <CardContent className="p-0">
          {items.some((item) => {
            if (!item.expiry_date) return false;
            const expiry = new Date(item.expiry_date);
            const now = new Date();
            const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return days >= 0 && days <= 30;
          }) && (
            <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Expiry Alert: One or more products will expire within 30 days.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Barcode</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">SKU</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Item Name</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Category</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">MFG Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Expiry Date</th>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">Stock</th>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">Reorder At</th>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">Cost</th>
                  <th className="border border-stone-300 px-3 py-2 text-right font-semibold">Price</th>
                  <th className="border border-stone-300 px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const isLow = item.stock_level <= item.reorder_point;
                  const expiryDays = item.expiry_date
                    ? Math.ceil((new Date(item.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  const isExpiringSoon = expiryDays !== null && expiryDays >= 0 && expiryDays <= 30;
                  const isExpired = expiryDays !== null && expiryDays < 0;
                  return (
                    <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                      <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{item.barcode || '-'}</td>
                      <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{item.sku || '-'}</td>
                      <td className="border border-stone-300 px-3 py-2">{item.name}</td>
                      <td className="border border-stone-300 px-3 py-2">{item.category}</td>
                      <td className="border border-stone-300 px-3 py-2">{item.mfg_date || '-'}</td>
                      <td className="border border-stone-300 px-3 py-2">{item.expiry_date || '-'}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right font-medium">{item.stock_level}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{item.reorder_point}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(item.cost)}</td>
                      <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(item.price)}</td>
                      <td className="border border-stone-300 px-3 py-2">
                        {isExpired ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
                            <AlertCircle className="h-3 w-3" />
                            Expired
                          </span>
                        ) : isExpiringSoon ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                            <AlertCircle className="h-3 w-3" />
                            Expiring Soon
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700">
                            <AlertCircle className="h-3 w-3" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-700">In Stock</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No inventory items found.
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
