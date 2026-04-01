import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Product } from '@/types';
import { formatSAR } from '@/lib/currency';

type ProductForm = {
  barcode: string;
  name: string;
  category: string;
  sku: string;
  cost: string;
  price: string;
};

const initialForm: ProductForm = {
  barcode: '',
  name: '',
  category: '',
  sku: '',
  cost: '',
  price: '',
};

export function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [formData, setFormData] = useState<ProductForm>(initialForm);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async (search?: string) => {
    try {
      const params = new URLSearchParams();
      if (search && search.trim()) {
        params.set('q', search.trim());
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/products${suffix}`);
      const data = await res.json();
      setProducts(data);
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      barcode: formData.barcode.trim(),
      name: formData.name.trim(),
      category: formData.category.trim(),
      sku: formData.sku.trim(),
      cost: Number(formData.cost),
      price: Number(formData.price),
    };

    if (
      !payload.name ||
      !payload.category ||
      !Number.isFinite(payload.cost) ||
      payload.cost < 0 ||
      !Number.isFinite(payload.price) ||
      payload.price < 0
    ) {
      alert('Enter valid product details.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to save product.');
        return;
      }
      setFormData(initialForm);
      setIsFormOpen(false);
      await fetchProducts(query);
    } catch (error) {
      console.error('Failed to save product', error);
      alert('Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  const parseCsvLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const handleImportCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length < 2) {
        alert('CSV has no data rows.');
        return;
      }

      const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const idx = {
        barcode: headers.indexOf('barcode'),
        name: headers.indexOf('product_name'),
        sku: headers.indexOf('sku_number'),
        category: headers.indexOf('category'),
        cost: headers.indexOf('cost'),
        price: headers.indexOf('selling_price'),
      };

      if (Object.values(idx).some((value) => value < 0)) {
        alert('CSV headers must be: barcode,product_name,sku_number,category,cost,selling_price');
        return;
      }

      const rows = lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        return {
          barcode: cols[idx.barcode] || '',
          name: cols[idx.name] || '',
          sku: cols[idx.sku] || '',
          category: cols[idx.category] || '',
          cost: Number(cols[idx.cost] || 0),
          price: Number(cols[idx.price] || 0),
        };
      });

      const res = await fetch('/api/products/bulk-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Import failed.');
        return;
      }
      alert(`Import complete. Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped}`);
      await fetchProducts(query);
    } catch (error) {
      console.error('CSV import failed', error);
      alert('CSV import failed.');
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = () => {
    const header = 'barcode,product_name,sku_number,category,cost,selling_price';
    const rows = products.map((p) => [
      p.barcode || '',
      p.name,
      p.sku || '',
      p.category,
      p.cost.toString(),
      p.price.toString(),
    ]);
    const csv = [header, ...rows.map((r) => r.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products_db_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const csv = 'barcode,product_name,sku_number,category,cost,selling_price\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products_db_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Products</h2>
          <p className="text-stone-500 mt-1">Master product database.</p>
        </div>
        <Button onClick={() => setIsFormOpen((prev) => !prev)} className="bg-stone-900 text-white">
          <Plus className="mr-2 h-4 w-4" /> Add Product
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by barcode, name, category, or SKU"
              className="w-full h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
            />
            <Button variant="outline" onClick={() => fetchProducts(query)}>Search</Button>
            <Button variant="ghost" onClick={() => { setQuery(''); fetchProducts(); }}>Clear</Button>
            <Button type="button" variant="outline" onClick={downloadTemplate}>Download Template</Button>
            <Button type="button" variant="outline" onClick={exportCsv}>Export CSV</Button>
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleImportCsv(file);
                  }
                  e.currentTarget.value = '';
                }}
              />
              <span className="inline-flex items-center justify-center rounded-md border border-stone-200 bg-white px-3 py-2 text-sm cursor-pointer hover:bg-stone-50">
                {importing ? 'Importing...' : 'Import CSV (Excel)'}
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {isFormOpen && (
        <Card className="bg-stone-50 border-stone-200">
          <CardHeader>
            <CardTitle>New Product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <input
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              placeholder="Barcode"
              className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
            />
            <input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Product name"
              className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="Category"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                placeholder="SKU"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.cost}
                onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                placeholder="Cost"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="Price"
                className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              />
              <div className="md:col-span-5 flex gap-2 justify-end">
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Product'}</Button>
                <Button type="button" variant="outline" onClick={() => { setIsFormOpen(false); setFormData(initialForm); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Product List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border border-stone-300 px-3 py-2 text-left">Barcode</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Product Name</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">SKU</th>
                  <th className="border border-stone-300 px-3 py-2 text-left">Category</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Cost</th>
                  <th className="border border-stone-300 px-3 py-2 text-right">Selling Price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="odd:bg-white even:bg-stone-50">
                    <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{product.barcode || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{product.name}</td>
                    <td className="border border-stone-300 px-3 py-2 font-mono text-xs">{product.sku || '-'}</td>
                    <td className="border border-stone-300 px-3 py-2">{product.category}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(product.cost)}</td>
                    <td className="border border-stone-300 px-3 py-2 text-right">{formatSAR(product.price)}</td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border border-stone-300 px-3 py-8 text-center text-stone-500">
                      No products found.
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
