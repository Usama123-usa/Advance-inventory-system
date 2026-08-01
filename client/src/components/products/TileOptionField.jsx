import { X } from 'lucide-react';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// Manual text/number input + "Add" button that saves the typed value into a
// user-built, persisted option list (rendered as chips below the input).
// Clicking a chip fills the field with that value; clicking its × deletes
// it instantly (no confirmation).
export function TileOptionField({ label, type = 'text', value, onChange, options, onAdd, onDelete, placeholder }) {
  const handleAdd = () => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return;
    onAdd(trimmed);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type={type}
          step={type === 'number' ? '0.001' : undefined}
          min={type === 'number' ? '0' : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={handleAdd}>
          Add
        </Button>
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <span
              key={opt.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
            >
              <button type="button" onClick={() => onChange(opt.option_value)} className="hover:text-primary">
                {opt.option_value}
              </button>
              <button
                type="button"
                onClick={() => onDelete(opt.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${opt.option_value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
