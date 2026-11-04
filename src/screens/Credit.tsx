import { useState } from 'preact/hooks';
import { deleteMeta, newId, setMeta } from '../db';
import { useAccounts, useBook } from '../hooks';
import { useNav } from '../nav';
import type { Account } from '../types';
import {
  BEST_USE,
  CREDIT_GOAL,
  MAX_SCORE,
  MIN_SCORE,
  OK_USE,
  creditBand,
  goalStatus,
  isScore,
  lastChange,
  nextStatementClose,
  utilization,
  type CreditScore,
} from '../lib/credit';
import { formatDate, formatShortDate, monthLabel, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { ActionSheet, Empty, Field, Row, Section, Sheet } from '../components/ui';
import { LineChart } from '../components/charts';
import { CountUp } from '../components/motion';
import { deleteScore, saveScore, useCreditGoal, useCreditScores } from '../creditModel';
import { AccountEditor } from './AccountEditor';

const whole = (c: number) => formatMoney(c, { whole: true });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const SOURCES = ['Credit Karma', 'Experian', 'Equifax', 'TransUnion', 'My bank’s app', 'My card’s app'];

/** How a share of your card limits reads: under 10% is great, under 30% good. */
const useWord = (use: number) => (use <= BEST_USE ? 'under 10%: great' : use <= OK_USE ? 'under 30%: good' : 'over 30%: paying down helps your score');

/** A meter of balances against limits. */
function UseMeter(props: { label: string; owed: number; limit: number; use: number; class?: string }) {
  return (
    <div class={`meter-row ${props.class ?? ''}`}>
      <span class="meter-head">
        <span>{props.label}</span>
        <span class="muted">
          {whole(props.owed)} of {whole(props.limit)}
        </span>
      </span>
      <span
        class="meter-track"
        role="meter"
        aria-label={`${props.label}: share of credit limits used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(props.use * 100)}
      >
        <span class="meter-fill" style={{ width: `${Math.min(100, props.use * 100)}%` }} />
      </span>
      <span class="meter-sub">
        {pct(props.use)} used · {useWord(props.use)}
      </span>
    </div>
  );
}

/** Browse → Credit Score: your score over time, a goal, and how much of your card limits you use. */
export function CreditSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const scores = useCreditScores();
  const goal = useCreditGoal();
  const book = useBook();
  const accounts = useAccounts();
  const today = todayISO();
  const latest = scores.at(-1);
  const change = lastChange(scores);
  const cards = utilization(accounts, book);
  const g = goal ? goalStatus(goal, scores, today) : null;
  const add = () => nav.present((close) => <ScoreSheet onClose={close} />);
  const editCard = (a: Account) => nav.present((close) => <AccountEditor account={a} onClose={close} />);
  const lo = Math.max(MIN_SCORE, Math.floor((Math.min(...scores.map((s) => s.score)) - 20) / 50) * 50);
  const hi = Math.min(MAX_SCORE, Math.ceil((Math.max(...scores.map((s) => s.score)) + 20) / 50) * 50);

  return (
    <Sheet title="Credit Score" onClose={props.onClose}>
      {!latest ? (
        <Empty icon="bars" title="Track your credit score">
          <p>
            Your bank or card app, Credit Karma or Experian shows it for free. Add it now and then to see how it moves; checking your own score never lowers it.
          </p>
          <button type="button" class="button primary" onClick={add}>
            Add Score
          </button>
        </Empty>
      ) : (
        <>
          <section class="card lit detail-hero-card credit-hero" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 14%, transparent)' }}>
            <span class="card-label">Credit score</span>
            <CountUp class="detail-big num" value={latest.score} format={String} />
            <span class="card-sub">
              {[
                creditBand(latest.score),
                change
                  ? `${change.change >= 0 ? '+' : '−'}${Math.abs(change.change)} since ${formatShortDate(change.since.date)}`
                  : `added ${formatShortDate(latest.date)}`,
                latest.source,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {scores.length > 1 && (
              <LineChart
                title="Credit score over time"
                dates={scores.map((s) => s.date)}
                labels={scores.map((s) => formatShortDate(s.date))}
                series={[{ name: 'Score', color: 'var(--chart-1)', values: scores.map((s) => s.score) }]}
                format={String}
                domain={[lo, hi, hi - lo > 250 ? 100 : 50]}
              />
            )}
          </section>
          <div class="button-stack">
            <button type="button" class="button" onClick={add}>
              Add Score
            </button>
          </div>
          <Section title="Goal">
            {goal && g ? (
              <>
                <div class="meter-row credit-goal">
                  <span class="meter-head">
                    <span>
                      {goal.target}
                      {goal.by ? ` by ${formatDate(goal.by)}` : ''}
                    </span>
                    <span class="muted">{g.latest} now</span>
                  </span>
                  <span
                    class="meter-track"
                    role="meter"
                    aria-label="Progress toward your score goal"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(g.progress * 100)}
                  >
                    <span class="meter-fill" style={{ width: `${g.progress * 100}%` }} />
                  </span>
                  <span class="meter-sub">
                    {g.reached
                      ? 'Reached 🎉'
                      : [
                          `${g.toGo} points to go`,
                          g.eta
                            ? `at your pace, about ${monthLabel(g.eta.slice(0, 7), { short: true })}`
                            : g.perMonth != null && g.perMonth <= 0
                              ? 'not rising lately'
                              : '',
                          g.onPace === false ? 'behind for your date' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </div>
                <button type="button" class="row link-row" onClick={() => nav.present((close) => <GoalSheet onClose={close} />)}>
                  Change Goal
                </button>
              </>
            ) : (
              <button type="button" class="row link-row" onClick={() => nav.present((close) => <GoalSheet onClose={close} />)}>
                Set a Score Goal
              </button>
            )}
          </Section>
        </>
      )}

      <Section
        title="Card use"
        footer="How much of your card limits your balances use. Under 30% helps your score, under 10% helps most. Add a card’s statement day and Today reminds you to pay before it closes, so a low balance is reported."
      >
        {cards.use != null && <UseMeter class="credit-use" label="All cards" owed={cards.owed} limit={cards.limit} use={cards.use} />}
        {cards.cards.map((c) => (
          <Row
            title={c.account.name}
            subtitle={[
              `${pct(c.use)} of ${whole(c.limit)}`,
              c.account.statementDay && `statement closes ${formatShortDate(nextStatementClose(c.account.statementDay, today))}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            detail={whole(c.owed)}
            onClick={() => editCard(c.account)}
          />
        ))}
        {cards.withoutLimit.map((a) => (
          <Row title={a.name} subtitle="Add its credit limit" onClick={() => editCard(a)} />
        ))}
        {!cards.cards.length && !cards.withoutLimit.length && <div class="row muted">Add your credit cards in Net Worth to see this.</div>}
      </Section>

      {scores.length > 0 && (
        <Section title="History">
          {[...scores].reverse().map((s) => (
            <Row
              title={formatDate(s.date)}
              subtitle={s.source ?? creditBand(s.score)}
              detail={String(s.score)}
              onClick={() => nav.present((close) => <ScoreSheet score={s} onClose={close} />)}
            />
          ))}
        </Section>
      )}
      <p class="section-footer">
        Ranges are FICO’s: 800 and up Exceptional, 740–799 Very good, 670–739 Good, 580–669 Fair, under 580 Poor. The app never checks your credit: your scores
        stay on this phone.
      </p>
    </Sheet>
  );
}

