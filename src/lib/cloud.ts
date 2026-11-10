// Thin Supabase wrapper. The library is loaded lazily, and only when the build was
// configured with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from '../data/types';
import type { RemoteRow } from './sync';

const URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const TABLE = 'compass_data';

export const cloudConfigured = Boolean(URL && KEY);

let clientPromise: Promise<SupabaseClient> | null = null;

export function getClient(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('Cloud sync is not configured for this build.'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL!, KEY!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'project-compass:auth' },
    }),
  );
  return clientPromise;
}

export class CloudConflict extends Error {
  constructor() {
    super('The cloud copy changed while saving.');
  }
}

const COLS = 'data, revision, updated_at, device';

export async function fetchRemote(c: SupabaseClient, userId: string): Promise<RemoteRow | null> {
  const { data, error } = await c.from(TABLE).select(COLS).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as RemoteRow | null;
}

export async function insertRemote(c: SupabaseClient, userId: string, payload: AppData, device: string): Promise<RemoteRow> {
  const { data, error } = await c.from(TABLE).insert({ user_id: userId, data: payload, revision: 1, device }).select(COLS).single();
  if (error) {
    if (error.code === '23505') throw new CloudConflict();
    throw new Error(error.message);
  }
  return data as RemoteRow;
}

/** Conditional write: succeeds only if the cloud is still at `baseRevision`. */
export async function updateRemote(c: SupabaseClient, userId: string, payload: AppData, baseRevision: number, device: string): Promise<RemoteRow> {
  const { data, error } = await c
    .from(TABLE)
    .update({ data: payload, revision: baseRevision + 1, device, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('revision', baseRevision)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CloudConflict();
  return data as RemoteRow;
}
