import { AlertTriangle, Briefcase, CalendarDays, ChevronLeft, ChevronRight, Copy, Plus, Star, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardHeader, IconButton, PageHeader, StatusDot, cx } from '../components/ui';
import { BLOCK_KINDS, blockKindLabel, DAYS } from '../data/meta';
import type { AllocationSuggestion, BlockKind, PlanBlock } from '../data/types';
import { addDays, formatWeekRange, parseISODate, shiftWeek } from '../lib/dates';
import { addBlock, getWeek, removeBlock, toggleFocus, updateBlock, updateSettings, updateWeek } from '../lib/ops';
import { capacityState, FOCUS_SOFT_LIMIT, isOpen, sortProjects } from '../lib/selectors';
import { useProjectMap } from '../state/hooks';
import { href } from '../state/router';
import { useStore } from '../state/store';

const KIND_STYLE: Record<BlockKind, string> = {
  focus: 'border-l-accent bg-accent/[0.06]',
  session: 'border-l-sky-400 bg-sky-400/[0.06]',
  recurring: 'border-l-teal-400 bg-teal-400/[0.06]',
  fixed: 'border-l-zinc-400 bg-zinc-400/[0.08]',
  deadline: 'border-l-red-500 bg-red-500/[0.06]',
};

export function Planner() {
  const { data, apply, currentWeek } = useStore();
  const [weekStart, setWeekStart] = useState(currentWeek);
  const week = getWeek(data, weekStart);
  const { settings } = data;
  const cap = capacityState(week, settings.weeklyCapacity);
  const projects = useProjectMap();
  const isCurrent = weekStart === currentWeek;

  const addFromSuggestion = (s: AllocationSuggestion) => {
    const hours = s.hours ?? settings.blockHours;
    apply((d) => {
      let next = d;
      for (let i = 0; i < s.blocks; i++)
        next = addBlock(next, weekStart, {
          kind: s.kind,
          title: s.label,
          projectId: s.projectIds.length === 1 ? s.projectIds[0] : undefined,
          hours,
        });
      return next;
    }, { toast: `Added ${s.blocks} unscheduled block${s.blocks > 1 ? 's' : ''}` });
  };

  const prevWeek = shiftWeek(weekStart, -1);
  const prev = data.weeks[prevWeek];

  return (
    <div>
      <PageHeader
        title="Plan the week"
        subtitle="Choose a few projects, give them focus blocks, and keep an eye on capacity. Nothing is scheduled automatically."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line bg-raised p-0.5">
            <IconButton label="Previous week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))}>
              <ChevronLeft size={16} />
            </IconButton>
            <button type="button" onClick={() => setWeekStart(currentWeek)} className="min-w-[132px] px-2 text-center text-sm font-medium">
              {formatWeekRange(weekStart)}
              <span className="block text-[10px] font-normal text-faint">{isCurrent ? 'This week' : weekStart > currentWeek ? 'Upcoming' : 'Past week'}</span>
            </button>
            <IconButton label="Next week" onClick={() => setWeekStart(shiftWeek(weekStart, 1))}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Capacity */}
        <Card className="lg:col-span-2">
          <CardHeader icon={<CalendarDays size={15} />} title="Capacity" hint="discretionary hours outside employment" />
          <div className="px-5 pb-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-3xl font-semibold tabular-nums tracking-tight">
                  {fmtH(cap.planned)}
                  <span className="text-lg font-normal text-faint"> / {fmtH(cap.capacity)}h</span>
                </div>
                <div className="text-xs text-muted">planned this week</div>
              </div>
              <div className="text-sm text-muted">
                {cap.remaining >= 0 ? (
                  <>
                    <span className="font-medium text-ink">{fmtH(cap.remaining)}h</span> unplanned — breathing room is a feature.
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
                    <AlertTriangle size={14} /> {fmtH(-cap.remaining)}h over capacity. Consider dropping a block rather than finding more time.
                  </span>
                )}
              </div>
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                Weekly capacity
                <input
                  type="number"
                  min={0}
                  max={80}
                  step={0.5}
                  className="field !w-20 !py-1"
                  value={settings.weeklyCapacity}
                  onChange={(e) => apply((d) => updateSettings(d, { weeklyCapacity: Math.max(0, Number(e.target.value) || 0) }))}
                />
                h
              </label>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line/60">
              <div
                className={cx('h-full rounded-full transition-all duration-500', cap.level === 'over' ? 'bg-amber-500' : cap.level === 'tight' ? 'bg-amber-400/80' : 'bg-accent')}
                style={{ width: `${Math.min(100, cap.capacity ? (cap.planned / cap.capacity) * 100 : 0)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-faint">
              <Briefcase size={13} /> Antech: {settings.employmentHours}h protected employment — tracked separately, never counted against discretionary capacity.
            </div>
          </div>
        </Card>

        {/* Focus projects */}
        <Card>
          <CardHeader icon={<Star size={15} />} title="Focus projects" count={week.focusProjectIds.length || undefined} />
          <div className="px-5 pb-5">
            <FocusPicker weekStart={weekStart} />
            {week.focusProjectIds.length > FOCUS_SOFT_LIMIT && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">That's a lot of focus. Fewer projects usually means more finished work.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Suggested allocations */}
      <Card className="mb-5">
        <CardHeader
          icon={<Wand2 size={15} />}
          title="Suggested allocations"
          hint="suggestions only — adding creates unscheduled blocks"
          action={
            prev && prev.blocks.length > 0 && week.blocks.length === 0 ? (
              <Button
                size="sm"
                onClick={() =>
                  apply((d) => updateWeek(d, weekStart, (w) => ({ ...w, blocks: prev.blocks.map((b) => ({ ...b, id: `${b.id}-c${Date.now().toString(36)}` })) })), {
                    toast: 'Copied last week’s blocks',
                  })
                }
              >
                <Copy size={13} /> Copy last week
              </Button>
            ) : undefined
          }
        />
        <ul className="grid gap-2 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.allocations.map((s) => {
            const added = week.blocks.filter((b) => b.title === s.label).length;
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line/80 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-faint">
                    {s.protected ? 'Protected employment hours' : `${s.blocks} × ${blockKindLabel(s.kind).toLowerCase()} · ${fmtH(s.hours ?? settings.blockHours)}h each`}
                  </div>
                </div>
                {s.protected ? (
                  <span className="text-[11px] text-faint">Always on</span>
                ) : added >= s.blocks ? (
                  <span className="text-[11px] font-medium text-accent">Added</span>
                ) : (
                  <Button size="sm" onClick={() => addFromSuggestion(s)}>
                    <Plus size={13} /> Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Week grid */}
      <WeekGrid weekStart={weekStart} blocks={week.blocks} projects={projects} />

      <Card className="mt-5">
        <CardHeader title="Notes for the week" />
        <div className="px-5 pb-5">
          <textarea
            className="field"
            rows={3}
            placeholder="Intentions, constraints, things to say no to…"
            value={week.notes}
            onChange={(e) => apply((d) => updateWeek(d, weekStart, (w) => ({ ...w, notes: e.target.value })))}
          />
        </div>
      </Card>
    </div>
  );
}

const fmtH = (n: number) => String(Math.round(n * 100) / 100);

export function FocusPicker({ weekStart }: { weekStart: string }) {
  const { data, apply } = useStore();
  const week = getWeek(data, weekStart);
  const candidates = sortProjects(data.projects.filter((p) => isOpen(p) && p.status !== 'parked'));
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.map((p) => {
        const on = week.focusProjectIds.includes(p.id);
        return (
          <button key={p.id} type="button" aria-pressed={on} className={cx('chip', on && 'chip-on')} onClick={() => apply((d) => toggleFocus(d, weekStart, p.id))}>
            {on ? <Star size={11} className="text-amber-400" fill="currentColor" /> : <StatusDot status={p.status} />}
            {p.name.split(' — ')[0]}
          </button>
        );
      })}
    </div>
  );
}

function WeekGrid({ weekStart, blocks, projects }: { weekStart: string; blocks: PlanBlock[]; projects: ReturnType<typeof useProjectMap> }) {
  const { apply, data } = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const start = parseISODate(weekStart);
  const columns: { day: number | undefined; label: string; sub?: string }[] = [
    { day: undefined, label: 'Unscheduled', sub: 'flexible' },
    ...DAYS.map((d, i) => ({ day: i, label: d, sub: String(addDays(start, i).getDate()) })),
  ];
  const drop = (day: number | undefined) => {
    if (dragId) apply((d) => updateBlock(d, weekStart, dragId, { day }));
    setDragId(null);
  };

  const column = (c: (typeof columns)[number], className?: string, inner?: string) => {
    const list = blocks.filter((b) => b.day === c.day);
    const hours = list.reduce((s, b) => s + (b.kind === 'deadline' ? 0 : b.hours), 0);
    return (
      <div
        key={c.label}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(c.day)}
        className={cx('rounded-xl p-2 transition-colors', dragId && 'ring-accent/50', className)}
      >
        <div className="mb-2 flex items-baseline gap-1.5 px-1">
          <span className="text-xs font-semibold">{c.label}</span>
          <span className="text-[11px] text-faint">{c.sub}</span>
          {hours > 0 && <span className="ml-auto text-[11px] tabular-nums text-faint">{fmtH(hours)}h</span>}
        </div>
        <div className={inner ?? 'space-y-1.5'}>
          {list.map((b) => (
            <BlockCard key={b.id} b={b} weekStart={weekStart} projectName={b.projectId ? projects.get(b.projectId)?.name : undefined} onDrag={setDragId} />
          ))}
          {!list.length && c.day === undefined && <p className="px-1 text-xs text-faint">Nothing unscheduled. Add a block or a suggestion — it lands here until you place it.</p>}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader
        title="Week"
        hint="drag blocks onto days, or use each block's day menu"
        action={
          <Button size="sm" variant="primary" onClick={() => setAdding(!adding)}>
            <Plus size={13} /> Add block
          </Button>
        }
      />
      {adding && <AddBlockForm weekStart={weekStart} onDone={() => setAdding(false)} defaultHours={data.settings.blockHours} />}
      <div className="px-3 pb-2">{column(columns[0], 'bg-line/20 ring-1 ring-line/70', 'grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5')}</div>
      <div className="grid gap-2 px-3 pb-4 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {columns.slice(1).map((c) => column(c, 'min-h-[110px] bg-raised/70 ring-1 ring-line/60'))}
      </div>
    </Card>
  );
}

function BlockCard({ b, weekStart, projectName, onDrag }: { b: PlanBlock; weekStart: string; projectName?: string; onDrag: (id: string | null) => void }) {
  const { apply } = useStore();
  return (
    <div
      draggable
      onDragStart={() => onDrag(b.id)}
      onDragEnd={() => onDrag(null)}
      className={cx('group cursor-grab rounded-lg border-l-[3px] px-2 py-1.5 text-xs active:cursor-grabbing', KIND_STYLE[b.kind])}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">{b.title}</div>
          {projectName && b.projectId && (
            <a href={href('project', b.projectId)} className="block truncate text-[11px] text-faint hover:underline">
              {projectName}
            </a>
          )}
        </div>
        <IconButton label="Remove block" className="!h-5 !w-5 opacity-60 group-hover:opacity-100" onClick={() => apply((d) => removeBlock(d, weekStart, b.id), { toast: 'Block removed', undoable: true })}>
          <Trash2 size={11} />
        </IconButton>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
        <span>{blockKindLabel(b.kind)}</span>
        {b.kind !== 'deadline' && (
          <>
            ·
            <input
              type="number"
              min={0}
              step={0.25}
              aria-label="Hours"
              className="w-10 rounded bg-transparent px-0.5 text-right tabular-nums hover:bg-line/40 focus:bg-raised focus:outline-none"
              value={b.hours}
              onChange={(e) => apply((d) => updateBlock(d, weekStart, b.id, { hours: Math.max(0, Number(e.target.value) || 0) }))}
            />
            h
          </>
        )}
        <select
          aria-label="Day"
          className="ml-auto rounded bg-transparent text-[11px] hover:bg-line/40 focus:outline-none"
          value={b.day ?? ''}
          onChange={(e) => apply((d) => updateBlock(d, weekStart, b.id, { day: e.target.value === '' ? undefined : Number(e.target.value) }))}
        >
          <option value="">Unscheduled</option>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AddBlockForm({ weekStart, onDone, defaultHours }: { weekStart: string; onDone: () => void; defaultHours: number }) {
  const { data, apply } = useStore();
  const [kind, setKind] = useState<BlockKind>('focus');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState(defaultHours);
  const [day, setDay] = useState('');
  const projects = sortProjects(data.projects.filter(isOpen));
  const submit = () => {
    const pname = projects.find((p) => p.id === projectId)?.name;
    const t = title.trim() || pname || blockKindLabel(kind);
    apply((d) => addBlock(d, weekStart, { kind, title: t, projectId: projectId || undefined, hours: kind === 'deadline' ? 0 : hours, day: day === '' ? undefined : Number(day) }), {
      toast: 'Block added',
    });
    onDone();
  };
  return (
    <form
      className="mx-5 mb-4 grid animate-fade-up gap-3 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="lg:col-span-1">
        <span className="label">Type</span>
        <select className="field !py-1.5" value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
          {BLOCK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="lg:col-span-2">
        <span className="label">Project (optional)</span>
        <select className="field !py-1.5" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="lg:col-span-1">
        <span className="label">Title</span>
        <input className="field !py-1.5" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="flex gap-2 lg:col-span-1">
        <label className="flex-1">
          <span className="label">Hours</span>
          <input type="number" min={0} step={0.25} className="field !py-1.5" value={hours} disabled={kind === 'deadline'} onChange={(e) => setHours(Number(e.target.value) || 0)} />
        </label>
        <label className="flex-1">
          <span className="label">Day</span>
          <select className="field !py-1.5" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">—</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-2 lg:col-span-1">
        <Button type="submit" variant="primary" className="flex-1">
          Add
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
