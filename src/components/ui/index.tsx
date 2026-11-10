import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { PRIORITIES, STATUSES, STATUS_DOT, statusLabel } from '../../data/meta';
import type { Priority, Status } from '../../data/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── Buttons ────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 shadow-sm',
  secondary: 'bg-raised text-ink border border-line hover:bg-line/40',
  ghost: 'text-muted hover:text-ink hover:bg-line/40',
  danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all active:scale-[.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        BTN[variant],
        className,
      )}
    />
  );
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-line/50 hover:text-ink', className)}
    />
  );
}

// ── Status & priority ──────────────────────────────────────────

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_DOT[status], status === 'waiting' && 'ring-2 ring-amber-400/25', className)} />;
}

export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <StatusDot status={status} />
      {statusLabel(status)}
    </span>
  );
}

/** Priority is shown as 1–3 small bars; critical is the only red element. */
export function PriorityMark({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const bars = { critical: 3, high: 2, medium: 1, low: 0 }[priority];
  const color = priority === 'critical' ? 'bg-red-500' : priority === 'high' ? 'bg-orange-400' : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`${priority[0].toUpperCase()}${priority.slice(1)} priority`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx('w-[3px] rounded-sm', i < bars ? color : 'bg-line', ['h-1.5', 'h-2.5', 'h-3.5'][i])} />
        ))}
      </span>
      {withLabel && <span className="capitalize">{priority}</span>}
      {!withLabel && <span className="sr-only">{priority} priority</span>}
    </span>
  );
}

export function StatusSelect({ value, onChange, className }: { value: Status; onChange: (s: Status) => void; className?: string }) {
  return (
    <label className={cx('relative inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted hover:bg-line/40 hover:text-ink', className)}>
      <StatusDot status={value} />
      {statusLabel(value)}
      <select
        aria-label="Status"
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value as Status)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STATUSES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} — {s.hint}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PrioritySelect({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center rounded-md px-1.5 py-1 hover:bg-line/40">
      <PriorityMark priority={value} withLabel />
      <select aria-label="Priority" value={value} onChange={(e) => onChange(e.target.value as Priority)} className="absolute inset-0 cursor-pointer opacity-0">
        {PRIORITIES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Layout bits ────────────────────────────────────────────────

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={cx('card animate-fade-up', className)}>
      {children}
    </section>
  );
}

export function CardHeader({ icon, title, count, action, hint }: { icon?: ReactNode; title: string; count?: number; action?: ReactNode; hint?: string }) {
  return (
    <header className="flex items-center gap-2 px-5 pb-2 pt-4">
      {icon && <span className="text-faint">{icon}</span>}
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {count !== undefined && <span className="rounded-full bg-line/60 px-1.5 text-[11px] font-medium tabular-nums text-muted">{count}</span>}
      {hint && <span className="hidden truncate text-xs text-faint sm:inline">{hint}</span>}
      <div className="ml-auto flex items-center gap-1">{action}</div>
    </header>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-2 text-faint">{icon}</div>}
      <p className="text-sm font-medium text-muted">{title}</p>
      {children && <div className="mt-1 max-w-xs text-xs text-faint">{children}</div>}
    </div>
  );
}

export function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div className={cx('h-1 overflow-hidden rounded-full bg-line/70', className)} role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-valuemin={0}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button[data-autofocus]')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className={cx('relative w-full animate-fade-up rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── Inline editing ─────────────────────────────────────────────

/** Click-to-edit text. Saves on blur / Enter (Cmd+Enter for multiline); Escape cancels. */
export function InlineText({
  value,
  onSave,
  placeholder = 'Add…',
  multiline,
  className,
  inputClassName,
  label,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    const common = {
      autoFocus: true,
      'aria-label': label,
      value: draft,
      onBlur: commit,
      className: cx('field', inputClassName),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      },
    };
    return multiline ? <textarea rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))} {...common} /> : <input {...common} />;
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${label}`}
      className={cx('-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-line/30', !value && 'text-faint', multiline && 'whitespace-pre-wrap', className)}
    >
      {value || placeholder}
    </button>
  );
}

/** Day or month-only date input. Month precision avoids inventing a day. */
export function DueInput({ value, onChange, label }: { value?: string; onChange: (v: string | undefined) => void; label: string }) {
  const month = !!value && value.length === 7;
  const [monthMode, setMonthMode] = useState(month);
  useEffect(() => setMonthMode(!!value && value.length === 7), [value]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        aria-label={label}
        type={monthMode ? 'month' : 'date'}
        className="field !w-auto !py-1 text-xs"
        value={value ? (monthMode ? value.slice(0, 7) : value.length === 7 ? `${value}-01` : value) : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      <button
        type="button"
        className={cx('chip !px-2 !py-0.5 !text-[11px]', monthMode && 'chip-on')}
        title="Only the month is known"
        onClick={() => {
          const next = !monthMode;
          setMonthMode(next);
          if (value) onChange(next ? value.slice(0, 7) : `${value.slice(0, 7)}-01`);
        }}
      >
        Month only
      </button>
      {value && (
        <IconButton label={`Clear ${label}`} className="!h-6 !w-6" onClick={() => onChange(undefined)}>
          <X size={13} />
        </IconButton>
      )}
    </div>
  );
}
