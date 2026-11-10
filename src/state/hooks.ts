import { useMemo } from 'react';
import { matchesFilters, sortProjects } from '../lib/selectors';
import { useStore } from './store';

/** Projects after the shared filter state is applied (same result on every view). */
export function useFilteredProjects() {
  const { data, filters, today, focusIds } = useStore();
  return useMemo(
    () => sortProjects(data.projects.filter((p) => matchesFilters(p, filters, { today, focusIds }))),
    [data.projects, filters, today, focusIds],
  );
}

export function useProjectMap() {
  const { data } = useStore();
  return useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
}
