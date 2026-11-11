// Safe name/id resolution. Never guesses: more than one plausible match is an error that
// lists the candidates so the agent can ask the user.

import type { AppData, Milestone, Project, Task } from '../../data/types.ts';
import { fail, type RefSummary } from './errors.ts';

const STOP = new Set(['a', 'an', 'the', 'my', 'our', 'project', 'task', 'todo', 'to', 'do', 'of', 'for', 'and']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s: string) => normalize(s).split(' ').filter((t) => t && !STOP.has(t));

interface Named {
  id: string;
  label: string;
}

type Match<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none'; suggestions: T[] };

/** Ordered matching: id → exact name → normalised name → prefix → all-words → substring. */
export function match<T extends Named>(items: T[], ref: string): Match<T> {
  const raw = ref.trim();
  const q = normalize(raw);
  if (!q) return { kind: 'none', suggestions: [] };
  const stages: ((x: T) => boolean)[] = [
    (x) => x.id === raw || x.id.toLowerCase() === raw.toLowerCase(),
    (x) => x.label.toLowerCase() === raw.toLowerCase(),
    (x) => normalize(x.label) === q,
    (x) => normalize(x.label).startsWith(q) || normalize(x.id).startsWith(q),
    (x) => {
      const want = tokens(raw);
      if (!want.length) return false;
      const have = new Set([...tokens(x.label), ...tokens(x.id)]);
      return want.every((t) => have.has(t));
    },
    (x) => normalize(x.label).includes(q),
  ];
  for (const stage of stages) {
    const hits = items.filter(stage);
    if (hits.length === 1) return { kind: 'one', item: hits[0] };
    if (hits.length > 1) return { kind: 'many', items: hits };
  }
  // Suggestions: items sharing the most words with the query.
  const want = new Set(tokens(raw));
  const scored = items
    .map((x) => ({ x, score: [...new Set([...tokens(x.label), ...tokens(x.id)])].filter((t) => want.has(t)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return { kind: 'none', suggestions: scored.slice(0, 3).map((s) => s.x) };
}

const summary = (x: Named): RefSummary => ({ id: x.id, name: x.label });

export function resolveProject(d: AppData, ref: string): Project {
  const items = d.projects.map((p) => ({ id: p.id, label: p.name, p }));
  const m = match(items, ref);
  if (m.kind === 'one') return m.item.p;
  if (m.kind === 'many')
    fail('AMBIGUOUS_REFERENCE', `"${ref}" matches ${m.items.length} projects. Which one?`, { candidates: m.items.slice(0, 5).map(summary) });
  return fail('NOT_FOUND', `No project matches "${ref}".`, { suggestions: m.suggestions.map(summary) });
}

export function resolveTask(p: Project, ref: string): Task {
  const items = p.tasks.map((t) => ({ id: t.id, label: t.title, t }));
  const m = match(items, ref);
  if (m.kind === 'one') return m.item.t;
  if (m.kind === 'many')
    fail('AMBIGUOUS_REFERENCE', `"${ref}" matches ${m.items.length} tasks in ${p.name}. Which one?`, { candidates: m.items.slice(0, 5).map(summary) });
  // Help the agent when the user called a milestone a "task".
  const ms = match(
    p.milestones.map((x) => ({ id: x.id, label: x.title, x })),
    ref,
  );
  const milestoneHint =
    ms.kind === 'one' ? ` A milestone matches: "${ms.item.label}".` : ms.kind === 'many' ? ` ${ms.items.length} milestones match.` : '';
  return fail('NOT_FOUND', `No task in ${p.name} matches "${ref}".${milestoneHint}`, { suggestions: m.suggestions.map(summary) });
}

export function resolveMilestone(p: Project, ref: string): Milestone {
  const items = p.milestones.map((x) => ({ id: x.id, label: x.title, x }));
  const m = match(items, ref);
  if (m.kind === 'one') return m.item.x;
  if (m.kind === 'many')
    fail('AMBIGUOUS_REFERENCE', `"${ref}" matches ${m.items.length} milestones in ${p.name}. Which one?`, { candidates: m.items.slice(0, 5).map(summary) });
  return fail('NOT_FOUND', `No milestone in ${p.name} matches "${ref}".`, { suggestions: m.suggestions.map(summary) });
}