/** Add a score you saw (or change or remove one). */
export function ScoreSheet(props: { score?: CreditScore; onClose: () => void }) {
  const nav = useNav();
  const scores = useCreditScores();
  const goal = useCreditGoal();
  const today = todayISO();
  const [text, setText] = useState(props.score ? String(props.score.score) : '');
  const [date, setDate] = useState(props.score?.date ?? today);
  const [source, setSource] = useState(props.score?.source ?? scores.at(-1)?.source ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const n = Number(text);
  const valid = isScore(n) && !!date && date <= today;

  const save = async () => {
    if (!valid) return;
    const before = scores.at(-1)?.score;
    const entry: CreditScore = { id: props.score?.id ?? newId(), date, score: n, ...(source.trim() ? { source: source.trim() } : {}) };
    await saveScore(entry, scores);
    const reached = !!goal && n >= goal.target && (before == null || before < goal.target) && date >= (scores.at(-1)?.date ?? '');
    if (reached) nav.celebrate('Credit score goal reached', `${n}, up from ${goal!.from}.`);
    else nav.toast(props.score ? 'Score saved' : 'Score added');
    props.onClose();
  };
  const remove = async () => {
    await deleteScore(props.score!.id, scores);
    nav.toast('Score deleted');
    props.onClose();
  };

  return (
    <Sheet title={props.score ? 'Edit Score' : 'Add Score'} onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section footer="From wherever you check it. Scores from different places often differ a little; using the same one each time shows the trend best.">
        <Field label="Score" hint={text && !isScore(n) ? `Between ${MIN_SCORE} and ${MAX_SCORE}` : undefined}>
          <input
            inputMode="numeric"
            maxLength={3}
            value={text}
            placeholder="e.g. 720"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            autoFocus={!props.score}
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} max={today} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="From">
          <input list="score-sources" value={source} placeholder="Optional" onInput={(e) => setSource((e.target as HTMLInputElement).value)} />
          <datalist id="score-sources">
            {SOURCES.map((s) => (
              <option value={s} />
            ))}
          </datalist>
        </Field>
      </Section>
      {props.score && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setConfirmDelete(true)}>
            Delete Score
          </button>
        </Section>
      )}
      {confirmDelete && (
        <ActionSheet
          message="Delete this score?"
          actions={[{ label: 'Delete Score', destructive: true, onClick: remove }]}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}

/** A score to aim for, and when by (optional). */
export function GoalSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const scores = useCreditScores();
  const goal = useCreditGoal();
  const today = todayISO();
  const latest = scores.at(-1)?.score ?? MIN_SCORE;
  const [text, setText] = useState(goal ? String(goal.target) : String(Math.min(MAX_SCORE, Math.ceil((latest + 30) / 10) * 10)));
  const [by, setBy] = useState(goal?.by ?? '');
  const n = Number(text);
  const valid = isScore(n) && n > latest && (!by || by > today);

  const save = async () => {
    if (!valid) return;
    // A changed goal keeps where you started, so the progress bar still shows how far you've come.
    await setMeta(CREDIT_GOAL, { target: n, ...(by ? { by } : {}), from: goal?.from ?? latest, setOn: goal?.setOn ?? today });
    nav.toast('Goal saved');
    props.onClose();
  };
  const remove = async () => {
    await deleteMeta(CREDIT_GOAL);
    nav.toast('Goal removed');
    props.onClose();
  };

  return (
    <Sheet title="Score Goal" onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section footer={`Your latest score is ${latest} (${creditBand(latest)}). Paying on time and keeping card balances low are what raise it.`}>
        <Field label="Goal" hint={text && isScore(n) && n <= latest ? 'Pick a score above your latest one' : undefined}>
          <input inputMode="numeric" maxLength={3} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} autoFocus />
        </Field>
        <Field label="By" hint="Optional">
          <input type="date" value={by} min={today} onInput={(e) => setBy((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      {goal && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => void remove()}>
            Remove Goal
          </button>
        </Section>
      )}
    </Sheet>
  );
}
