// Tiny closed-schema validator (no dependencies, runs in browser, Node and Deno).
// One definition per tool produces both runtime validation and the JSON Schema that the
// MCP adapter will publish, so the two can't drift apart.

import { fail } from './errors.ts';
import { isIsoDate, isMonday, isStrictDue } from './time.ts';

export type Field =
  | { type: 'string'; min?: number; max: number; optional?: boolean; nullable?: boolean; description?: string }
  | { type: 'enum'; values: readonly string[]; optional?: boolean; description?: string }
  | { type: 'boolean'; optional?: boolean; description?: string }
  | { type: 'number'; min: number; max: number; integer?: boolean; optional?: boolean; description?: string }
  /** YYYY-MM-DD or YYYY-MM (Compass due format). */
  | { type: 'due'; optional?: boolean; nullable?: boolean; description?: string }
  /** YYYY-MM-DD calendar date. */
  | { type: 'date'; optional?: boolean; description?: string }
  /** YYYY-MM-DD that falls on a Monday. */
  | { type: 'monday'; optional?: boolean; description?: string }
  | { type: 'array'; of: Field; max: number; min?: number; optional?: boolean; description?: string }
  | { type: 'object'; fields: Schema; optional?: boolean; description?: string };

export type Schema = Record<string, Field>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function check(f: Field, v: unknown, path: string, errs: string[]): unknown {
  if (v === null && 'nullable' in f && f.nullable) return null;
  switch (f.type) {
    case 'string': {
      if (typeof v !== 'string') return errs.push(`${path} must be text`), undefined;
      const s = v.trim();
      if (s.length < (f.min ?? 0)) errs.push(`${path} must not be empty`);
      if (s.length > f.max) errs.push(`${path} must be at most ${f.max} characters`);
      return s;
    }
    case 'enum':
      if (typeof v !== 'string' || !f.values.includes(v)) errs.push(`${path} must be one of: ${f.values.join(', ')}`);
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') errs.push(`${path} must be true or false`);
      return v;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max || (f.integer && !Number.isInteger(v)))
        errs.push(`${path} must be ${f.integer ? 'a whole number' : 'a number'} from ${f.min} to ${f.max}`);
      return v;
    case 'due':
      if (!isStrictDue(v)) errs.push(`${path} must be a date (YYYY-MM-DD) or a month (YYYY-MM)`);
      return v;
    case 'date':
      if (!isIsoDate(v)) errs.push(`${path} must be a date (YYYY-MM-DD)`);
      return v;
    case 'monday':
      if (!isIsoDate(v)) errs.push(`${path} must be a date (YYYY-MM-DD)`);
      else if (!isMonday(v)) errs.push(`${path} must be a Monday (weeks start on Monday)`);
      return v;
    case 'array': {
      if (!Array.isArray(v)) return errs.push(`${path} must be a list`), undefined;
      if (v.length > f.max) errs.push(`${path} may have at most ${f.max} items`);
      if (v.length < (f.min ?? 0)) errs.push(`${path} must have at least ${f.min} item(s)`);
      return v.slice(0, f.max).map((x, i) => check(f.of, x, `${path}[${i}]`, errs));
    }
    case 'object':
      return parseObject(f.fields, v, path, errs);
  }
}

function parseObject(schema: Schema, input: unknown, path: string, errs: string[]): Record<string, unknown> {
  if (!isObj(input)) {
    errs.push(`${path || 'input'} must be an object`);
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) if (!(k in schema)) errs.push(`${path ? `${path}.` : ''}${k} is not a recognised field`);
  for (const [k, f] of Object.entries(schema)) {
    const v = input[k];
    const p = path ? `${path}.${k}` : k;
    if (v === undefined) {
      if (!f.optional) errs.push(`${p} is required`);
      continue;
    }
    out[k] = check(f, v, p, errs);
  }
  return out;
}

/** Validate untrusted input against a closed schema. Throws INVALID_INPUT listing every problem. */
export function parseInput<T>(schema: Schema, input: unknown): T {
  const errs: string[] = [];
  const out = parseObject(schema, input ?? {}, '', errs);
  if (errs.length) fail('INVALID_INPUT', `Invalid input: ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ''}`, { details: errs });
  return out as T;
}

type JsonSchema = Record<string, unknown>;

function fieldToJson(f: Field): JsonSchema {
  const base: JsonSchema = f.description ? { description: f.description } : {};
  const nullable = 'nullable' in f && f.nullable;
  const withNull = (s: JsonSchema): JsonSchema => (nullable ? { ...base, anyOf: [s, { type: 'null' }] } : { ...base, ...s });
  switch (f.type) {
    case 'string':
      return withNull({ type: 'string', ...(f.min ? { minLength: f.min } : {}), maxLength: f.max });
    case 'enum':
      return { ...base, type: 'string', enum: [...f.values] };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'number':
      return { ...base, type: f.integer ? 'integer' : 'number', minimum: f.min, maximum: f.max };
    case 'due':
      return withNull({ type: 'string', pattern: '^\\d{4}-\\d{2}(-\\d{2})?$' });
    case 'date':
    case 'monday':
      return { ...base, type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
    case 'array':
      return { ...base, type: 'array', items: fieldToJson(f.of), maxItems: f.max, ...(f.min ? { minItems: f.min } : {}) };
    case 'object':
      return { ...base, ...toJsonSchema(f.fields) };
  }
}

/** JSON Schema (draft 2020-12 compatible subset) for publishing tool input schemas. */
export function toJsonSchema(schema: Schema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(schema)) {
    properties[k] = fieldToJson(f);
    if (!f.optional) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
