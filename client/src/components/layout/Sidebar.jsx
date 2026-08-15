import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Tags,
  Package,
  Boxes,
  Users,
  ShoppingCart,
  Receipt,
  BarChart3,
  Settings,
  Store,
  Wallet,
  Wallet2,
  Building2,
  UserCog,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/pos', label: 'Point of Sale', icon: ShoppingCart, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/sales', label: 'Sales', icon: Receipt, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/products', label: 'Products', icon: Package, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/categories', label: 'Categories', icon: Tags, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/customers', label: 'Customers', icon: Users, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/pending-payments', label: 'Pending Payments', icon: Wallet2, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/store-management', label: 'Store Management', icon: Building2, roles: ['admin'] },
  { to: '/user-management', label: 'User Management', icon: UserCog, roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
];

export function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(user?.role));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform print:hidden lg:sticky lg:inset-y-auto lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-5">
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/30">
              <Store className="h-[18px] w-[18px]" />
            </div>
            <span>InventoryPro</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-sidebar-muted hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/5 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25'
                    : 'text-sidebar-muted hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/5'
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-4 text-xs text-sidebar-muted">
          Premium Inventory & POS &copy; {new Date().getFullYear()}
        </div>
      </aside>
    </>
  );
}
