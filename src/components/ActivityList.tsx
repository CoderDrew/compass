import { ArrowRightLeft, CheckCircle2, CircleDot, Flag, Hourglass, Lightbulb, ListTodo, OctagonAlert, Plus, Star, StickyNote, Trash2, ClipboardCheck, SignalHigh } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActivityEntry, ActivityKind } from '../data/types';
import { formatTimestamp, timeAgo } from '../lib/dates';
import { href } from '../state/router';
import { useProjectMap } from '../state/hooks';
import { useStore } from '../state/store';
import { cx, IconButton } from './ui';

export const KIND_META: Record<ActivityKind, { icon: ReactNode; label: string }> = {
  status: { icon: <ArrowRightLeft size={13} />, label: 'Status' },
  priority: { icon: <SignalHigh size={13} />, label: 'Priority' },
  task: { icon: <CheckCircle2 size={13} />, label: 'Task' },
  milestone: { icon: <Flag size={13} />, label: 'Milestone' },
  note: { icon: <StickyNote size={13} />, label: 'Note' },
  decision: { icon: <Lightbulb size={13} />, label: 'Decision' },
  'next-action': { icon: <ListTodo size={13} />, label: 'Next action' },
  blocker: { icon: <OctagonAlert size={13} />, label: 'Blocker' },
  waiting: { icon: <Hourglass size={13} />, label: 'Waiting' },
  project: { icon: <Plus size={13} />, label: 'Project' },
  focus: { icon: <Star size={13} />, label: 'Focus' },
  review: { icon: <ClipboardCheck size={13} />, label: 'Review' },
};

export function ActivityList({
  entries,
  showProject = true,
  onDelete,
  absolute,
}: {
  entries: ActivityEntry[];
  showProject?: boolean;
  onDelete?: (id: string) => void;
  absolute?: boolean;
}) {
  const { today } = useStore();
  const projects = useProjectMap();
  const now = new Date(Math.max(today.getTime(), Date.now()));
  return (
    <ol className="space-y-0.5">
      {entries.map((a) => {
        const meta = KIND_META[a.kind] ?? { icon: <CircleDot size={13} />, label: a.kind };
        const p = a.projectId ? projects.get(a.projectId) : undefined;
        const emphasis = a.kind === 'milestone' || a.kind === 'decision';
        return (
          <li key={a.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-line/25">
            <span className={cx('mt-0.5', emphasis ? 'text-accent' : 'text-faint')} title={meta.label}>
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <span className={cx(emphasis ? 'font-medium text-ink' : 'text-ink/90', 'whitespace-pre-wrap break-words')}>{a.text}</span>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-faint">
                {showProject && p && (
                  <a className="truncate hover:text-muted hover:underline" href={href('project', p.id)}>
                    {p.name}
                  </a>
                )}
                <time dateTime={a.at} title={formatTimestamp(a.at)}>
                  {absolute ? formatTimestamp(a.at) : timeAgo(a.at, now)}
                </time>
              </div>
            </div>
            {onDelete && (
              <IconButton label="Delete entry" className="!h-6 !w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onDelete(a.id)}>
                <Trash2 size={12} />
              </IconButton>
            )}
          </li>
        );
      })}
    </ol>
  );
}
