import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Minus, ShoppingCart, Trash2, Search, ScanBarcode, RotateCcw } from 'lucide-react';
import { useStore } from '@/context/StoreContext';
import { useAuth } from '@/context/AuthContext';
import { InventoryItem, CartItem, SalesRecord } from '@/types';
import { formatSAR } from '@/lib/currency';

type ReceiptData = {
  saleId: number;
  branchName: string;
  cashier: string;
  paymentMethod: 'cash' | 'card';
  issuedAt: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    discount: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountTotal: number;
  total: number;
};

export function POS() {
  const { currentBranch } = useStore();
  const { user } = useAuth();
  const [products, setProducts] = useState<InventoryItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [returnCart, setReturnCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [returnLoading, setReturnLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [openRecord, setOpenRecord] = useState<SalesRecord | null>(null);
  const [mode, setMode] = useState<'sale' | 'return'>('sale');
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);

  const normalizeLocalizedNumber = (value: string) =>
    value
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/٫/g, '.')
      .replace(/,/g, '')
      .trim();

  const printReceipt = (receipt: ReceiptData) => {
    const popup = window.open('', '_blank', 'width=360,height=720');
    if (!popup) return;

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rows = receipt.items
      .map(
        (item) => `
          <div class="item">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-meta">${item.quantity} x ${item.price.toFixed(2)}</div>
            ${item.discount > 0 ? `<div class="item-meta">Discount: -${item.discount.toFixed(2)}</div>` : ''}
            <div class="item-total">${item.lineTotal.toFixed(2)}</div>
          </div>
        `,
      )
      .join('');

    popup.document.write(`
      <html>
        <head>
          <title>Receipt #${receipt.saleId}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body {
              font-family: "Courier New", monospace;
              width: 72mm;
              margin: 0 auto;
              color: #000;
              font-size: 12px;
              line-height: 1.35;
            }
            .center { text-align: center; }
            .muted { color: #333; font-size: 11px; }
            .rule { border-top: 1px dashed #000; margin: 8px 0; }
            .item { padding: 6px 0; border-bottom: 1px dotted #bbb; }
            .item-name { font-weight: bold; }
            .item-meta { font-size: 11px; }
            .item-total { text-align: right; font-weight: bold; }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin: 2px 0;
            }
            .total {
              font-size: 16px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="center">
            <div style="font-size:16px;font-weight:bold;">${escapeHtml(receipt.branchName)}</div>
            <div class="muted">Sales Receipt</div>
          </div>
          <div class="rule"></div>
          <div class="row"><span>Bill #</span><span>${receipt.saleId}</span></div>
          <div class="row"><span>Date</span><span>${escapeHtml(new Date(receipt.issuedAt).toLocaleString())}</span></div>
          <div class="row"><span>Cashier</span><span>${escapeHtml(receipt.cashier)}</span></div>
          <div class="row"><span>Payment</span><span>${escapeHtml(receipt.paymentMethod.toUpperCase())}</span></div>
          <div class="rule"></div>
          ${rows}
          <div class="rule"></div>
          <div class="row"><span>Subtotal</span><span>${receipt.subtotal.toFixed(2)}</span></div>
          <div class="row"><span>Discount</span><span>-${receipt.discountTotal.toFixed(2)}</span></div>
          <div class="row total"><span>Total</span><span>${receipt.total.toFixed(2)}</span></div>
          <div class="rule"></div>
          <div class="center muted">Thank you</div>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const getTodayIsoDate = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
  };

  useEffect(() => {
    if (currentBranch) {
      fetchProducts();
      fetchOpenRecord();
    }
  }, [currentBranch]);

  const fetchProducts = async () => {
    if (!currentBranch) return;
    try {
      const [inventoryRes, productsRes] = await Promise.all([
        fetch(`/api/inventory?branchId=${currentBranch.id}`),
        fetch('/api/products'),
      ]);
      const inventoryData = await inventoryRes.json();
      const productsData = await productsRes.json();

      const inventoryByProductId = new Map<number, InventoryItem>();
      (inventoryData as InventoryItem[]).forEach((item) => {
        inventoryByProductId.set(item.product_id, item);
      });

      const merged = (productsData as Array<{ id: number; name: string; category: string; barcode: string | null; price: number; cost: number; sku: string | null }>)
        .map((product) => {
          const existing = inventoryByProductId.get(product.id);
          if (existing) {
            return existing;
          }
          return {
            id: 0,
            product_id: product.id,
            branch_id: currentBranch.id,
            branch_name: currentBranch.name,
            name: product.name,
            category: product.category,
            barcode: product.barcode,
            price: product.price,
            cost: product.cost,
            sku: product.sku,
            mfg_date: null,
            expiry_date: null,
            stock_level: 0,
            reorder_point: 10,
          } as InventoryItem;
        });

      setProducts(merged);
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const fetchOpenRecord = async () => {
    if (!currentBranch) return;
    try {
      const res = await fetch(`/api/sales-records/open?branchId=${currentBranch.id}`);
      const data = await res.json();
      setOpenRecord(data);
    } catch (error) {
      console.error('Failed to fetch open sales record', error);
    }
  };

  const addToCart = (product: InventoryItem) => {
    if (product.stock_level <= 0) {
      setSearchMessage(`${product.name} is out of stock.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.product_id);
      if (existing) {
        if (existing.quantity >= product.stock_level) {
          setSearchMessage(`Only ${product.stock_level} available for ${product.name}.`);
          return prev;
        }
        return prev.map((item) =>
          item.product_id === product.product_id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { ...product, quantity: 1, discount: 0 }];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const addToReturnCart = (product: InventoryItem) => {
    setReturnCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.product_id);
      if (existing) {
        return prev.map((item) =>
          item.product_id === product.product_id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { ...product, quantity: 1, discount: 0 }];
    });
  };

  const removeFromReturnCart = (productId: number) => {
    setReturnCart((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product_id === productId) {
          const maxQty = item.stock_level;
          const newQty = Math.min(maxQty, Math.max(1, item.quantity + delta));
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const setCartQuantity = (productId: number, value: string) => {
    const parsed = Number(normalizeLocalizedNumber(value));
    setCart((prev) =>
      prev.map((item) => {
        if (item.product_id !== productId) return item;
        if (!Number.isFinite(parsed)) return item;
        const nextQuantity = Math.min(item.stock_level, Math.max(1, Math.floor(parsed)));
        return { ...item, quantity: nextQuantity };
      })
    );
  };

  const setReturnCartQuantity = (productId: number, value: string) => {
    const parsed = Number(normalizeLocalizedNumber(value));
    setReturnCart((prev) =>
      prev.map((item) => {
        if (item.product_id !== productId) return item;
        if (!Number.isFinite(parsed)) return item;
        return { ...item, quantity: Math.max(1, Math.floor(parsed)) };
      })
    );
  };

  const setCartDiscount = (productId: number, value: string) => {
    const parsed = Number(normalizeLocalizedNumber(value));
    setCart((prev) =>
      prev.map((item) => {
        if (item.product_id !== productId) return item;
        if (!Number.isFinite(parsed)) return { ...item, discount: 0 };
        const maxDiscount = item.price * item.quantity;
        return { ...item, discount: Math.min(maxDiscount, Math.max(0, parsed)) };
      })
    );
  };

  const updateReturnQuantity = (productId: number, delta: number) => {
    setReturnCart((prev) =>
      prev.map((item) => {
        if (item.product_id === productId) {
          const newQty = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matchedProducts = useMemo(() => {
    if (!normalizedQuery) {
      return products
        .filter((product) => mode === 'return' || product.stock_level > 0)
        .slice(0, 8);
    }

    return products
      .filter((product) => {
        const sku = (product.sku || '').toLowerCase();
        const barcode = (product.barcode || '').toLowerCase();
        const name = product.name.toLowerCase();
        const category = product.category.toLowerCase();
        return barcode.includes(normalizedQuery) || sku.includes(normalizedQuery) || name.includes(normalizedQuery) || category.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aSku = (a.sku || '').toLowerCase();
        const bSku = (b.sku || '').toLowerCase();
        const aBarcode = (a.barcode || '').toLowerCase();
        const bBarcode = (b.barcode || '').toLowerCase();
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aExact = Number(aBarcode === normalizedQuery || aSku === normalizedQuery || aName === normalizedQuery);
        const bExact = Number(bBarcode === normalizedQuery || bSku === normalizedQuery || bName === normalizedQuery);
        if (aExact !== bExact) {
          return bExact - aExact;
        }
        const aStarts = Number(aBarcode.startsWith(normalizedQuery) || aSku.startsWith(normalizedQuery) || aName.startsWith(normalizedQuery));
        const bStarts = Number(bBarcode.startsWith(normalizedQuery) || bSku.startsWith(normalizedQuery) || bName.startsWith(normalizedQuery));
        if (aStarts !== bStarts) {
          return bStarts - aStarts;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20);
  }, [products, normalizedQuery, mode]);

  const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartDiscountTotal = cart.reduce((sum, item) => sum + item.discount, 0);
  const cartTotal = cartSubtotal - cartDiscountTotal;
  const returnTotal = returnCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalizedQuery) {
      setSearchMessage('Enter barcode/SKU or product name.');
      return;
    }

    const exactMatch = products.find((product) => {
      const barcode = (product.barcode || '').toLowerCase();
      const sku = (product.sku || '').toLowerCase();
      const name = product.name.toLowerCase();
      return barcode === normalizedQuery || sku === normalizedQuery || name === normalizedQuery;
    });

    if (!exactMatch) {
      setSearchMessage('No exact match found. Pick from the list below.');
      return;
    }

    if (mode === 'sale') {
      addToCart(exactMatch);
      setSearchMessage(`${exactMatch.name} added to order.`);
    } else {
      addToReturnCart(exactMatch);
      setSearchMessage(`${exactMatch.name} added to return list.`);
    }
    setQuery('');
  };

  const handleCheckout = async () => {
    if (!currentBranch || cart.length === 0) return;

    setLoading(true);
    try {
      const receiptDraft = {
        branchName: currentBranch.name,
        cashier: user?.username || 'Cashier',
        paymentMethod,
        issuedAt: new Date().toISOString(),
        items: cart.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          discount: item.discount,
          lineTotal: item.price * item.quantity - item.discount,
        })),
        subtotal: cartSubtotal,
        discountTotal: cartDiscountTotal,
        total: cartTotal,
      };

      const res = await fetch('/api/pos/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          items: cart.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
            discount: item.discount,
          })),
          payment_method: paymentMethod,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        printReceipt({
          saleId: Number(data.saleId),
          ...receiptDraft,
        });
        setCart([]);
        setQuery('');
        setSearchMessage('Sale completed successfully.');
        await Promise.all([fetchProducts(), fetchOpenRecord()]);
      } else {
        const data = await res.json();
        alert(data?.error || 'Checkout failed.');
      }
    } catch (error) {
      console.error('Checkout failed', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessReturn = async () => {
    if (!currentBranch || returnCart.length === 0) return;

    setReturnLoading(true);
    try {
      const res = await fetch('/api/pos/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          items: returnCart.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          payment_method: paymentMethod,
        }),
      });

      if (res.ok) {
        setReturnCart([]);
        setQuery('');
        setSearchMessage('Return processed successfully.');
        await Promise.all([fetchProducts(), fetchOpenRecord()]);
      } else {
        const data = await res.json();
        alert(data?.error || 'Return failed.');
      }
    } catch (error) {
      console.error('Return failed', error);
    } finally {
      setReturnLoading(false);
    }
  };

  const handleAddExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentBranch) return;
    const amount = Number(expenseAmount);
    if (!expenseCategory.trim() || !Number.isFinite(amount) || amount <= 0) {
      alert('Enter valid expense category and amount.');
      return;
    }

    setSavingExpense(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: currentBranch.id,
          type: 'expense',
          category: expenseCategory.trim(),
          amount,
          description: expenseDescription.trim(),
          date: getTodayIsoDate(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Failed to save expense.');
        return;
      }
      setExpenseCategory('');
      setExpenseAmount('');
      setExpenseDescription('');
      setIsExpenseOpen(false);
      alert('Expense saved.');
    } catch (error) {
      console.error('Failed to add expense', error);
      alert('Failed to save expense.');
    } finally {
      setSavingExpense(false);
    }
  };

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-6">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <div>
          <h2 className="font-serif text-3xl font-bold text-stone-900">Point of Sale</h2>
          <p className="text-stone-500 mt-1">Scan barcode/SKU or type product name for quick walk-in checkout.</p>
          <p className={`text-xs mt-2 ${openRecord ? 'text-emerald-700' : 'text-rose-700'}`}>
            {openRecord ? `Active Sales Record #${openRecord.id}` : 'No open sales record. Open one from Sales tab before checkout.'}
          </p>
          <div className="mt-3 inline-flex rounded-md border border-stone-200 bg-white p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === 'sale' ? 'default' : 'ghost'}
              onClick={() => {
                setMode('sale');
                setSearchMessage('');
              }}
            >
              Sale
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'return' ? 'default' : 'ghost'}
              onClick={() => {
                setMode('return');
                setSearchMessage('');
              }}
            >
              Return
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Quick Expense</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsExpenseOpen((prev) => !prev)}>
                {isExpenseOpen ? 'Close' : 'Add Expense'}
              </Button>
            </CardTitle>
          </CardHeader>
          {isExpenseOpen && (
            <CardContent>
              <form onSubmit={handleAddExpense} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <input
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  placeholder="Category (e.g. petty cash)"
                  className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
                <input
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="h-10 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                />
                <Button type="submit" disabled={savingExpense}>
                  {savingExpense ? 'Saving...' : 'Save Expense'}
                </Button>
              </form>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanBarcode className="h-5 w-5" />
              Product Lookup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (searchMessage) setSearchMessage('');
                  }}
                  placeholder={mode === 'sale' ? 'Scan barcode / enter SKU / type product name' : 'Scan/enter product to return'}
                  className="w-full h-11 rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm"
                />
              </div>
              <Button type="submit" className="h-11 px-5">Add</Button>
            </form>

            {searchMessage && (
              <p className="text-sm text-stone-600">{searchMessage}</p>
            )}

            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {matchedProducts.length === 0 ? (
                <p className="text-sm text-stone-500 py-4">No products found for this search.</p>
              ) : (
                matchedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3"
                  >
                    <div>
                      <p className="font-medium text-stone-900">{product.name}</p>
                      <p className="text-xs text-stone-500">
                        Barcode: {product.barcode || 'N/A'} | SKU: {product.sku || 'N/A'} | {product.category} | Stock: {product.stock_level}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-emerald-700">{formatSAR(product.price)}</span>
                      <Button
                        size="sm"
                        onClick={() => (mode === 'sale' ? addToCart(product) : addToReturnCart(product))}
                        disabled={mode === 'sale' && product.stock_level <= 0}
                      >
                        {mode === 'sale' ? 'Add' : 'Return'}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="w-full lg:w-96 flex flex-col h-full border-l border-stone-200 shadow-xl">
        <CardHeader className="border-b border-stone-100 bg-stone-50">
          <CardTitle className="flex items-center gap-2">
            {mode === 'sale' ? <ShoppingCart className="h-5 w-5" /> : <RotateCcw className="h-5 w-5" />}
            {mode === 'sale' ? 'Customer Order' : 'Return Items'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {(mode === 'sale' ? cart.length === 0 : returnCart.length === 0) ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-400">
              {mode === 'sale' ? <ShoppingCart className="h-12 w-12 mb-2 opacity-20" /> : <RotateCcw className="h-12 w-12 mb-2 opacity-20" />}
              <p>{mode === 'sale' ? 'No products in order yet.' : 'No products in return list.'}</p>
            </div>
          ) : (
            (mode === 'sale' ? cart : returnCart).map((item) => (
              <div
                key={item.product_id}
                className="flex items-center justify-between bg-white p-3 rounded-lg border border-stone-100 shadow-sm"
              >
                <div className="flex-1">
                  <p className="font-medium text-sm text-stone-900">{item.name}</p>
                  <p className="text-xs text-stone-500">
                    {formatSAR(item.price)} x {item.quantity}
                    {mode === 'sale' && item.discount > 0 ? ` | Discount ${formatSAR(item.discount)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    disabled={item.quantity <= 1}
                    onClick={() => (mode === 'sale' ? updateQuantity(item.product_id, -1) : updateReturnQuantity(item.product_id, -1))}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    min={1}
                    max={mode === 'sale' ? item.stock_level : undefined}
                    value={item.quantity}
                    onChange={(e) =>
                      mode === 'sale'
                        ? setCartQuantity(item.product_id, e.target.value)
                        : setReturnCartQuantity(item.product_id, e.target.value)
                    }
                    inputMode="numeric"
                    lang="en"
                    dir="ltr"
                    className="h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-center text-sm [font-variant-numeric:lining-nums_tabular-nums]"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    disabled={mode === 'sale' && item.quantity >= item.stock_level}
                    onClick={() => (mode === 'sale' ? updateQuantity(item.product_id, 1) : updateReturnQuantity(item.product_id, 1))}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  {mode === 'sale' && (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.discount}
                      onChange={(e) => setCartDiscount(item.product_id, e.target.value)}
                      inputMode="decimal"
                      lang="en"
                      dir="ltr"
                      className="h-8 w-24 rounded-md border border-stone-200 bg-white px-2 text-right text-sm [font-variant-numeric:lining-nums_tabular-nums]"
                      placeholder="Discount"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                    onClick={() => (mode === 'sale' ? removeFromCart(item.product_id) : removeFromReturnCart(item.product_id))}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
        <div className="p-4 border-t border-stone-100 bg-stone-50">
          <div className="mb-4">
            <p className="text-xs text-stone-500 uppercase mb-2">Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                onClick={() => setPaymentMethod('cash')}
              >
                Cash
              </Button>
              <Button
                type="button"
                variant={paymentMethod === 'card' ? 'default' : 'outline'}
                onClick={() => setPaymentMethod('card')}
              >
                Card
              </Button>
            </div>
          </div>
          {mode === 'sale' ? (
            <>
              <div className="flex justify-between items-center text-sm mb-1">
                <span className="text-stone-500">Subtotal</span>
                <span className="text-stone-900">{formatSAR(cartSubtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-sm mb-1">
                <span className="text-stone-500">Discount</span>
                <span className="text-stone-900">-{formatSAR(cartDiscountTotal)}</span>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-stone-500">Total</span>
                <span className="text-2xl font-bold text-stone-900">{formatSAR(cartTotal)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between items-center mb-4">
              <span className="text-stone-500">Return Total</span>
              <span className="text-2xl font-bold text-stone-900">{formatSAR(returnTotal)}</span>
            </div>
          )}
          {mode === 'sale' ? (
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12 text-lg"
              disabled={cart.length === 0 || loading || !openRecord}
              onClick={handleCheckout}
            >
              {loading ? 'Processing...' : 'Complete Sale'}
            </Button>
          ) : (
            <Button
              className="w-full bg-orange-700 hover:bg-orange-800 text-white h-12 text-lg"
              disabled={returnCart.length === 0 || returnLoading || !openRecord}
              onClick={handleProcessReturn}
            >
              {returnLoading ? 'Processing...' : 'Process Return'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
