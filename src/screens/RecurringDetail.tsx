import { useMemo, useState } from 'preact/hooks';
import { db } from '../db';
import { byId, useAccounts, useCategories } from '../hooks';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { diffDays, formatShortDate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { FREQUENCIES, KINDS, monthlyCost, nextOnSchedule } from '../lib/recurring';
import { cancelLinkFor } from '../lib/cancelLinks';
import { dismissAlert, markPaid } from '../lib/recurringActions';
import { ActionSheet, CategoryIcon, KindIcon, Money, Row, Section, Sheet } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { RecurringEditor } from './RecurringEditor';

export function RecurringDetail(props: { id: string; onClose: () => void }) {
  const nav = useNav();
  const model = useRecurringModel();
  const categories = useCategories();
  const accounts = useAccounts();
  const cats = useMemo(() => byId(categories), [categories]);
  const accts = useMemo(() => byId(accounts), [accounts]);
  const [ask, setAsk] = useState<null | 'delete' | 'cancel'>(null);
  const s = model.statuses.find((x) => x.rec.id === props.id);
  if (!model.loaded) return null;
  if (!s) {
    return (
      <Sheet title="Bill or Subscription" onClose={props.onClose}>
        <p class="padded muted">This item was deleted.</p>
      </Sheet>
    );
  }
  const r = s.rec;
  const today = model.today;
  const cancelled = r.status === 'cancelled';
  const outflow = r.kind !== 'income';
  const link = r.cancelUrl || cancelLinkFor(r.name, r.match);
  const days = diffDays(today, s.nextDue);
  const edit = () => nav.present((close) => <RecurringEditor recurring={r} status={s} onClose={close} />);

  const paid = async () => {
    await markPaid(r.id, s.nextDue);
    nav.toast(`Marked paid · next due ${formatShortDate(nextOnSchedule(s.nextDue, r))}`);
  };
  const setCancelled = async (on: boolean) => {
    await db.recurring.update(r.id, on ? { status: 'cancelled', cancelledOn: todayISO() } : { status: 'active', cancelledOn: undefined });
    nav.toast(on ? 'Marked as cancelled' : 'Reactivated');
    setAsk(null);
  };
  const keepTrial = async () => {
    // The trial became a paid subscription; billing starts on the day the trial ended.
    await db.recurring.update(r.id, { kind: 'subscription', lastPaidOn: r.trialEndsOn, dayOfMonth: r.trialEndsOn ? Number(r.trialEndsOn.slice(8)) : undefined });
    nav.toast('Now tracked as a subscription');
  };
  const remove = async () => {
    await db.recurring.delete(r.id);
    nav.toast('Deleted');
    props.onClose();
  };

  return (
    <Sheet title={KINDS[r.kind].label} onClose={props.onClose} onSave={edit} saveLabel="Edit" closeLabel="Done">
      <div class="detail-hero">
        {r.categoryId && cats.get(r.categoryId) ? <CategoryIcon category={cats.get(r.categoryId)} size="lg" /> : <KindIcon kind={r.kind} size="lg" />}
        <h2>{r.name}</h2>
        <Money cents={s.expected} colored={!outflow} class="hero-value" />
        <p class="muted">
          {FREQUENCIES[r.frequency].label}
          {outflow && r.frequency !== 'yearly' && ` · ${formatMoney(monthlyCost(s) * 12, { whole: true })}/yr`}
          {(r.amountMode ?? model.settings.amountMode) === 'average' && s.history.length > 1 && ' · average of recent'}
        </p>
      </div>

      {!cancelled && r.kind !== 'trial' && (
        <Section>
          <Row
            title={s.late ? 'Not seen yet' : 'Next due'}
            subtitle={
              s.late
                ? `Due ${formatShortDate(s.nextDue)}, but no matching charge has been imported. Mark it paid if you know it went through.`
                : undefined
            }
            detail={s.late ? undefined : `${formatShortDate(s.nextDue)}${days >= 0 && days < 31 ? ` · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}` : ''}`}
            chevron={false}
          />
          <button type="button" class="row link-row" onClick={paid}>
            Mark {formatShortDate(s.nextDue)} as Paid
          </button>
          {r.accountId && accts.get(r.accountId) && <Row title={outflow ? 'Paid from' : 'Paid into'} detail={accts.get(r.accountId)!.name} chevron={false} />}
        </Section>
      )}

      {r.kind === 'trial' && !cancelled && (
        <Section
          title="Free trial"
          footer={`After the trial it costs about ${formatMoney(Math.abs(s.expected))} ${FREQUENCIES[r.frequency].label.toLowerCase()}.`}
        >
          <Row title={s.trialEnded ? 'Trial ended' : 'Trial ends'} detail={r.trialEndsOn ? formatShortDate(r.trialEndsOn) : '—'} chevron={false} />
          {s.trialEnded && (
            <>
              <button type="button" class="row link-row" onClick={() => setCancelled(true)}>
                I cancelled it
              </button>
              <button type="button" class="row link-row" onClick={keepTrial}>
                I'm keeping it (track as subscription)
              </button>
            </>
          )}
        </Section>
      )}

      {s.priceChange && (
        <div class="callout warn">
          <strong>Price went up</strong>
          <p>
            {formatMoney(Math.abs(s.priceChange.from))} → {formatMoney(Math.abs(s.priceChange.to))} on {formatShortDate(s.priceChange.date)} (+
            {formatMoney(Math.abs(s.priceChange.to) - Math.abs(s.priceChange.from))}).
          </p>
          <button type="button" class="link small" onClick={() => dismissAlert(`price:${r.id}:${s.priceChange!.txnId}`)}>
            Dismiss alert
          </button>
        </div>
      )}

      {cancelled && (
        <Section title="Cancelled">
          <Row title="Cancelled on" detail={r.cancelledOn ? formatShortDate(r.cancelledOn) : '—'} chevron={false} />
          {outflow && <Row title="Saved so far" detail={<Money cents={s.saved ?? 0} class="pos-text" />} chevron={false} />}
          <button type="button" class="row link-row" onClick={() => setCancelled(false)}>
            Reactivate
          </button>
        </Section>
      )}
      {s.chargedAfterCancel && (
        <div class="callout danger">
          <strong>Charged after cancelling</strong>
          <p>
            {formatMoney(Math.abs(s.chargedAfterCancel.amount))} on {formatShortDate(s.chargedAfterCancel.date)}. The cancellation may not have gone
            through. Check with the company.
          </p>
        </div>
      )}

      {!cancelled && outflow && r.kind !== 'card-payment' && (
        <Section footer={link ? 'Opens the company’s website. Come back and mark it cancelled when you’re done.' : undefined}>
          {link && (
            <a class="row link-row" href={link} target="_blank" rel="noopener noreferrer">
              Cancel on {new URL(link).hostname.replace(/^www\./, '')} ↗
            </a>
          )}
          <button type="button" class="row link-row" onClick={() => setAsk('cancel')}>
            Mark as Cancelled
          </button>
        </Section>
      )}

      <Section title={`History · ${s.history.length} charge${s.history.length === 1 ? '' : 's'}`} footer={`Matches transactions containing “${r.match}”${r.matchAmount ? ` of about ${formatMoney(Math.abs(r.matchAmount))}` : ''}.`}>
        {s.history.length === 0 ? (
          <div class="row muted">No matching transactions yet.</div>
        ) : (
          s.history.slice(0, 12).map((t) => <TransactionRow txn={t} category={cats.get(t.categoryId)} account={accts.get(t.accountId)} />)
        )}
      </Section>

      <Section>
        <button type="button" class="row danger-row" onClick={() => setAsk('delete')}>
          Stop Tracking
        </button>
      </Section>

      {ask === 'cancel' && (
        <ActionSheet
          message={`Mark ${r.name} as cancelled? It stops appearing in upcoming bills, and the app tracks how much you save. If it charges again, you'll get a warning.`}
          actions={[{ label: 'Mark as Cancelled', bold: true, onClick: () => setCancelled(true) }]}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'delete' && (
        <ActionSheet
          message={`Stop tracking ${r.name}? Your transactions aren't affected.`}
          actions={[{ label: 'Stop Tracking', destructive: true, onClick: remove }]}
          onCancel={() => setAsk(null)}
        />
      )}
    </Sheet>
  );
}

