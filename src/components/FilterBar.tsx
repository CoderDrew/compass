import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, PRIORITIES, STATUSES } from '../data/meta';
import { activeFilterCount, EMPTY_FILTERS, type Filters } from '../lib/selectors';
import { useStore } from '../state/store';
import { cx, StatusDot } from './ui';

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Shared filter bar — the same filter state drives the dashboard and the portfolio. */
export function FilterBar({ resultCount }: { resultCount?: number }) {
  const { filters: f, setFilters } = useStore();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filters>) => setFilters((x) => ({ ...x, ...patch }));
  const n = activeFilterCount(f);
  const extra = n - (f.q ? 1 : 0) - (f.focusOnly ? 1 : 0) - (f.waitingOnly ? 1 : 0) - (f.attentionOnly ? 1 : 0);

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects, tasks, notes"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            className="field !rounded-full !py-1.5 !pl-9"
          />
        </div>
        <button type="button" className={cx('chip', f.focusOnly && 'chip-on')} onClick={() => set({ focusOnly: !f.focusOnly })} aria-pressed={f.focusOnly}>
          This week's focus
        </button>
        <button type="button" className={cx('chip', f.attentionOnly && 'chip-on')} onClick={() => set({ attentionOnly: !f.attentionOnly })} aria-pressed={f.attentionOnly}>
          Needs attention
        </button>
        <button type="button" className={cx('chip', f.waitingOnly && 'chip-on')} onClick={() => set({ waitingOnly: !f.waitingOnly })} aria-pressed={f.waitingOnly}>
          Waiting
        </button>
        <button type="button" className={cx('chip', (open || extra > 0) && 'chip-on')} onClick={() => setOpen(!open)} aria-expanded={open}>
          <SlidersHorizontal size={13} /> Filters{extra > 0 && ` · ${extra}`}
        </button>
        {n > 0 && (
          <button type="button" className="chip border-transparent" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X size={13} /> Clear
          </button>
        )}
        {resultCount !== undefined && n > 0 && <span className="text-xs text-faint">{resultCount} shown</span>}
      </div>

      {open && (
        <div className="card mt-3 grid animate-fade-up gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <FilterGroup label="Category">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={cx('chip', f.categories.includes(c.id) && 'chip-on')} onClick={() => set({ categories: toggle(f.categories, c.id) })}>
                {c.short}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {STATUSES.map((s) => (
              <button key={s.id} type="button" className={cx('chip', f.statuses.includes(s.id) && 'chip-on')} onClick={() => set({ statuses: toggle(f.statuses, s.id) })}>
                <StatusDot status={s.id} />
                {s.label}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label="Priority">
            {PRIORITIES.map((p) => (
              <button key={p.id} type="button" className={cx('chip', f.priorities.includes(p.id) && 'chip-on')} onClick={() => set({ priorities: toggle(f.priorities, p.id) })}>
                {p.label}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label="Deadline">
            {(
              [
                ['any', 'Any'],
                ['has', 'Has deadline'],
                ['30', '≤ 30 days'],
                ['90', '≤ 90 days'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" className={cx('chip', f.deadline === v && 'chip-on')} onClick={() => set({ deadline: v })}>
                {l}
              </button>
            ))}
          </FilterGroup>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
