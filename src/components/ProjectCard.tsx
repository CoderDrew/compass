import { AlertCircle, CalendarClock, Hourglass, Star } from 'lucide-react';
import type { Project } from '../data/types';
import { formatDue, relativeDue } from '../lib/dates';
import { toggleFocus, updateProject } from '../lib/ops';
import { attentionReasons, progressOf, REASON_LABEL } from '../lib/selectors';
import { navigate } from '../state/router';
import { useStore } from '../state/store';
import { cx, PriorityMark, ProgressBar, StatusSelect } from './ui';

export function FocusToggle({ projectId, size = 15, className }: { projectId: string; size?: number; className?: string }) {
  const { apply, currentWeek, focusIds } = useStore();
  const on = focusIds.includes(projectId);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from this week's focus" : "Add to this week's focus"}
      title={on ? "In this week's focus" : "Add to this week's focus"}
      onClick={(e) => {
        e.stopPropagation();
        apply((d) => toggleFocus(d, currentWeek, projectId), { toast: on ? 'Removed from focus' : "Added to this week's focus" });
      }}
      className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors', on ? 'text-amber-400' : 'text-faint/70 hover:bg-line/40 hover:text-muted', className)}
    >
      <Star size={size} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

/** The visual unit of the portfolio. Waiting projects get a dashed edge; paused ones recede. */
export function ProjectCard({ p, compact }: { p: Project; compact?: boolean }) {
  const { apply, today } = useStore();
  const prog = progressOf(p);
  const reasons = attentionReasons(p, today).filter((r) => r !== 'due-soon' || !p.deadline);
  const waiting = p.status === 'waiting';
  const recede = ['parked', 'review', 'completed', 'archived'].includes(p.status);

  return (
    <article
      onClick={() => navigate('project', p.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && navigate('project', p.id)}
      tabIndex={0}
      aria-label={p.name}
      className={cx(
        'group relative cursor-pointer rounded-xl border bg-surface p-3.5 transition-all hover:-translate-y-px hover:shadow-pop',
        waiting ? 'border-dashed border-amber-400/50' : 'border-line/80',
        recede && 'opacity-60 hover:opacity-100',
      )}
    >
      {p.priority === 'critical' && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r bg-red-500" />}
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug tracking-tight">{p.name}</h3>
        <FocusToggle projectId={p.id} className="-mr-1.5 -mt-1" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusSelect className="-ml-1.5" value={p.status} onChange={(s) => apply((d) => updateProject(d, p.id, { status: s }), { toast: 'Status updated', undoable: true })} />
        <PriorityMark priority={p.priority} />
        {p.limited && <span className="text-[11px] text-faint">limited</span>}
      </div>

      {!compact && (p.phase || p.milestone) && (
        <p className="mt-2 line-clamp-2 text-xs text-muted">
          {p.phase && <span className="text-ink/80">{p.phase}</span>}
          {p.phase && p.milestone && <span className="text-faint"> · </span>}
          {p.milestone}
        </p>
      )}

      {waiting && p.waitingOn ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-300/90">
          <Hourglass size={12} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{p.waitingOn}</span>
        </p>
      ) : (
        p.nextAction &&
        !compact && (
          <p className="mt-2 line-clamp-2 text-xs text-muted">
            <span className="font-medium text-faint">Next → </span>
            {p.nextAction}
          </p>
        )
      )}

      {(prog || p.deadline || reasons.length > 0) && (
        <div className="mt-3 flex items-center gap-3">
          {prog && (
            <div className="flex flex-1 items-center gap-2" title={`${prog.done} of ${prog.total} ${prog.basis} complete`}>
              <ProgressBar done={prog.done} total={prog.total} className="flex-1" />
              <span className="text-[11px] tabular-nums text-faint">
                {prog.done}/{prog.total}
              </span>
            </div>
          )}
          {!prog && <div className="flex-1" />}
          {p.deadline && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted" title={`${p.deadlineLabel ?? 'Deadline'}: ${formatDue(p.deadline)} (${relativeDue(p.deadline, today)})`}>
              <CalendarClock size={12} />
              {formatDue(p.deadline)}
            </span>
          )}
          {reasons.length > 0 && (
            <span className="text-amber-500" title={reasons.map((r) => REASON_LABEL[r]).join('\n')}>
              <AlertCircle size={13} />
              <span className="sr-only">{reasons.map((r) => REASON_LABEL[r]).join(', ')}</span>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
