import { Check, ChevronLeft, ChevronRight, ClipboardCheck, SkipForward } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActivityList } from '../components/ActivityList';
import { Button, Card, InlineText, PageHeader, StatusDot, StatusSelect, cx } from '../components/ui';
import { formatDue, formatWeekRange, relativeDue, shiftWeek, timeAgo } from '../lib/dates';
import { getWeek, logActivity, updateProject, updateSettings, updateWeek } from '../lib/ops';
import { capacityState, datedItems, FOCUS_SOFT_LIMIT, isOpen } from '../lib/selectors';
import { href, navigate } from '../state/router';
import { useStore } from '../state/store';
import { FocusPicker } from './Planner';

const STEPS = [
  { title: 'Completed work', hint: 'Notice what actually got done.' },
  { title: 'Waiting on others', hint: 'Has anything come back? Does anything need a nudge?' },
  { title: 'Upcoming deadlines', hint: 'Anything within the next three months.' },
  { title: 'Missing next actions', hint: 'Every active project should have one obvious next step.' },
  { title: 'Choose focus', hint: 'Pick the small number of projects that deserve attention.' },
  { title: 'Available time', hint: 'Be honest about capacity.' },
  { title: 'Save plan', hint: 'Capture an intention for the week.' },
];

export function Review() {
  const { data, apply, today, currentWeek } = useStore();
  // Late in the week (Fri–Sun) the review usually plans next week.
  const [target, setTarget] = useState(() => (today.getDay() === 0 || today.getDay() >= 5 ? shiftWeek(currentWeek, 1) : currentWeek));
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(new Set([0]));
  const week = getWeek(data, target);
  const go = (n: number) => {
    setStep(n);
    setVisited((v) => new Set(v).add(n));
  };

  const since = useMemo(() => new Date(today.getTime() - 7 * 86_400_000).toISOString(), [today]);
  const completed = data.activity.filter((a) => a.at >= since && ['task', 'milestone', 'status', 'decision', 'next-action'].includes(a.kind));
  const waiting = data.projects.filter((p) => isOpen(p) && (p.status === 'waiting' || p.waitingOn.trim()));
  const deadlines = datedItems(data, today).filter((i) => i.days <= 92 && (i.kind === 'deadline' || i.kind === 'milestone' || i.days <= 14));
  const noNext = data.projects.filter((p) => ['active', 'waiting'].includes(p.status) && !p.nextAction.trim());
  const cap = capacityState(week, data.settings.weeklyCapacity);

  const save = () => {
    apply(
      (d) =>
        logActivity(updateWeek(d, target, (w) => ({ ...w, reviewedAt: new Date().toISOString() })), {
          kind: 'review',
          text: `Weekly review saved for ${formatWeekRange(target)} — ${week.focusProjectIds.length} focus project${week.focusProjectIds.length === 1 ? '' : 's'}`,
        }),
      { toast: 'Weekly plan saved' },
    );
    navigate('dashboard');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Weekly review"
        subtitle={
          <>
            About 15 minutes. Planning for{' '}
            <select className="rounded bg-transparent font-medium text-ink hover:bg-line/40" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Week being planned">
              <option value={currentWeek}>this week ({formatWeekRange(currentWeek)})</option>
              <option value={shiftWeek(currentWeek, 1)}>next week ({formatWeekRange(shiftWeek(currentWeek, 1))})</option>
            </select>
            {week.reviewedAt && <span className="text-faint"> · last saved {timeAgo(week.reviewedAt, new Date())}</span>}
          </>
        }
      />

      {/* Stepper */}
      <ol className="mb-5 flex gap-1 overflow-x-auto pb-1 scrollbar-thin" aria-label="Review steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex-1">
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={step === i ? 'step' : undefined}
              className={cx('group w-full min-w-[64px] text-left')}
            >
              <span className={cx('block h-1 rounded-full transition-colors', i === step ? 'bg-accent' : visited.has(i) ? 'bg-accent/40' : 'bg-line')} />
              <span className={cx('mt-1.5 block truncate text-[11px] font-medium', i === step ? 'text-ink' : 'text-faint group-hover:text-muted')}>
                {i + 1}. {s.title}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card key={step} className="min-h-[320px]">
        <div className="px-6 pb-2 pt-5">
          <div className="eyebrow">
            Step {step + 1} of {STEPS.length}
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{STEPS[step].title}</h2>
          <p className="text-sm text-muted">{STEPS[step].hint}</p>
        </div>
        <div className="px-6 pb-6 pt-3">
          {step === 0 &&
            (completed.length ? (
              <>
                <p className="mb-2 text-sm text-muted">
                  <b className="text-ink">{completed.length}</b> meaningful updates in the last 7 days.
                </p>
                <div className="-mx-2 max-h-80 overflow-y-auto">
                  <ActivityList entries={completed} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No tasks, milestones, or decisions were logged in the last 7 days. That's useful to know too — consider logging work as you go.</p>
            ))}

          {step === 1 &&
            (waiting.length ? (
              <ul className="space-y-3">
                {waiting.map((p) => (
                  <li key={p.id} className="rounded-xl border border-line/80 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={href('project', p.id)} className="flex-1 text-sm font-semibold hover:underline">
                        {p.name}
                      </a>
                      <span className="text-[11px] text-faint">updated {timeAgo(p.lastActivity, today)}</span>
                      <StatusSelect value={p.status} onChange={(s) => apply((d) => updateProject(d, p.id, { status: s }), { toast: 'Status updated' })} />
                    </div>
                    <div className="mt-1 text-sm text-amber-600 dark:text-amber-300">
                      <InlineText label="waiting on" value={p.waitingOn} placeholder="What are you waiting on?" onSave={(v) => apply((d) => updateProject(d, p.id, { waitingOn: v }))} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing is waiting on anyone else.</p>
            ))}

          {step === 2 &&
            (deadlines.length ? (
              <ul className="divide-y divide-line/60">
                {deadlines.map((i) => (
                  <li key={i.key} className="flex items-baseline gap-3 py-2 text-sm">
                    <span className="w-20 shrink-0 text-xs font-medium text-muted">{formatDue(i.due)}</span>
                    <span className="min-w-0 flex-1">
                      {i.title}
                      <a href={href('project', i.projectId)} className="ml-2 text-xs text-faint hover:underline">
                        {i.projectName}
                      </a>
                    </span>
                    <span className={cx('text-xs', i.days < 0 && i.due.length === 10 ? 'text-red-500' : 'text-faint')}>{relativeDue(i.due, today)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No dated items in the next three months.</p>
            ))}

          {step === 3 &&
            (noNext.length ? (
              <ul className="space-y-3">
                {noNext.map((p) => (
                  <li key={p.id} className="rounded-xl border border-line/80 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <StatusDot status={p.status} /> {p.name}
                    </div>
                    <div className="mt-1 text-sm">
                      <InlineText label="next action" value="" placeholder="Type the next action…" onSave={(v) => v && apply((d) => updateProject(d, p.id, { nextAction: v }), { toast: 'Next action set' })} />
                    </div>
                    <button type="button" className="mt-1 text-xs text-faint hover:text-muted" onClick={() => apply((d) => updateProject(d, p.id, { status: 'parked' }), { toast: 'Parked', undoable: true })}>
                      No next action? Park it instead
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Check size={16} className="text-emerald-500" /> Every active and waiting project has a next action.
              </p>
            ))}

          {step === 4 && (
            <>
              <FocusPicker weekStart={target} />
              <p className={cx('mt-3 text-xs', week.focusProjectIds.length > FOCUS_SOFT_LIMIT ? 'text-amber-600 dark:text-amber-300' : 'text-faint')}>
                {week.focusProjectIds.length} selected.{' '}
                {week.focusProjectIds.length > FOCUS_SOFT_LIMIT ? 'Consider trimming — fewer projects means more finished work.' : 'Two to four is usually right. Protected employment does not need a star.'}
              </p>
            </>
          )}

          {step === 5 && (
            <div className="space-y-4 text-sm">
              <label className="flex items-center gap-3">
                <span className="text-muted">Discretionary hours available</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="field !w-24"
                  value={data.settings.weeklyCapacity}
                  onChange={(e) => apply((d) => updateSettings(d, { weeklyCapacity: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </label>
              <p className="text-muted">
                Currently planned for this week: <b className="text-ink">{cap.planned}h</b> of {cap.capacity}h.
                {cap.level === 'over' && <span className="text-amber-600 dark:text-amber-300"> That's more than you have.</span>}
              </p>
              <Button onClick={() => navigate('plan')}>Open the week planner</Button>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <textarea
                className="field"
                rows={4}
                placeholder="One or two sentences: what would make this week a good one?"
                value={week.notes}
                onChange={(e) => apply((d) => updateWeek(d, target, (w) => ({ ...w, notes: e.target.value })))}
              />
              <p className="text-xs text-faint">
                Focus: {week.focusProjectIds.map((id) => data.projects.find((p) => p.id === id)?.name.split(' — ')[0]).filter(Boolean).join(', ') || 'none selected'}
              </p>
              <Button variant="primary" onClick={save}>
                <ClipboardCheck size={15} /> Save weekly plan
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => go(step - 1)}>
          <ChevronLeft size={15} /> Back
        </Button>
        {step < STEPS.length - 1 && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => go(step + 1)}>
              Skip <SkipForward size={14} />
            </Button>
            <Button variant="primary" onClick={() => go(step + 1)}>
              Next <ChevronRight size={15} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
