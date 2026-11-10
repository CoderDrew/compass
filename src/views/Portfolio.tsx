import { Columns3, LayoutGrid, List, PauseCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FilterBar } from '../components/FilterBar';
import { NewProjectButton } from '../components/NewProject';
import { FocusToggle, ProjectCard } from '../components/ProjectCard';
import { Empty, PageHeader, PrioritySelect, StatusDot, StatusSelect, cx } from '../components/ui';
import { CATEGORIES, STATUSES } from '../data/meta';
import type { Project, Status } from '../data/types';
import { formatDue } from '../lib/dates';
import { updateProject } from '../lib/ops';
import { progressOf } from '../lib/selectors';
import { useFilteredProjects } from '../state/hooks';
import { navigate } from '../state/router';
import { useStore } from '../state/store';

type Layout = 'map' | 'board' | 'list';
const LAYOUT_KEY = 'project-compass:portfolio-layout';
const IN_MOTION: Status[] = ['active', 'waiting', 'maintain'];

export function Portfolio() {
  const projects = useFilteredProjects();
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem(LAYOUT_KEY) as Layout) || 'map');
  useEffect(() => localStorage.setItem(LAYOUT_KEY, layout), [layout]);

  return (
    <div>
      <PageHeader
        title="Portfolio"
        subtitle="Everything you're carrying, grouped so you can see the shape of it."
        actions={
          <>
            <div role="tablist" aria-label="Layout" className="flex rounded-lg border border-line bg-raised p-0.5">
              {(
                [
                  ['map', 'By category', <LayoutGrid size={15} />],
                  ['board', 'By status', <Columns3 size={15} />],
                  ['list', 'List', <List size={15} />],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={layout === id}
                  onClick={() => setLayout(id)}
                  className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', layout === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            <NewProjectButton />
          </>
        }
      />
      <FilterBar resultCount={projects.length} />
      <WorkloadStrip projects={projects} />
      {projects.length === 0 ? (
        <div className="card">
          <Empty title="No projects match these filters">Clear the filters above, or create a new project.</Empty>
        </div>
      ) : layout === 'map' ? (
        <CategoryMap projects={projects} />
      ) : layout === 'board' ? (
        <StatusBoard projects={projects} />
      ) : (
        <ProjectList projects={projects} />
      )}
    </div>
  );
}

/** One proportional bar summarising the whole visible portfolio by status. */
function WorkloadStrip({ projects }: { projects: Project[] }) {
  const counts = STATUSES.map((s) => ({ ...s, n: projects.filter((p) => p.status === s.id).length })).filter((s) => s.n);
  const total = projects.length;
  if (!total) return null;
  return (
    <div className="mb-6">
      <div className="flex h-2 overflow-hidden rounded-full bg-line/50">
        {counts.map((s) => (
          <div key={s.id} className={cx('h-full transition-all', `${STATUS_BG[s.id]}`)} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {counts.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <StatusDot status={s.id} /> {s.label} <span className="tabular-nums text-faint">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const STATUS_BG: Record<Status, string> = {
  active: 'bg-accent',
  maintain: 'bg-teal-400',
  waiting: 'bg-amber-400',
  review: 'bg-violet-400',
  parked: 'bg-zinc-500',
  completed: 'bg-emerald-500',
  archived: 'bg-zinc-700',
};

function CategoryMap({ projects }: { projects: Project[] }) {
  const cats = CATEGORIES.map((c) => ({ ...c, list: projects.filter((p) => p.category === c.id) })).filter((c) => c.list.length);
  return (
    <div className="gap-5 md:columns-2 2xl:columns-3 [&>section]:mb-5">
      {cats.map((c) => {
        const moving = c.list.filter((p) => IN_MOTION.includes(p.status));
        const still = c.list.filter((p) => !IN_MOTION.includes(p.status));
        const hours = c.list.reduce((s, p) => s + (IN_MOTION.includes(p.status) ? p.weeklyHours ?? 0 : 0), 0);
        return (
          <section key={c.id} className="animate-fade-up break-inside-avoid rounded-2xl bg-raised/60 p-3 ring-1 ring-line/70" aria-label={c.label}>
            <header className="mb-3 flex items-baseline gap-2 px-1.5">
              <h2 className="text-sm font-semibold tracking-tight">{c.label}</h2>
              <span className="text-xs text-faint">
                {moving.length} in motion{still.length ? ` · ${still.length} paused/review` : ''}
                {hours ? ` · ~${hours}h/wk` : ''}
              </span>
            </header>
            <div className="grid gap-2.5">
              {moving.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
            {still.length > 0 && (
              <>
                <div className="mb-2 mt-3 flex items-center gap-2 px-1.5 text-[11px] font-medium text-faint">
                  <PauseCircle size={12} /> Not in motion
                </div>
                <div className="grid gap-2">
                  {still.map((p) => (
                    <ProjectCard key={p.id} p={p} compact />
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function StatusBoard({ projects }: { projects: Project[] }) {
  const cols = STATUSES.filter((s) => s.id !== 'archived' || projects.some((p) => p.status === 'archived'));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="flex gap-4" style={{ minWidth: cols.length * 260 }}>
        {cols.map((s) => {
          const list = projects.filter((p) => p.status === s.id);
          return (
            <section key={s.id} className="w-[260px] shrink-0 lg:min-w-0 lg:flex-1" aria-label={s.label}>
              <header className="mb-2 flex items-center gap-2 px-1">
                <StatusDot status={s.id} />
                <h2 className="text-sm font-semibold">{s.label}</h2>
                <span className="text-xs tabular-nums text-faint">{list.length}</span>
              </header>
              <p className="mb-3 px-1 text-[11px] text-faint">{s.hint}</p>
              <div className="grid gap-2.5">
                {list.map((p) => (
                  <ProjectCard key={p.id} p={p} compact={!['active', 'waiting'].includes(s.id)} />
                ))}
                {!list.length && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-faint">None</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  const { apply } = useStore();
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-line/70">
        {projects.map((p) => {
          const prog = progressOf(p);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-line/20 md:flex-nowrap">
              <FocusToggle projectId={p.id} />
              <button type="button" onClick={() => navigate('project', p.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted">{p.status === 'waiting' && p.waitingOn ? `Waiting: ${p.waitingOn}` : p.nextAction || <span className="text-faint">No next action</span>}</div>
              </button>
              <div className="w-28 shrink-0">
                <StatusSelect value={p.status} onChange={(s) => apply((d) => updateProject(d, p.id, { status: s }), { toast: 'Status updated', undoable: true })} />
              </div>
              <div className="hidden w-24 shrink-0 sm:block">
                <PrioritySelect value={p.priority} onChange={(v) => apply((d) => updateProject(d, p.id, { priority: v }))} />
              </div>
              <div className="hidden w-20 shrink-0 text-xs text-muted md:block">{prog ? `${prog.done}/${prog.total} ${prog.basis === 'milestones' ? 'ms' : 'tasks'}` : ''}</div>
              <div className="w-20 shrink-0 text-right text-xs text-muted">{p.deadline ? formatDue(p.deadline) : ''}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
