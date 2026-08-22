import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { StoreProvider } from '@/context/StoreContext';
import { ProtectedRoute, RoleGate } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const Login = lazyWithRetry(() => import('@/pages/Login'));
const Dashboard = lazyWithRetry(() => import('@/pages/Dashboard'));
const Categories = lazyWithRetry(() => import('@/pages/Categories'));
const Products = lazyWithRetry(() => import('@/pages/Products'));
const Inventory = lazyWithRetry(() => import('@/pages/Inventory'));
const Customers = lazyWithRetry(() => import('@/pages/Customers'));
const POS = lazyWithRetry(() => import('@/pages/POS'));
const Sales = lazyWithRetry(() => import('@/pages/Sales'));
const Invoice = lazyWithRetry(() => import('@/pages/Invoice'));
const Reports = lazyWithRetry(() => import('@/pages/Reports'));
const Settings = lazyWithRetry(() => import('@/pages/Settings'));
const Expenses = lazyWithRetry(() => import('@/pages/Expenses'));
const PendingPayments = lazyWithRetry(() => import('@/pages/PendingPayments'));
const StoreManagement = lazyWithRetry(() => import('@/pages/StoreManagement'));
const UserManagement = lazyWithRetry(() => import('@/pages/UserManagement'));
const NotFound = lazyWithRetry(() => import('@/pages/NotFound'));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <StoreProvider>
            <SettingsProvider>
              <Toaster
                position="top-right"
                toastOptions={{
                  className: 'text-sm',
                  style: { borderRadius: '10px' },
                }}
              />
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route
                    element={
                      <ProtectedRoute>
                        <AppLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/pos" element={<POS />} />
                    <Route path="/sales" element={<Sales />} />
                    <Route path="/categories" element={<Categories />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/expenses" element={<Expenses />} />
                    <Route path="/pending-payments" element={<PendingPayments />} />
                    <Route
                      path="/reports"
                      element={
                        <RoleGate roles={['admin']}>
                          <Reports />
                        </RoleGate>
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <RoleGate roles={['admin']}>
                          <Settings />
                        </RoleGate>
                      }
                    />
                    <Route
                      path="/store-management"
                      element={
                        <RoleGate roles={['admin']}>
                          <StoreManagement />
                        </RoleGate>
                      }
                    />
                    <Route
                      path="/user-management"
                      element={
                        <RoleGate roles={['admin']}>
                          <UserManagement />
                        </RoleGate>
                      }
                    />
                    <Route path="/invoice/:id" element={<Invoice />} />
                  </Route>

                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </SettingsProvider>
          </StoreProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
