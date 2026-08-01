import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Tags,
  Package,
  Boxes,
  Users,
  ShoppingCart,
  BarChart3,
  Settings,
  Store,
  Wallet,
  Wallet2,
  Building2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/pos', label: 'Point of Sale', icon: ShoppingCart, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/products', label: 'Products', icon: Package, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/categories', label: 'Categories', icon: Tags, roles: ['admin', 'staff'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/customers', label: 'Customers', icon: Users, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/pending-payments', label: 'Pending Payments', icon: Wallet2, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'staff', 'store_manager'] },
  { to: '/store-management', label: 'Store Management', icon: Building2, roles: ['admin'] },
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
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform print:hidden lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-5">
          <div className="flex items-center gap-2 font-bold text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
              <Store className="h-[18px] w-[18px]" />
            </div>
            <span>InventoryPro</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          Premium Inventory & POS &copy; {new Date().getFullYear()}
        </div>
      </aside>
    </>
  );
}
