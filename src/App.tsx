/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Inventory } from './pages/Inventory';
import { POS } from './pages/POS';
import { Sales } from './pages/Sales';
import { Distributors } from './pages/Distributors';
import { Products } from './pages/Products';
import { Purchases } from './pages/Purchases';
import { CashInHand } from './pages/CashInHand';
import { WarehouseTransfer } from './pages/WarehouseTransfer';
import { WarehouseWholesale } from './pages/WarehouseWholesale';
import { WarehouseInventory } from './pages/WarehouseInventory';
import { MassageCenter } from './pages/MassageCenter';
import { BackOffice } from './pages/BackOffice';
import { LoginPage } from './pages/LoginPage';
import { StoreProvider } from './context/StoreContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useStore } from './context/StoreContext';

type TabId =
  | 'dashboard'
  | 'sales'
  | 'pos'
  | 'transactions'
  | 'inventory'
  | 'products'
  | 'distributors'
  | 'purchases'
  | 'cash_in_hand'
  | 'warehouse_inventory'
  | 'warehouse_transfer'
  | 'warehouse_wholesale'
  | 'back_office';

function AppContent() {
  const { user, logout, isLoading } = useAuth();
  const { currentBranch } = useStore();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const isMassageBranch = currentBranch?.branch_type === 'massage_center';

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a1a0f]">
        <div className="h-8 w-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      user={user}
      onLogout={logout}
    >
      {activeTab === 'back_office' && user.role === 'admin' && <BackOffice />}
      {activeTab !== 'back_office' && isMassageBranch && <MassageCenter />}
      {activeTab !== 'back_office' && !isMassageBranch && (
        <>
      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'sales' && <Sales />}
      {activeTab === 'pos' && <POS />}
      {activeTab === 'transactions' && <Transactions />}
      {activeTab === 'inventory' && <Inventory />}
      {activeTab === 'products' && <Products />}
      {activeTab === 'distributors' && <Distributors />}
      {activeTab === 'purchases' && <Purchases />}
      {activeTab === 'cash_in_hand' && <CashInHand />}
      {activeTab === 'warehouse_inventory' && <WarehouseInventory />}
      {activeTab === 'warehouse_transfer' && <WarehouseTransfer />}
      {activeTab === 'warehouse_wholesale' && <WarehouseWholesale />}
        </>
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <AppContent />
      </StoreProvider>
    </AuthProvider>
  );
}
