import { Bot, ChevronLeft, ChevronRight, History, NotebookPen, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActivityList } from '../components/ActivityList';
import { Button, Card, CardHeader, Empty, IconButton, InlineText, PageHeader, cx } from '../components/ui';
import type { JournalEntry } from '../data/types';
import { addDays, formatTimestamp, parseISODate, toISODate } from '../lib/dates';
import { addJournalEntry, deleteJournalEntry, journalForDay, MAX_JOURNAL_TEXT, updateJournalEntry } from '../lib/ops';
import { sortProjects } from '../lib/selectors';
import { useProjectMap } from '../state/hooks';
import { href, navigate } from '../state/router';
import { useStore } from '../state/store';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (day: string, n: number) => toISODate(addDays(parseISODate(day), n));
const longDay = (day: string) => parseISODate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A page per day: things worth remembering, plus what agents and the activity log say happened. */
export function Journal({ day: param }: { day?: string }) {
  const { data, apply, today } = useStore();
  const todayKey = toISODate(today);
  const day = param && DAY_RE.test(param) && param <= todayKey ? param : todayKey;
  const isToday = day === todayKey;
  const go = (d: string) => navigate('journal', d === todayKey ? undefined : d);

  const entries = useMemo(() => journalForDay(data, day), [data, day]);
  const mine = entries.filter((e) => !e.source);
  const agents = entries.filter((e) => e.source);
  const activity = useMemo(() => data.activity.filter((a) => toISODate(new Date(a.at)) === day), [data.activity, day]);

  const recentDays = useMemo(() => {
    const counts = new Map<string, { notes: number; keeps: number; agents: number }>();
    for (const j of data.journal) {
      const c = counts.get(j.day) ?? { notes: 0, keeps: 0, agents: 0 };
      if (j.source) c.agents++;
      else c.notes++;
      if (j.keep) c.keeps++;
      counts.set(j.day, c);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  }, [data.journal]);

  const remove = (id: string) => apply((d) => deleteJournalEntry(d, id), { toast: 'Entry deleted', undoable: true });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Journal"
        subtitle={isToday ? `Today · ${longDay(day)}` : longDay(day)}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line bg-raised p-0.5">
            <IconButton label="Previous day" onClick={() => go(shiftDay(day, -1))}>
              <ChevronLeft size={16} />
            </IconButton>
            <input
              type="date"
              aria-label="Go to day"
              className="bg-transparent px-1 text-sm font-medium outline-none"
              value={day}
              max={todayKey}
              onChange={(e) => DAY_RE.test(e.target.value) && go(e.target.value)}
            />
            <IconButton label="Next day" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>
              <ChevronRight size={16} />
            </IconButton>
            {!isToday && (
              <Button size="sm" variant="ghost" onClick={() => go(todayKey)}>
                Today
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={<NotebookPen size={15} />} title="My notes" count={mine.length || undefined} hint="Star what you want to remember" />
            <div className="px-5 pb-4">
              <Composer key={day} day={day} />
            </div>
            {mine.length > 0 && (
              <ol className="space-y-1 px-3 pb-3">
                {mine.map((e) => (
                  <NoteItem
                    key={e.id}
                    entry={e}
                    onSave={(text) => apply((d) => updateJournalEntry(d, e.id, { text }))}
                    onKeep={() => apply((d) => updateJournalEntry(d, e.id, { keep: !e.keep }), { toast: e.keep ? 'Unstarred' : 'Starred to remember' })}
                    onDelete={() => remove(e.id)}
                  />
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader icon={<Bot size={15} />} title="Agent summaries" count={agents.length || undefined} />
            {agents.length === 0 ? (
              <Empty icon={<Bot size={22} />} title={isToday ? 'No summaries yet today' : 'No summaries this day'}>
                Agents that work for you can post a short summary here when they finish.
              </Empty>
            ) : (
              <ol className="space-y-1 px-3 pb-3">
                {agents.map((e) => (
                  <li key={e.id} className="group flex gap-2.5 rounded-lg px-2 py-2 hover:bg-line/25">
                    <span className="mt-0.5 text-accent">
                      <Bot size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{e.text}</p>
                      <Meta entry={e} />
                    </div>
                    <IconButton label="Delete summary" className="!h-6 !w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove(e.id)}>
                      <Trash2 size={12} />
                    </IconButton>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={<History size={15} />}
              title="Activity that day"
              count={activity.length || undefined}
              action={
                <a className="text-xs font-medium text-muted hover:text-ink" href={href('activity')}>
                  Open Activity
                </a>
              }
            />
            <div className="px-3 pb-3">
              {activity.length ? <ActivityList entries={activity} /> : <p className="px-2 pb-2 text-sm text-faint">Nothing logged.</p>}
            </div>
          </Card>
        </div>

        <aside className="space-y-2">
          <h2 className="px-1 text-xs font-semibold text-muted">Recent days</h2>
          {recentDays.length === 0 ? (
            <p className="px-1 text-xs text-faint">Days you write in will show up here.</p>
          ) : (
            <ul className="space-y-0.5">
              {recentDays.map(([d, c]) => (
                <li key={d}>
                  <a
                    href={href('journal', d === todayKey ? undefined : d)}
                    aria-current={d === day ? 'page' : undefined}
                    className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors', d === day ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-line/40 hover:text-ink')}
                  >
                    <span className="flex-1 truncate">{d === todayKey ? 'Today' : parseISODate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    {c.keeps > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-amber-500" title={`${c.keeps} starred`}>
                        <Star size={11} fill="currentColor" />
                        {c.keeps}
                      </span>
                    )}
                    <span className="text-[11px] tabular-nums text-faint" title={`${c.notes} notes, ${c.agents} agent summaries`}>
                      {c.notes + c.agents}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function Composer({ day }: { day: string }) {
  const { data, apply } = useStore();
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(false);
  const [projectId, setProjectId] = useState('');
  const save = () => {
    if (!text.trim()) return;
    apply((d) => addJournalEntry(d, { day, text, keep, projectIds: projectId ? [projectId] : undefined }), { toast: keep ? 'Saved and starred' : 'Saved' });
    setText('');
    setKeep(false);
  };
  return (
    <div className="space-y-2">
      <textarea
        className="field min-h-[84px]"
        aria-label="New journal note"
        placeholder="What's worth remembering?"
        maxLength={MAX_JOURNAL_TEXT}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select className="field !w-auto !py-1 text-xs" aria-label="Related project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">No project</option>
          {sortProjects(data.projects).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" aria-pressed={keep} className={cx('chip', keep && 'chip-on')} onClick={() => setKeep((k) => !k)}>
          <Star size={12} fill={keep ? 'currentColor' : 'none'} /> Remember this
        </button>
        <span className="ml-auto hidden text-[11px] text-faint sm:inline">Ctrl+Enter to save</span>
        <Button variant="primary" size="sm" disabled={!text.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function NoteItem({ entry, onSave, onKeep, onDelete }: { entry: JournalEntry; onSave: (t: string) => void; onKeep: () => void; onDelete: () => void }) {
  return (
    <li className={cx('group flex gap-1.5 rounded-lg px-1 py-1', entry.keep && 'bg-amber-400/[.07]')}>
      <IconButton label={entry.keep ? 'Unstar' : 'Star to remember'} aria-pressed={!!entry.keep} className={cx('!h-7 !w-7', entry.keep && '!text-amber-500')} onClick={onKeep}>
        <Star size={14} fill={entry.keep ? 'currentColor' : 'none'} />
      </IconButton>
      <div className="min-w-0 flex-1 pt-0.5">
        <InlineText multiline label="note" value={entry.text} onSave={(v) => v && onSave(v)} className="!py-0.5 text-[13px] leading-relaxed" />
        <Meta entry={entry} />
      </div>
      <IconButton label="Delete note" className="!h-7 !w-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={onDelete}>
        <Trash2 size={12} />
      </IconButton>
    </li>
  );
}

function Meta({ entry }: { entry: JournalEntry }) {
  const projects = useProjectMap();
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-faint">
      <time dateTime={entry.at} title={formatTimestamp(entry.at)}>
        {time(entry.at)}
      </time>
      {entry.source && <span>via {entry.source.agent}</span>}
      {entry.editedAt && <span title={formatTimestamp(entry.editedAt)}>edited</span>}
      {entry.projectIds?.map((id) => {
        const p = projects.get(id);
        return p ? (
          <a key={id} className="truncate hover:text-muted hover:underline" href={href('project', id)}>
            {p.name}
          </a>
        ) : null;
      })}
    </div>
  );
}
