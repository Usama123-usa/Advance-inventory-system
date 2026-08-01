import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut, ChevronDown, UserCircle, Store } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useStore } from '@/context/StoreContext';

export function Navbar({ onMenuClick }) {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { stores, currentStoreId, setCurrentStoreId, isAdmin } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-card/80 px-4 backdrop-blur-xl print:hidden sm:px-6">
      <button onClick={onMenuClick} className="rounded-md p-2 hover:bg-secondary lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      {isAdmin && stores.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-2.5 py-1.5 text-sm">
          <Store className="h-4 w-4 text-muted-foreground" />
          <select
            value={currentStoreId || ''}
            onChange={(e) => setCurrentStoreId(e.target.value)}
            className="bg-transparent text-sm font-medium outline-none"
          >
            {stores
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.is_main ? ' (Main)' : ''}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
              {user?.name?.[0]?.toUpperCase() || <UserCircle className="h-5 w-5" />}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight">{user?.name}</p>
              <p className="text-xs capitalize leading-tight text-muted-foreground">{user?.role?.replace('_', ' ')}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-44 animate-slide-up rounded-lg border border-border bg-card p-1 shadow-xl">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
