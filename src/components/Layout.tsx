import React, { useState } from 'react';
import { LayoutDashboard, Receipt, Package, Menu, X, Leaf, ShoppingCart, Truck, Store, Boxes, ClipboardList, BookOpenText, Wallet, Shuffle, Building2, Warehouse, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '@/context/StoreContext';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: 'dashboard' | 'sales' | 'pos' | 'transactions' | 'inventory' | 'products' | 'distributors' | 'purchases' | 'cash_in_hand' | 'warehouse_inventory' | 'warehouse_transfer' | 'warehouse_wholesale' | 'back_office';
  onTabChange: (tab: 'dashboard' | 'sales' | 'pos' | 'transactions' | 'inventory' | 'products' | 'distributors' | 'purchases' | 'cash_in_hand' | 'warehouse_inventory' | 'warehouse_transfer' | 'warehouse_wholesale' | 'back_office') => void;
  user?: { id: number; username: string; role: string };
  onLogout?: () => void;
}

export function Layout({ children, activeTab, onTabChange, user, onLogout }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { currentBranch, branches, setCurrentBranch } = useStore();
  const isMassageBranch = currentBranch?.branch_type === 'massage_center';

  const defaultNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sales', label: 'Sales Ledger', icon: BookOpenText },
    { id: 'pos', label: 'Point of Sale', icon: ShoppingCart },
    { id: 'transactions', label: 'Transactions', icon: Receipt },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'products', label: 'Products DB', icon: Boxes },
    { id: 'distributors', label: 'Distributors', icon: Truck },
    { id: 'purchases', label: 'Purchase Entry', icon: ClipboardList },
    { id: 'cash_in_hand', label: 'Cash In Hand', icon: Wallet },
    { id: 'warehouse_inventory', label: 'Warehouse Inventory', icon: Warehouse },
    { id: 'warehouse_transfer', label: 'Warehouse Transfer', icon: Shuffle },
    { id: 'warehouse_wholesale', label: 'Warehouse Wholesale', icon: Building2 },
    ...(user?.role === 'admin' ? [{ id: 'back_office', label: 'Back Office', icon: ShieldCheck }] : []),
  ] as const;
  const navItems = isMassageBranch
    ? [
      { id: 'dashboard', label: 'Massage Center', icon: Leaf },
      ...(user?.role === 'admin' ? [{ id: 'back_office', label: 'Back Office', icon: ShieldCheck }] : []),
    ] as const
    : defaultNavItems;

  return (
    <div className="min-h-screen bg-[#f5f5f0] font-sans text-stone-900">
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Leaf className="h-6 w-6 text-emerald-700" />
          <span className="font-serif text-xl font-semibold text-emerald-900">AyurLedger</span>
        </div>
        <div className="flex items-center gap-2">
          {user && onLogout && (
            <button
              onClick={onLogout}
              className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all hover:opacity-90"
              style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#b91c1c',
              }}
            >
              Sign out
            </button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <AnimatePresence>
          {(isSidebarOpen || window.innerWidth >= 1024) && (
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              className={`
                fixed inset-y-0 left-0 z-10 w-64 bg-white border-r border-stone-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen flex flex-col
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              `}
            >
              <div className="p-6 flex items-center gap-3 border-b border-stone-100">
                <div className="bg-emerald-100 p-2 rounded-full">
                  <Leaf className="h-6 w-6 text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-serif text-xl font-bold text-emerald-900">AyurLedger</h1>
                  <p className="text-xs text-stone-500 uppercase tracking-wider">Premium Insight</p>
                </div>
                {user && onLogout && (
                  <div className="text-right">
                    <p className="text-xs font-medium text-emerald-900 truncate max-w-28">{user.username}</p>
                    <button
                      onClick={onLogout}
                      className="mt-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-all hover:opacity-90"
                      style={{
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        color: '#b91c1c',
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>

              {/* Branch Selector */}
              <div className="p-4 border-b border-stone-100">
                <label className="text-xs font-medium text-stone-500 uppercase mb-2 block">Current Outlet</label>
                <div className="relative">
                  <select
                    value={currentBranch?.id || ''}
                    onChange={(e) => {
                      const branch = branches.find(b => b.id === Number(e.target.value));
                      if (branch) setCurrentBranch(branch);
                    }}
                    className="w-full appearance-none bg-stone-50 border border-stone-200 text-stone-900 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block w-full p-2.5 pr-8"
                  >
                    {branches.map(branch => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} {branch.branch_type === 'massage_center' ? '(Massage)' : branch.branch_type === 'warehouse' ? '(Warehouse)' : ''}
                      </option>
                    ))}
                  </select>
                  <Store className="absolute right-3 top-3 h-4 w-4 text-stone-400 pointer-events-none" />
                </div>
              </div>

              <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onTabChange(item.id);
                      setIsSidebarOpen(false);
                    }}
                    className={`
                      w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                      ${activeTab === item.id 
                        ? 'bg-emerald-50 text-emerald-900 shadow-sm ring-1 ring-emerald-200' 
                        : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'}
                    `}
                  >
                    <item.icon className={`h-5 w-5 ${activeTab === item.id ? 'text-emerald-700' : 'text-stone-400'}`} />
                    {item.label}
                  </button>
                ))}
              </nav>

              <div className="w-full p-6 border-t border-stone-100">
                <div className="bg-stone-50 rounded-xl p-4">
                  <p className="text-xs font-medium text-stone-500 mb-1">Store Status</p>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-sm font-semibold text-stone-900">
                      {isMassageBranch ? 'Massage Outlet Active' : 'Operational'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto h-screen">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
