/** Adds `item` to the list kept under `key`. (Copying the list for each item would make grouping quadratic.) */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, item: V): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}
