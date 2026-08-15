import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// Editable input + dropdown of saved options, backed by a user-built,
// persisted option list (tile_field_options). Typing a new value and
// clicking Add saves it into the list; opening the dropdown shows every
// saved value — click one to fill the field, click its × to delete it.
// The dropdown panel is portaled to <body> (rather than positioned inline)
// because this field lives inside a scrollable Dialog — an inline absolute
// panel would get clipped by the dialog's own overflow.
export function TileOptionField({ label, type = 'text', value, onChange, options, onAdd, onDelete, placeholder }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return;
    const r = wrapperRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });

    // The panel's position is computed once, on open — rather than tracking
    // every scroll/resize, just close it if the layout moves underneath it.
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleAdd = () => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return;
    if (!options.some((o) => o.option_value === trimmed)) {
      onAdd(trimmed);
    }
  };

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1" ref={wrapperRef}>
          <Input
            type={type}
            step={type === 'number' ? '0.001' : undefined}
            min={type === 'number' ? '0' : undefined}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={`Show saved ${label} options`}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        <Button type="button" variant="outline" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
          className="z-[60] overflow-hidden rounded-lg border border-border bg-card shadow-xl animate-fade-in"
        >
          {options.length > 0 ? (
            <div className="max-h-48 overflow-y-auto p-1">
              {options.map((opt) => (
                <div
                  key={opt.id}
                  className="group flex items-center justify-between rounded-md py-2 pl-2.5 pr-1.5 text-sm hover:bg-secondary"
                >
                  <button type="button" onClick={() => handleSelect(opt.option_value)} className="flex-1 text-left">
                    {opt.option_value}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(opt.id)}
                    className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${opt.option_value}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">No saved options yet — type a value and click Add.</p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
