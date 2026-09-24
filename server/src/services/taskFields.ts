// Tags and custom-field values of tasks.
import type { Prisma } from '@prisma/client';
import { isDateOnly } from '../lib/dates';
import { Errors } from '../lib/errors';
import { prisma } from '../db';

type Db = Prisma.TransactionClient | typeof prisma;

export const MAX_TAGS = 20;
export const TAG_COLORS = ['#71717a', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];

export const normalizeTagName = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 40);

/** Replaces the tags of a task. Unknown tag names are created (case-insensitive match against existing tags). */
export async function setTaskTags(db: Db, taskId: string, names: string[]): Promise<void> {
  const wanted = [...new Map(names.map(normalizeTagName).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  if (wanted.length > MAX_TAGS) throw Errors.validation({ tags: 'too_big' });
  const all = wanted.length ? await db.taskTag.findMany({ select: { id: true, name: true } }) : [];
  const byLower = new Map(all.map((t) => [t.name.toLowerCase(), t.id]));
  const ids: string[] = [];
  for (const name of wanted) {
    let id = byLower.get(name.toLowerCase());
    if (!id) {
      const color = TAG_COLORS[(byLower.size + ids.length) % TAG_COLORS.length];
      id = (await db.taskTag.create({ data: { name, color } })).id;
      byLower.set(name.toLowerCase(), id);
    }
    ids.push(id);
  }
  await db.taskTagLink.deleteMany({ where: { taskId, tagId: { notIn: ids } } });
  const have = new Set((await db.taskTagLink.findMany({ where: { taskId }, select: { tagId: true } })).map((l) => l.tagId));
  const add = ids.filter((id) => !have.has(id));
  if (add.length) await db.taskTagLink.createMany({ data: add.map((tagId) => ({ taskId, tagId })) });
}

export type FieldInput = Record<string, string | number | boolean | null>;

export const parseOptions = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Validates custom field values against their definitions. A field must exist and apply to the task's space (global
 * fields apply everywhere). Values are normalised to text; null removes the value.
 */
export async function normalizeFieldValues(input: FieldInput, spaceId: string | null): Promise<Array<{ fieldId: string; value: string | null }>> {
  const ids = Object.keys(input);
  if (ids.length === 0) return [];
  if (ids.length > 50) throw Errors.validation({ customFields: 'too_big' });
  const defs = await prisma.taskCustomField.findMany({ where: { id: { in: ids }, OR: [{ spaceId: null }, ...(spaceId ? [{ spaceId }] : [])] } });
  const byId = new Map(defs.map((d) => [d.id, d]));
  return ids.map((fieldId) => {
    const def = byId.get(fieldId);
    const bad = () => Errors.validation({ [`customFields.${fieldId}`]: 'invalid' });
    if (!def) throw Errors.validation({ [`customFields.${fieldId}`]: 'invalid_choice' });
    const v = input[fieldId];
    if (v === null || v === '') return { fieldId, value: null };
    switch (def.type) {
      case 'TEXT':
        if (typeof v !== 'string' || v.length > 500) throw bad();
        return { fieldId, value: v.trim() };
      case 'NUMBER': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw bad();
        return { fieldId, value: String(n) };
      }
      case 'DATE':
        if (typeof v !== 'string' || !isDateOnly(v)) throw bad();
        return { fieldId, value: v };
      case 'SELECT':
        if (typeof v !== 'string' || !parseOptions(def.options).includes(v)) throw bad();
        return { fieldId, value: v };
      case 'CHECKBOX':
        if (typeof v !== 'boolean') throw bad();
        return { fieldId, value: v ? 'true' : 'false' };
      default:
        throw bad();
    }
  });
}
