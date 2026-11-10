import { Archive, ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink, Flag, GitBranch, Globe, Lightbulb, Link2, ListTodo, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ActivityList } from '../components/ActivityList';
import { FocusToggle } from '../components/ProjectCard';
import { Button, Card, CardHeader, DueInput, Empty, IconButton, InlineText, PrioritySelect, ProgressBar, StatusDot, StatusSelect, cx } from '../components/ui';
import { CATEGORIES, PRIORITIES, TASK_STATUSES } from '../data/meta';
import type { CategoryId, Milestone, Priority, Project, Task, TaskStatus } from '../data/types';
import { formatDue, formatTimestamp, relativeDue, timeAgo } from '../lib/dates';
import {
  addMilestone, addTask, completeNextAction, deleteActivity, deleteMilestone, deleteProject, deleteTask, getProject, recordEntry, updateMilestone, updateProject, updateTask,
} from '../lib/ops';
import { attentionReasons, progressOf, REASON_LABEL } from '../lib/selectors';
import { href, navigate } from '../state/router';
import { useStore } from '../state/store';

export function ProjectDetail({ id }: { id: string }) {
  const { data, apply, today, confirm } = useStore();
  const p = getProject(data, id);
  if (!p) {
    return (
      <div className="card">
        <Empty title="Project not found">
          It may have been deleted.{' '}
          <a className="text-accent hover:underline" href={href('portfolio')}>
            Back to portfolio
          </a>
        </Empty>
      </div>
    );
  }
  const set = (patch: Partial<Project>, toast?: string) => apply((d) => updateProject(d, p.id, patch), { toast });
  const reasons = attentionReasons(p, today);
  const prog = progressOf(p);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      body: (
        <>
          This removes the project, its {p.tasks.length} tasks and {p.milestones.length} milestones. Its activity history is kept. Consider <b>Archive</b> instead
          if you want to keep it for reference. You can undo right after deleting.
        </>
      ),
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (ok) {
      apply((d) => deleteProject(d, p.id), { toast: 'Project deleted', undoable: true });
      navigate('portfolio');
    }
  };

  return (
    <div className="animate-fade-up">
      <a href={href('portfolio')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Portfolio
      </a>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <InlineText label="name" value={p.name} onSave={(v) => v && set({ name: v })} className="text-2xl font-semibold tracking-tight sm:text-[28px]" inputClassName="!text-xl font-semibold" />
          </div>
          <FocusToggle projectId={p.id} size={18} className="!h-9 !w-9" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StatusSelect value={p.status} onChange={(s) => set({ status: s }, 'Status updated')} />
          <PrioritySelect value={p.priority} onChange={(v) => set({ priority: v })} />
          <label className="relative inline-flex cursor-pointer items-center rounded-md px-1.5 py-1 text-xs text-muted hover:bg-line/40 hover:text-ink">
            {CATEGORIES.find((c) => c.id === p.category)?.label}
            <ChevronDown size={12} className="ml-1" />
            <select aria-label="Category" className="absolute inset-0 cursor-pointer opacity-0" value={p.category} onChange={(e) => set({ category: e.target.value as CategoryId })}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {p.type && <span className="text-xs text-faint">{p.type}</span>}
          <span className="text-xs text-faint" title={formatTimestamp(p.lastActivity)}>
            Updated {timeAgo(p.lastActivity, new Date())}
          </span>
        </div>
        <div className="mt-2 max-w-3xl text-sm text-muted">
          <InlineText label="description" multiline value={p.description} placeholder="Add a short description…" onSave={(v) => set({ description: v })} />
        </div>
        {reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <span key={r} className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-300">
                {REASON_LABEL[r]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Next action — the most important field, so it gets the most prominent spot. */}
      <Card className="mb-5 border-l-[3px] border-accent !rounded-l-lg">
        <div className="flex flex-wrap items-start gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">Next action</div>
            <InlineText label="next action" value={p.nextAction} placeholder="What's the very next step?" onSave={(v) => set({ nextAction: v }, 'Next action updated')} className="text-[15px] font-medium" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Due</span>
              <DueInput label="Next action due" value={p.nextActionDue} onChange={(v) => set({ nextActionDue: v })} />
              {p.nextActionDue && <span className="text-faint">{relativeDue(p.nextActionDue, today)}</span>}
            </div>
          </div>
          {p.nextAction && (
            <Button variant="secondary" onClick={() => apply((d) => completeNextAction(d, p.id), { toast: 'Done — what comes next?', undoable: true })}>
              <Check size={15} /> Done
            </Button>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-5 lg:col-span-2">
          <TasksCard p={p} />
          <MilestonesCard p={p} />
          <Card>
            <CardHeader icon={<StickyNote size={15} />} title="Notes" />
            <div className="px-5 pb-4 text-sm leading-relaxed text-ink/90">
              <InlineText label="notes" multiline value={p.notes} placeholder="Context, decisions, links… (Ctrl+Enter to save)" onSave={(v) => set({ notes: v })} />
            </div>
          </Card>
          <Card>
            <CardHeader icon={<Lightbulb size={15} />} title="Activity" hint="log a note or a decision" />
            <div className="px-5 pb-2">
              <LogComposer projectId={p.id} />
            </div>
            <div className="px-3 pb-3">
              {(() => {
                const entries = data.activity.filter((a) => a.projectId === p.id);
                return entries.length ? (
                  <ActivityList entries={entries.slice(0, 40)} showProject={false} onDelete={(aid) => apply((d) => deleteActivity(d, aid), { toast: 'Entry deleted', undoable: true })} />
                ) : (
                  <p className="px-2 pb-2 text-sm text-faint">No activity recorded yet.</p>
                );
              })()}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-3 px-5 pb-5 text-sm">
              <Field label="Current phase">
                <InlineText label="phase" value={p.phase} onSave={(v) => set({ phase: v })} />
              </Field>
              <Field label="Current milestone">
                <InlineText label="current milestone" value={p.milestone} onSave={(v) => set({ milestone: v })} />
              </Field>
              {prog && (
                <Field label={`Progress (${prog.basis})`}>
                  <div className="flex items-center gap-2 pt-1">
                    <ProgressBar done={prog.done} total={prog.total} className="flex-1" />
                    <span className="text-xs tabular-nums text-muted">
                      {prog.done}/{prog.total}
                    </span>
                  </div>
                </Field>
              )}
              <Field label="Deadline">
                <div className="space-y-1.5 pt-0.5">
                  <DueInput label="Deadline" value={p.deadline} onChange={(v) => set({ deadline: v })} />
                  {p.deadline && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>{formatDue(p.deadline)}</span>·<span>{relativeDue(p.deadline, today)}</span>
                    </div>
                  )}
                  {p.deadline && (
                    <InlineText label="deadline label" value={p.deadlineLabel ?? ''} placeholder="What is it? (e.g. convention)" onSave={(v) => set({ deadlineLabel: v || undefined })} className="text-xs" />
                  )}
                </div>
              </Field>
              <Field label="Waiting on">
                <InlineText label="waiting on" value={p.waitingOn} placeholder="Nothing" onSave={(v) => set({ waitingOn: v })} className={p.waitingOn ? 'text-amber-600 dark:text-amber-300' : ''} />
              </Field>
              <Field label="Blockers">
                <InlineText label="blockers" value={p.blockers} placeholder="None" onSave={(v) => set({ blockers: v })} className={p.blockers ? 'text-red-500' : ''} />
              </Field>
              <Field label="Weekly time (hours)">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label="Estimated weekly hours"
                  placeholder="—"
                  className="field !w-24 !py-1"
                  value={p.weeklyHours ?? ''}
                  onChange={(e) => set({ weeklyHours: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Type">
                <InlineText label="type" value={p.type} placeholder="e.g. Client project" onSave={(v) => set({ type: v })} />
              </Field>
              <div className="space-y-1.5 pt-1">
                <Toggle label="Ongoing (no % progress)" on={!!p.ongoing} onChange={(v) => set({ ongoing: v })} />
                <Toggle label="Limited allocation" on={!!p.limited} onChange={(v) => set({ limited: v })} />
                <Toggle label="Low pressure — never nag" on={!!p.lowPressure} onChange={(v) => set({ lowPressure: v })} />
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader icon={<Link2 size={15} />} title="Links" />
            <div className="space-y-3 px-5 pb-5 text-sm">
              <UrlField icon={<GitBranch size={14} />} label="Repository" value={p.repoUrl} onSave={(v) => set({ repoUrl: v || undefined })} />
              <UrlField icon={<Globe size={14} />} label="Website" value={p.websiteUrl} onSave={(v) => set({ websiteUrl: v || undefined })} />
            </div>
          </Card>

          <RelatedCard p={p} />

          <Card>
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {p.status !== 'archived' ? (
                <Button size="sm" onClick={() => set({ status: 'archived' }, 'Archived — hidden from everyday views')}>
                  <Archive size={13} /> Archive
                </Button>
              ) : (
                <Button size="sm" onClick={() => set({ status: 'review' }, 'Restored to Review')}>
                  Unarchive
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={remove}>
                <Trash2 size={13} /> Delete
              </Button>
              <span className="w-full text-[11px] text-faint">Created {formatTimestamp(p.createdAt)}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-muted">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

function UrlField({ icon, label, value, onSave }: { icon: React.ReactNode; label: string; value?: string; onSave: (v: string) => void }) {
  const safe = value && /^https?:\/\//i.test(value) ? value : value ? `https://${value}` : '';
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 text-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-faint">{label}</div>
        <InlineText label={label} value={value ?? ''} placeholder="Add URL" onSave={onSave} className="truncate text-xs" />
      </div>
      {value && (
        <a href={safe} target="_blank" rel="noreferrer noopener" aria-label={`Open ${label}`} className="mt-3 text-muted hover:text-accent">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function LogComposer({ projectId }: { projectId?: string }) {
  const { apply } = useStore();
  const [text, setText] = useState('');
  const save = (kind: 'note' | 'decision') => {
    if (!text.trim()) return;
    apply((d) => recordEntry(d, projectId, kind, text), { toast: kind === 'decision' ? 'Decision recorded' : 'Note added' });
    setText('');
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        className="field flex-1"
        aria-label="New log entry"
        placeholder="What happened? e.g. merged PR #12, decided to use ACF blocks"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save('note')}
      />
      <div className="flex gap-2">
        <Button disabled={!text.trim()} onClick={() => save('note')}>
          Note
        </Button>
        <Button disabled={!text.trim()} onClick={() => save('decision')}>
          Decision
        </Button>
      </div>
    </div>
  );
}

export { LogComposer };

// ── Tasks ───────────────────────────────────────────────────────

function TasksCard({ p }: { p: Project }) {
  const { apply } = useStore();
  const [title, setTitle] = useState('');
  const [showDone, setShowDone] = useState(false);
  const open = p.tasks.filter((t) => t.status !== 'done');
  const done = p.tasks.filter((t) => t.status === 'done');
  const add = () => {
    if (!title.trim()) return;
    apply((d) => addTask(d, p.id, { title: title.trim() }));
    setTitle('');
  };
  return (
    <Card>
      <CardHeader icon={<ListTodo size={15} />} title="Tasks" count={open.length || undefined} />
      <div className="px-5">
        <div className="relative">
          <Plus size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field !pl-9" aria-label="New task" placeholder="Add a task and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
      </div>
      <ul className="px-3 py-2">
        {open.map((t) => (
          <TaskRow key={t.id} p={p} t={t} />
        ))}
        {!open.length && <li className="px-2 py-2 text-sm text-faint">{p.tasks.length ? 'All tasks done.' : 'No tasks. Keep it that way unless they help.'}</li>}
      </ul>
      {done.length > 0 && (
        <div className="border-t border-line/60 px-3 py-2">
          <button type="button" onClick={() => setShowDone(!showDone)} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-faint hover:text-muted">
            {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {done.length} completed
          </button>
          {showDone && (
            <ul>
              {done.map((t) => (
                <TaskRow key={t.id} p={p} t={t} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function TaskRow({ p, t }: { p: Project; t: Task }) {
  const { apply, today } = useStore();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Task>, toast?: string) => apply((d) => updateTask(d, p.id, t.id, patch), { toast, undoable: !!toast });
  const done = t.status === 'done';
  return (
    <li className="rounded-lg hover:bg-line/20">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <button
          type="button"
          aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`}
          onClick={() => set({ status: done ? 'todo' : 'done' }, done ? undefined : 'Task completed')}
          className={cx(
            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
            done ? 'border-accent bg-accent text-white' : 'border-faint text-transparent hover:border-accent hover:text-accent',
          )}
        >
          <Check size={11} strokeWidth={3} />
        </button>
        <div className={cx('min-w-0 flex-1 text-sm', done && 'text-faint line-through')}>
          <InlineText label="task title" value={t.title} onSave={(v) => v && set({ title: v })} className="!py-0.5" />
        </div>
        {t.status === 'doing' && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">In progress</span>}
        {t.due && <span className={cx('text-xs', !done && (relativeDue(t.due, today).includes('ago') || relativeDue(t.due, today) === 'yesterday') ? 'text-red-500' : 'text-muted')}>{formatDue(t.due)}</span>}
        {t.effort && <span className="hidden text-xs text-faint sm:inline">{t.effort}</span>}
        <IconButton label={open ? 'Hide task details' : 'Show task details'} className="!h-7 !w-7" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
      </div>
      {open && (
        <div className="grid animate-fade-up gap-3 px-9 pb-3 sm:grid-cols-2">
          <div>
            <span className="label">Status</span>
            <select className="field !py-1" value={t.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Priority</span>
            <select className="field !py-1" value={t.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Due</span>
            <DueInput label="Task due" value={t.due} onChange={(v) => set({ due: v })} />
          </div>
          <div>
            <span className="label">Effort</span>
            <input className="field !py-1" placeholder="e.g. 2h" value={t.effort ?? ''} onChange={(e) => set({ effort: e.target.value || undefined })} />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Notes</span>
            <textarea className="field" rows={2} value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </div>
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-[11px] text-faint">{t.completedAt ? `Completed ${formatTimestamp(t.completedAt)}` : ''}</span>
            <Button size="sm" variant="danger" onClick={() => apply((d) => deleteTask(d, p.id, t.id), { toast: 'Task deleted', undoable: true })}>
              <Trash2 size={12} /> Delete task
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Milestones ──────────────────────────────────────────────────

function MilestonesCard({ p }: { p: Project }) {
  const { apply } = useStore();
  const [title, setTitle] = useState('');
  const add = () => {
    if (!title.trim()) return;
    apply((d) => addMilestone(d, p.id, { title: title.trim() }));
    setTitle('');
  };
  return (
    <Card>
      <CardHeader icon={<Flag size={15} />} title="Milestones" count={p.milestones.length || undefined} hint="progress is measured from these" />
      <ol className="px-3">
        {p.milestones.map((m, i) => (
          <MilestoneRow key={m.id} p={p} m={m} last={i === p.milestones.length - 1} />
        ))}
      </ol>
      <div className="px-5 pb-4 pt-2">
        <div className="relative">
          <Plus size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field !pl-9" aria-label="New milestone" placeholder="Add a milestone and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
      </div>
    </Card>
  );
}

function MilestoneRow({ p, m, last }: { p: Project; m: Milestone; last: boolean }) {
  const { apply, today } = useStore();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Milestone>, toast?: string) => apply((d) => updateMilestone(d, p.id, m.id, patch), { toast });
  return (
    <li className="relative flex gap-3 rounded-lg px-2 py-1.5 hover:bg-line/20">
      {!last && <span aria-hidden className={cx('absolute left-[17px] top-7 h-[calc(100%-14px)] w-px', m.done ? 'bg-accent/50' : 'bg-line')} />}
      <button
        type="button"
        aria-label={m.done ? `Mark ${m.title} not done` : `Complete milestone ${m.title}`}
        onClick={() => set({ done: !m.done }, m.done ? undefined : 'Milestone completed 🎉')}
        className={cx(
          'relative z-[1] mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors',
          m.done ? 'border-accent bg-accent text-white' : 'border-faint bg-surface text-transparent hover:border-accent hover:text-accent',
        )}
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className={cx('min-w-0 flex-1 text-sm font-medium', m.done && 'text-muted')}>
            <InlineText label="milestone title" value={m.title} onSave={(v) => v && set({ title: v })} className="!py-0.5" />
          </div>
          {m.targetDate && <span className="text-xs text-muted">{formatDue(m.targetDate)}</span>}
          <IconButton label={open ? 'Hide milestone details' : 'Show milestone details'} className="!h-7 !w-7" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        </div>
        {m.description && !open && <p className="text-xs text-faint">{m.description}</p>}
        {open && (
          <div className="mt-2 grid animate-fade-up gap-3 pb-2">
            <div>
              <span className="label">Target date</span>
              <div className="flex items-center gap-2">
                <DueInput label="Milestone target" value={m.targetDate} onChange={(v) => set({ targetDate: v })} />
                {m.targetDate && <span className="text-xs text-faint">{relativeDue(m.targetDate, today)}</span>}
              </div>
            </div>
            <div>
              <span className="label">Description</span>
              <textarea className="field" rows={2} value={m.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-faint">{m.completedAt ? `Completed ${formatTimestamp(m.completedAt)}` : ''}</span>
              <Button size="sm" variant="danger" onClick={() => apply((d) => deleteMilestone(d, p.id, m.id), { toast: 'Milestone deleted', undoable: true })}>
                <Trash2 size={12} /> Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ── Related projects ────────────────────────────────────────────

function RelatedCard({ p }: { p: Project }) {
  const { data, apply } = useStore();
  const related = p.relatedIds.map((rid) => getProject(data, rid)).filter(Boolean) as Project[];
  const candidates = data.projects.filter((x) => x.id !== p.id && !p.relatedIds.includes(x.id));
  const link = (rid: string) =>
    apply((d) => {
      const other = getProject(d, rid);
      let next = updateProject(d, p.id, { relatedIds: [...p.relatedIds, rid] });
      // Links are kept two-way so each side can navigate to the other.
      if (other && !other.relatedIds.includes(p.id)) next = updateProject(next, rid, { relatedIds: [...other.relatedIds, p.id] });
      return next;
    });
  const unlink = (rid: string) =>
    apply((d) => {
      const other = getProject(d, rid);
      let next = updateProject(d, p.id, { relatedIds: p.relatedIds.filter((x) => x !== rid) });
      if (other) next = updateProject(next, rid, { relatedIds: other.relatedIds.filter((x) => x !== p.id) });
      return next;
    });
  return (
    <Card>
      <CardHeader title="Related projects" count={related.length || undefined} />
      <ul className="px-3">
        {related.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-line/25">
            <StatusDot status={r.status} />
            <a href={href('project', r.id)} className="min-w-0 flex-1 truncate text-sm hover:underline">
              {r.name}
            </a>
            <IconButton label={`Unlink ${r.name}`} className="!h-6 !w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => unlink(r.id)}>
              <X size={12} />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="px-5 pb-4 pt-1">
        <select
          className="field !py-1.5 text-xs"
          aria-label="Link a related project"
          value=""
          onChange={(e) => e.target.value && link(e.target.value)}
        >
          <option value="">+ Link a project…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}
