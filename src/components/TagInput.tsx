import { useState } from 'preact/hooks';
import { cleanTag, tagKey } from '../lib/lines';

/** Tags as removable chips, with suggestions from tags you've used before. */
export function TagInput(props: { tags: string[]; known: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const tag = cleanTag(raw, props.known);
    setText('');
    if (!tag || props.tags.some((t) => tagKey(t) === tagKey(tag))) return;
    props.onChange([...props.tags, tag]);
  };
  const unused = props.known.filter((k) => !props.tags.some((t) => tagKey(t) === tagKey(k)));
  return (
    <div class="tag-input">
      {props.tags.map((t) => (
        <span class="tag-chip">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => props.onChange(props.tags.filter((x) => x !== t))}>
            ✕
          </button>
        </span>
      ))}
      <input
        list="known-tags"
        value={text}
        placeholder={props.tags.length ? 'Add another' : 'Add a tag, e.g. Italy 2026'}
        aria-label="Add a tag"
        enterKeyHint="done"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          // A comma finishes a tag; picking a suggestion from the list adds it right away.
          if (v.endsWith(',')) add(v.slice(0, -1));
          else if (unused.some((k) => k === v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id="known-tags">
        {unused.map((k) => (
          <option value={k} />
        ))}
      </datalist>
    </div>
  );
}
