import { CalendarClock, Check, ClipboardCheck, Coffee, Eye, Hourglass, Inbox, ListChecks, Sparkles, Star, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ActivityList } from '../components/ActivityList';
import { FilterBar } from '../components/FilterBar';
import { NewProjectButton } from '../components/NewProject';
import { FocusToggle } from '../components/ProjectCard';
import { Button, Card, CardHeader, Empty, InlineText, PageHeader, StatusDot, StatusSelect, cx } from '../components/ui';
import { CATEGORIES, STATUSES } from '../data/meta';
import type { CategoryId, Status } from '../data/types';
import { formatDue, formatWeekRange, relativeDue, timeAgo } from '../lib/dates';
import { completeNextAction, getWeek, updateProject, updateTask } from '../lib/ops';
import {
  attentionReasons, datedItems, EMPTY_FILTERS, groupByUrgency, isOpen, portfolioHealth, REASON_LABEL, URGENCY_LABEL, type DatedItem,
} from '../lib/selectors';
import { useFilteredProjects } from '../state/hooks';
import { href, navigate } from '../state/router';
import { useStore } from '../state/store';

const STATUS_HEX: Record<Status, string> = {
  active: '#0A84FF',
  maintain: '#2DD4BF',
  waiting: '#FBBF24',
  review: '#A78BFA',
  parked: '#71717A',
  completed: '#10B981',
  archived: '#3F3F46',
};

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { data, apply, today, currentWeek, focusIds, setFilters } = useStore();
  const projects = useFilteredProjects();
  const ids = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const health = portfolioHealth(data, projects, today);
  const items = useMemo(() => datedItems(data, today).filter((i) => ids.has(i.projectId)), [data, today, ids]);
  const week = getWeek(data, currentWeek);

  // 1. Today: due today or past due (hobbies never show as overdue).
  const todayItems = items.filter((i) => (i.days === 0 || (i.days < 0 && !i.lowPressure)) && i.due.length === 10);
  // 2. This week: focus projects + anything due in the next 7 days.
  const focus = projects.filter((p) => focusIds.includes(p.id));
  const dueThisWeek = items.filter((i) => i.days > 0 && i.days <= 7 && i.due.length === 10);
  // 3. Deadlines: real deadlines and milestones, grouped by urgency.
  const deadlineGroups = groupByUrgency(items.filter((i) => i.kind === 'deadline' || i.kind === 'milestone'));
  // 4. Waiting.
  const waiting = projects.filter((p) => isOpen(p) && (p.status === 'waiting' || p.waitingOn.trim()));
  // Needs a look (not already in focus).
  const attention = projects
    .filter((p) => !focusIds.includes(p.id))
    .map((p) => ({ p, reasons: attentionReasons(p, today).filter((r) => r !== 'due-soon' && r !== 'overdue') }))
    .filter((x) => x.reasons.length);
  // 5. Safe to ignore for now: paused/reviewable work and hobbies always; other
  // active work only once a weekly focus exists (it's then explicitly "not this week").
  const soon = new Set(items.filter((i) => i.days <= 14 || (i.kind === 'deadline' && i.days <= 92)).map((i) => i.projectId));
  const ignorable = projects.filter(
    (p) =>
      isOpen(p) &&
      !focusIds.includes(p.id) &&
      p.priority !== 'critical' &&
      !soon.has(p.id) &&
      attentionReasons(p, today).length === 0 &&
      p.status !== 'waiting' &&
      (['review', 'parked'].includes(p.status) || p.lowPressure || p.priority === 'low' || focusIds.length > 0),
  );

  const chartData = CATEGORIES.map((c) => {
    const row: Record<string, string | number> = { name: c.short, id: c.id };
    for (const s of STATUSES) row[s.id] = projects.filter((p) => p.category === c.id && p.status === s.id && s.id !== 'archived').length;
    return row;
  });
  const usedStatuses = STATUSES.filter((s) => s.id !== 'archived' && projects.some((p) => p.status === s.id));

  const tiles: { label: string; value: number; hint: string; onClick: () => void; tone?: string }[] = [
    { label: 'Active', value: health.active, hint: 'projects with deliberate effort', onClick: () => go({ statuses: ['active'] }) },
    { label: 'Critical', value: health.critical, hint: 'commitments that cannot slip', onClick: () => go({ priorities: ['critical'] }), tone: health.critical ? 'text-red-500' : '' },
    { label: 'Waiting', value: health.waiting, hint: 'on someone or something else', onClick: () => go({ waitingOnly: true }), tone: health.waiting ? 'text-amber-500' : '' },
    { label: 'Deadlines', value: health.deadlines, hint: 'within 3 months', onClick: () => go({ deadline: '90' }) },
    { label: 'Milestones', value: health.milestonesDone, hint: 'completed in 30 days', onClick: () => navigate('activity') },
    { label: 'No next action', value: health.noNextAction, hint: 'active/waiting, undefined', onClick: () => go({ attentionOnly: true }), tone: health.noNextAction ? 'text-amber-500' : '' },
  ];
  function go(patch: Partial<typeof EMPTY_FILTERS>) {
    setFilters({ ...EMPTY_FILTERS, ...patch });
    navigate('portfolio');
  }

  return (
    <div>
      <PageHeader
        title={greeting(new Date())}
        subtitle={
          <>
            {today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · Week of {formatWeekRange(currentWeek)}
            {!week.reviewedAt && (
              <>
                {' · '}
                <a href={href('review')} className="text-accent hover:underline">
                  Weekly review not done yet
                </a>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={() => navigate('review')}>
              <ClipboardCheck size={15} /> Weekly review
            </Button>
            <NewProjectButton />
          </>
        }
      />
      <FilterBar resultCount={projects.length} />

      {/* Portfolio health */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={t.onClick} className="card animate-fade-up px-4 py-3 text-left transition-transform hover:-translate-y-px">
            <div className={cx('text-2xl font-semibold tabular-nums tracking-tight', t.tone)}>{t.value}</div>
            <div className="text-[13px] font-medium">{t.label}</div>
            <div className="truncate text-[11px] text-faint">{t.hint}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-5 lg:col-span-2">
          {/* Today */}
          <Card>
            <CardHeader icon={<Sun size={15} />} title="Today" count={todayItems.length || undefined} hint="due today or past due" />
            <div className="px-3 pb-3">
              {todayItems.length ? (
                <ul>
                  {todayItems.map((i) => (
                    <DatedRow key={i.key} item={i} />
                  ))}
                </ul>
              ) : (
                <div className="px-2 pb-2 text-sm text-muted">
                  Nothing is due today.{' '}
                  {focus.length ? 'Pick something from this week’s focus below.' : 'Choose a few focus projects for the week to make this list useful.'}
                </div>
              )}
            </div>
          </Card>

          {/* This week */}
          <Card>
            <CardHeader
              icon={<Star size={15} />}
              title="This week's focus"
              count={focus.length || undefined}
              action={
                <Button size="sm" variant="ghost" onClick={() => navigate('plan')}>
                  Plan week
                </Button>
              }
            />
            <div className="px-3 pb-3">
              {focus.length === 0 ? (
                <Empty icon={<Star size={20} />} title="No focus projects selected">
                  Star 2–4 projects that deserve your attention this week — from any card, or during the{' '}
                  <a className="text-accent hover:underline" href={href('review')}>
                    weekly review
                  </a>
                  .
                </Empty>
              ) : (
                <ul className="divide-y divide-line/60">
                  {focus.map((p) => (
                    <li key={p.id} className="flex items-start gap-3 px-2 py-3">
                      <FocusToggle projectId={p.id} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <a href={href('project', p.id)} className="text-sm font-semibold hover:underline">
                            {p.name}
                          </a>
                          <StatusSelect value={p.status} onChange={(s) => apply((d) => updateProject(d, p.id, { status: s }), { toast: 'Status updated', undoable: true })} />
                        </div>
                        <div className="mt-0.5 flex items-start gap-1 text-[13px] text-muted">
                          <span className="mt-1 shrink-0 text-faint">→</span>
                          <InlineText
                            label="next action"
                            value={p.nextAction}
                            placeholder="Set the next action…"
                            onSave={(v) => apply((d) => updateProject(d, p.id, { nextAction: v }), { toast: 'Next action updated' })}
                          />
                        </div>
                        {p.nextActionDue && <div className="ml-4 text-[11px] text-faint">Due {formatDue(p.nextActionDue)} · {relativeDue(p.nextActionDue, today)}</div>}
                      </div>
                      {p.nextAction && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Mark next action done"
                          onClick={() => apply((d) => completeNextAction(d, p.id), { toast: 'Done — set the next step when ready', undoable: true })}
                        >
                          <Check size={14} /> Done
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {dueThisWeek.length > 0 && (
                <div className="mt-2 border-t border-line/60 pt-3">
                  <div className="eyebrow px-2 pb-1">Also due in the next 7 days</div>
                  <ul>
                    {dueThisWeek.map((i) => (
                      <DatedRow key={i.key} item={i} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          {/* Deadlines */}
          <Card>
            <CardHeader icon={<CalendarClock size={15} />} title="Upcoming deadlines" hint="real deadlines and dated milestones only" />
            <div className="px-5 pb-4">
              {deadlineGroups.length === 0 ? (
                <p className="text-sm text-muted">No dated deadlines or milestones. That's fine — dates appear here only when they actually exist.</p>
              ) : (
                <div className="space-y-4">
                  {deadlineGroups.map(([g, list]) => (
                    <div key={g}>
                      <div className={cx('eyebrow mb-1.5', g === 'overdue' && '!text-red-500')}>{URGENCY_LABEL[g]}</div>
                      <ul className="space-y-1.5">
                        {list.map((i) => (
                          <li key={i.key} className="flex items-baseline gap-3 text-sm">
                            <span className="w-20 shrink-0 text-xs font-medium tabular-nums text-muted">{formatDue(i.due)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{i.title}</span>
                              <a href={href('project', i.projectId)} className="ml-2 text-xs text-faint hover:text-muted hover:underline">
                                {i.projectName}
                              </a>
                            </span>
                            <span className="shrink-0 text-xs text-faint">{relativeDue(i.due, today)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {/* Waiting on */}
          <Card>
            <CardHeader icon={<Hourglass size={15} />} title="Waiting on" count={waiting.length || undefined} />
            <div className="px-3 pb-3">
              {waiting.length === 0 ? (
                <p className="px-2 pb-1 text-sm text-muted">Nothing is waiting on anyone else.</p>
              ) : (
                <ul className="space-y-1">
                  {waiting.map((p) => (
                    <li key={p.id} className="rounded-lg px-2 py-2 hover:bg-line/25">
                      <div className="flex items-center gap-2">
                        <a href={href('project', p.id)} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                          {p.name}
                        </a>
                        <span className="text-[11px] text-faint" title="Since last update">
                          {timeAgo(p.lastActivity, today)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-300/90">{p.waitingOn || 'No details recorded'}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <StatusSelect className="-ml-1.5" value={p.status} onChange={(s) => apply((d) => updateProject(d, p.id, { status: s }), { toast: 'Status updated', undoable: true })} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Needs a look */}
          {attention.length > 0 && (
            <Card>
              <CardHeader icon={<Eye size={15} />} title="Needs a look" count={attention.length} />
              <ul className="space-y-0.5 px-3 pb-3">
                {attention.map(({ p, reasons }) => (
                  <li key={p.id}>
                    <a href={href('project', p.id)} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-line/25">
                      <StatusDot status={p.status} className="mt-1.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="text-xs text-faint">{reasons.map((r) => REASON_LABEL[r]).join(' · ')}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Distribution */}
          <Card>
            <CardHeader icon={<ListChecks size={15} />} title="Portfolio distribution" hint="by category & status" />
            <div className="h-56 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 0 }} barSize={14}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={70} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} />
                  <Tooltip
                    cursor={{ fill: 'rgb(var(--line) / 0.35)' }}
                    contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--ink))' }}
                    labelStyle={{ color: 'rgb(var(--ink))', fontWeight: 600 }}
                  />
                  {usedStatuses.map((s, idx) => (
                    <Bar
                      key={s.id}
                      dataKey={s.id}
                      name={s.label}
                      stackId="a"
                      fill={STATUS_HEX[s.id]}
                      radius={idx === usedStatuses.length - 1 ? [0, 4, 4, 0] : 0}
                      onClick={(row: { payload?: { id: CategoryId } }) => row.payload && go({ categories: [row.payload.id] })}
                      className="cursor-pointer"
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-5 pb-4 pt-1">
              {usedStatuses.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                  <StatusDot status={s.id} />
                  {s.label}
                </span>
              ))}
            </div>
          </Card>

          {/* Safe to ignore */}
          <Card>
            <CardHeader icon={<Coffee size={15} />} title="Safe to ignore for now" count={ignorable.length || undefined} />
            <div className="px-5 pb-4">
              {ignorable.length === 0 ? (
                <p className="text-sm text-muted">Everything visible has some claim on your attention.</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-faint">Not in focus, nothing due within two weeks, nothing blocking.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ignorable.map((p) => (
                      <a key={p.id} href={href('project', p.id)} className="chip">
                        <StatusDot status={p.status} />
                        {p.name.split(' — ')[0]}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader
              icon={<Sparkles size={15} />}
              title="Recent activity"
              action={
                <Button size="sm" variant="ghost" onClick={() => navigate('activity')}>
                  All
                </Button>
              }
            />
            <div className="px-3 pb-3">
              {data.activity.length ? (
                <ActivityList entries={data.activity.filter((a) => !a.projectId || ids.has(a.projectId)).slice(0, 8)} />
              ) : (
                <Empty icon={<Inbox size={20} />} title="No activity yet" />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DatedRow({ item: i }: { item: DatedItem }) {
  const { apply, today } = useStore();
  const overdue = i.days < 0;
  const complete = () => {
    if (i.kind === 'task') apply((d) => updateTask(d, i.projectId, i.key, { status: 'done' }), { toast: 'Task completed', undoable: true });
    else if (i.kind === 'next-action') apply((d) => completeNextAction(d, i.projectId), { toast: 'Next action done', undoable: true });
  };
  const checkable = i.kind === 'task' || i.kind === 'next-action';
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-line/25">
      {checkable ? (
        <button
          type="button"
          onClick={complete}
          aria-label={`Complete: ${i.title}`}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-faint text-transparent transition-colors hover:border-accent hover:text-accent"
        >
          <Check size={11} strokeWidth={3} />
        </button>
      ) : (
        <CalendarClock size={15} className="shrink-0 text-faint" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{i.title}</div>
        <a href={href('project', i.projectId)} className="text-xs text-faint hover:text-muted hover:underline">
          {i.projectName}
        </a>
      </div>
      <span className={cx('shrink-0 text-xs', overdue ? 'font-medium text-red-500' : 'text-muted')}>{relativeDue(i.due, today)}</span>
    </li>
  );
}
