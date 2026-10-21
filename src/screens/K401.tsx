import { useNav } from '../nav';
import type { Account } from '../types';
import { k401Limit, k401Year, missedMatch } from '../lib/k401';
import { formatMoney } from '../lib/money';
import { todayISO } from '../lib/dates';
import { Row, Section } from '../components/ui';
import { IconChip } from '../components/icons';
import { useBirthYear, usePay } from '../retirementModel';
import { AccountEditor } from './AccountEditor';

const whole = (c: number) => formatMoney(c, { whole: true });
/** 0.06 → "6%", 0.035 → "3.5%". */
export const ratePct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** On a 401(k)'s page: what goes in from your pay and your employer, the match check, and the yearly limit. */
export function K401Section(props: { account: Account }) {
  const nav = useNav();
  const a = props.account;
  const pay = usePay();
  const birthYear = useBirthYear();
  const year = Number(todayISO().slice(0, 4));
  const limit = k401Limit(year, birthYear);
  const edit = () => nav.present((close) => <AccountEditor account={a} onClose={close} />);

  if (a.contributionRate == null || !pay)
    return (
      <Section
        title="Contributions"
        footer="Your HR or 401(k) site shows what comes out of each paycheck and how your employer matches it. With those, the app checks you get the full match, estimates the yearly limit, and counts your 401(k) in your savings rate."
      >
        <button type="button" class="row link-row" onClick={edit}>
          {a.contributionRate == null ? 'Add What You Put In & the Match' : 'Add Your Pay'}
        </button>
      </Section>
    );

  const y = k401Year(a, pay, limit.limit);
  const missed = missedMatch(y);
  return (
    <Section
      title="Contributions"
      footer={`Estimated from your pay (${whole(pay)} a year) and the rates you entered; tap Edit to change them. The limit is for all your 401(k)s and 403(b)s together, and your employer’s match doesn’t count toward it.`}
    >
      <Row title="You put in" subtitle={`${ratePct(a.contributionRate)} of your pay`} detail={`${whole(y.yours)}/yr`} />
      <Row
        title="Your employer adds"
        subtitle={
          a.employerMatch
            ? `${ratePct(a.employerMatch)} of yours${a.employerMatchUpTo != null ? `, up to ${ratePct(a.employerMatchUpTo)} of pay` : ''}`
            : 'No match entered'
        }
        detail={`${whole(y.match)}/yr`}
      />
      {y.fullMatchAt != null && (
        <Row
          icon={<IconChip name={missed ? 'gift' : 'check'} hue={missed ? 'yellow' : 'green'} size="sm" />}
          title={missed ? `Missing ${whole(missed)} a year of match` : 'You get the full match'}
          subtitle={
            missed
              ? `Put in ${ratePct(y.fullMatchAt)} instead of ${ratePct(a.contributionRate)} to get all of it`
              : `Putting in ${ratePct(y.fullMatchAt)} or more gets all of it`
          }
          onClick={missed ? edit : undefined}
        />
      )}
      <div class="meter-row k401-limit">
        <span class="meter-head">
          <span>{year} limit</span>
          <span class="muted">
            {whole(y.yours)} of {whole(limit.limit)}
          </span>
        </span>
        <span
          class="meter-track"
          role="meter"
          aria-label={`${year} 401(k) contributions at your rate`}
          aria-valuemin={0}
          aria-valuemax={limit.limit / 100}
          aria-valuenow={y.yours / 100}
        >
          <span class="meter-fill" style={{ width: `${Math.min(100, (y.yours / limit.limit) * 100)}%` }} />
        </span>
        <span class="meter-sub">
          {y.overLimit ? 'Your rate would pass the limit, and contributions stop there' : `At your rate · ${whole(limit.limit - y.yours)} more allowed`}
          {limit.catchUp ? ' · includes the catch-up for your age' : ''}
          {limit.estimated ? ` · the ${year} limit isn’t announced yet, so last year’s is used` : ''}
        </span>
      </div>
    </Section>
  );
}
