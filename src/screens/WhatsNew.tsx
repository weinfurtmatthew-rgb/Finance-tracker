import { Sheet } from '../components/ui';
import { RELEASES, type Release } from '../releaseNotes';

/** What changed in recent updates: shown once after an update, and any time from Settings → About. */
export function WhatsNewSheet(props: { releases?: Release[]; onClose: () => void }) {
  const releases = props.releases ?? RELEASES;
  return (
    <Sheet title="What’s New" onClose={props.onClose} readable>
      <div class="prose whats-new">
        {releases.map((r) => (
          <section aria-label={r.title}>
            <h3>{r.title}</h3>
            <p class="whats-new-date">{r.date}</p>
            <ul>
              {r.items.map((item) => (
                <li>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
