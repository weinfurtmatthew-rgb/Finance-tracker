import { db, getMeta, setMeta } from '../db';

async function addToList(key: string, value: string) {
  const list = (await getMeta<string[]>(key)) ?? [];
  if (!list.includes(value)) await setMeta(key, [...list, value]);
}

export const dismissSuggestion = (key: string) => addToList('dismissedRecurring', key);
export const dismissAlert = (key: string) => addToList('dismissedAlerts', key);

export async function markPaid(id: string, dueDate: string) {
  await db.recurring.update(id, { lastPaidOn: dueDate });
}
