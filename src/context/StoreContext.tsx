import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Branch } from '../types';
import { useAuth } from './AuthContext';

interface StoreContextType {
  currentBranch: Branch | null;
  branches: Branch[];
  setCurrentBranch: (branch: Branch) => void;
  refreshBranches: () => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/branches');
      const data = await res.json() as Branch[];
      setBranches(data);
      if (data.length > 0 && !currentBranch) {
        setCurrentBranch(data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch branches', error);
    }
  };

  useEffect(() => {
    if (!user) {
      setBranches([]);
      setCurrentBranch(null);
      return;
    }
    fetchBranches();
  }, [user?.id, user?.role]);

  return (
    <StoreContext.Provider value={{ currentBranch, branches, setCurrentBranch, refreshBranches: fetchBranches }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
