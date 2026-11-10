import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActivityList, KIND_META } from '../components/ActivityList';
import { Card, Empty, IconButton, PageHeader, cx } from '../components/ui';
import type { ActivityKind } from '../data/types';
import { addDays, formatWeekRange, parseISODate, shiftWeek, toISODate } from '../lib/dates';
import { deleteActivity } from '../lib/ops';
import { sortProjects } from '../lib/selectors';
import { useStore } from '../state/store';
import { LogComposer } from './ProjectDetail';

/** What happened in a given week — useful after fast AI-agent development sessions. */
export function Activity() {
  const { data, apply, currentWeek } = useStore();
  const [week, setWeek] = useState(currentWeek);
  const [projectId, setProjectId] = useState('');
  const [kinds, setKinds] = useState<ActivityKind[]>([]);
  const [logProject, setLogProject] = useState('');

  const start = parseISODate(week);
  const end = addDays(start, 7);
  const entries = useMemo(
    () =>
      data.activity.filter((a) => {
        const t = new Date(a.at);
        return t >= start && t < end && (!projectId || a.projectId === projectId) && (!kinds.length || kinds.includes(a.kind));
      }),
    [data.activity, week, projectId, kinds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = toISODate(new Date(e.at));
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const counts = (k: ActivityKind) => entries.filter((e) => e.kind === k).length;
  const kindsPresent = (Object.keys(KIND_META) as ActivityKind[]).filter((k) => data.activity.some((a) => a.kind === k));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Activity"
        subtitle="A running log of what changed. Review any week."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line bg-raised p-0.5">
            <IconButton label="Previous week" onClick={() => setWeek(shiftWeek(week, -1))}>
              <ChevronLeft size={16} />
            </IconButton>
            <button type="button" className="min-w-[120px] px-2 text-sm font-medium" onClick={() => setWeek(currentWeek)}>
              {formatWeekRange(week)}
            </button>
            <IconButton label="Next week" disabled={week >= currentWeek} onClick={() => setWeek(shiftWeek(week, 1))}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="space-y-2 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className="field sm:!w-56" aria-label="Project for new entry" value={logProject} onChange={(e) => setLogProject(e.target.value)}>
              <option value="">General (no project)</option>
              {sortProjects(data.projects).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex-1">
              <LogComposer projectId={logProject || undefined} />
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="field !w-auto !rounded-full !py-1 text-xs" aria-label="Filter by project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {sortProjects(data.projects).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {kindsPresent.map((k) => (
          <button
            key={k}
            type="button"
            className={cx('chip', kinds.includes(k) && 'chip-on')}
            onClick={() => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}
          >
            {KIND_META[k].icon} {KIND_META[k].label}
            {counts(k) > 0 && <span className="tabular-nums text-faint">{counts(k)}</span>}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <Card>
          <Empty icon={<History size={22} />} title="Nothing logged this week">
            Status changes, completed tasks and milestones, and next-action updates are logged automatically. Add notes or decisions above.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, list]) => (
            <Card key={day}>
              <div className="px-5 pb-1 pt-4 text-xs font-semibold text-muted">
                {parseISODate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </div>
              <div className="px-3 pb-3">
                <ActivityList entries={list} absolute onDelete={(id) => apply((d) => deleteActivity(d, id), { toast: 'Entry deleted', undoable: true })} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
