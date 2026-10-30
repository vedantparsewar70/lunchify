'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRole } from '@/types';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: UserRole;
  parentId?: string;
  students?: Array<{
    id: string;
    name: string;
    grade: string;
    division: string;
    rollNo: string;
    studentId: string;
    allergies?: string | null;
    isVegetarian: boolean;
    profilePhoto?: string | null;
  }>;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
  setAuthUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  refreshUser: async () => {},
  setAuthUser: () => {},
  logout: async () => {},
});

let inFlightRefreshPromise: Promise<void> | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const refreshUser = async () => {
    if (inFlightRefreshPromise) {
      return inFlightRefreshPromise;
    }

    inFlightRefreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user || null);
        } else if (res.status === 401 || res.status === 403) {
          // Only an explicit "not signed in" ends the session in the UI.
          setUser(null);
        }
        // A temporary server or network problem (5xx) keeps the current user, so a parent is not
        // thrown back to the login page in the middle of checkout.
      } catch {
        // Network error: keep the current state.
      } finally {
        setIsLoading(false);
        inFlightRefreshPromise = null;
      }
    })();

    return inFlightRefreshPromise;
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const setAuthUser = (newUser: AuthUser | null) => {
    setUser(newUser);
    setIsLoading(false);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.push('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshUser, setAuthUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
