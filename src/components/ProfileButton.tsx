import { useNav } from '../nav';
import { Glyph } from './icons';

/** Opens Settings (top-right on Today and Browse). */
export function ProfileButton() {
  const nav = useNav();
  return (
    <button type="button" class="icon-button profile-button" aria-label="Settings" onClick={() => nav.openSettings()}>
      <Glyph name="person" />
    </button>
  );
}
