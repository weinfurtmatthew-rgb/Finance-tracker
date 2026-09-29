import { useEffect, useState } from 'preact/hooks';
import { Section, Segmented, Sheet, Toggle } from '../../components/ui';
import { useMeta } from '../../hooks';
import { setMeta } from '../../db';
import type { Cents } from '../../types';
import { ACCEPTABLE_SHARE, CHEAP_SHARE, LANDLORD_MULTIPLE, checkRent, rentLimits, type RentCheck, type RentInputs, type RentLimits, type RentTier } from '../../lib/rent';
import type { PlanData } from '../../planModel';
import { Answer, CountField, DISCLAIMER, MoneyField, Stat, money, monthsRange, pct, tile, useCount, useMoney, type Status } from './common';

const TIER: Record<RentTier, { label: string; status: Status; icon: string }> = {
  cheap: { label: 'Cheap', status: 'good', icon: '✓' },
  acceptable: { label: 'Acceptable', status: 'warning', icon: '!' },
  expensive: { label: 'Expensive', status: 'critical', icon: '✕' },
};

/** Monthly take-home minus today's rent: what everything else costs. */
export const otherCostsFrom = (d: Pick<PlanData, 'monthlySpending' | 'monthlyHousing'>) => Math.max(0, d.monthlySpending - d.monthlyHousing);

/** The default monthly savings goal: 20% of take-home (the "50/30/20" rule of thumb). */
export const defaultSavingsGoal = (takeHome: Cents) => Math.round((takeHome * 0.2) / 100) * 100;

/** What cheap, acceptable and expensive rent looks like for you, with roommates and a landlord check. */
export function RentCalc(props: { data: PlanData; onClose: () => void }) {
  const d = props.data;
  const [takeHome, takeHomeText, setTakeHome] = useMoney(d.monthlyIncome);
  const [other, otherText, setOther] = useMoney(otherCostsFrom(d));
  const [goal, goalText, setGoal] = useMoney(defaultSavingsGoal(d.monthlyIncome));
  const [peopleCount, peopleText, setPeople] = useCount(1, 12);
  const [includeExtras, setIncludeExtras] = useState(true);
  const [utilities, utilitiesText, setUtilities] = useMoney(0);
  const [splitUtilities, setSplitUtilities] = useState(true);
  const [personal, personalText, setPersonal] = useMoney(0);
  const [listing, listingText, setListing] = useMoney(0);
  // Your salary is remembered (it rarely changes and isn't in your bank data).
  const savedGross = useMeta<number>('grossYearly');
  const [gross, grossText, setGrossText] = useMoney(0);
  useEffect(() => {
    if (savedGross && !grossText) setGrossText(String(Math.round(savedGross / 100)));
  }, [savedGross]);
  const setGross = (v: string) => {
    setGrossText(v);
    const n = Math.round((parseFloat(v.replace(/[$,\s]/g, '')) || 0) * 100);
    void setMeta('grossYearly', n);
  };
  const people = Math.max(1, peopleCount);
  const [view, setView] = useState<'share' | 'place'>('share');

  const inputs: RentInputs = { takeHome, otherCosts: other, savingsGoal: goal, people, includeExtras, utilities, splitUtilities, personalExtras: personal, grossYearly: gross };
  const limits = rentLimits(inputs);
  const check = listing > 0 ? checkRent(inputs, listing, limits) : undefined;
  const shared = people > 1;
  const extrasNote = limits.extrasShare > 0 ? ` + ${money(limits.extrasShare)} extras` : '';

  return (
    <Sheet title="Rent" onClose={props.onClose}>
      {takeHome <= 0 ? (
        <Answer label="Acceptable rent" value="—" sub="Enter your take-home pay below to see your ranges." />
      ) : check ? (
        <Answer
          label={`A ${money(listing)} place${shared ? ` with ${people} people` : ''}`}
          value={TIER[check.tier].label}
          sub={
            <>
              You'd pay {money(check.cost)} a month{shared ? ` (${money(check.rentShare)} rent${extrasNote})` : extrasNote ? ` (rent${extrasNote})` : ''}, {pct(check.ofTakeHome, 0)} of
              take-home.{' '}
              {check.savingsShort > 0
                ? check.saves > 0
                  ? `You could save ${money(check.saves)} a month, ${money(check.savingsShort)} short of your goal.`
                  : `Your costs would be ${money(-check.leftOver)} more than you take home.`
                : `You'd still save your ${money(goal)} goal, with ${money(check.leftOver - goal)} to spare.`}
            </>
          }
          status={TIER[check.tier].status}
          statusText={
            check.tier === 'cheap'
              ? 'Cheap: plenty of room'
              : check.tier === 'acceptable'
                ? 'Acceptable: fits your budget'
                : check.savingsShort > 0
                  ? 'Expensive: cuts into your savings'
                  : 'Expensive: over the usual 30%'
          }
        />
      ) : (
        <Answer
          label={shared ? 'Your share: acceptable up to' : 'Acceptable rent: up to'}
          value={limits.acceptableMax > 0 ? `${money(limits.acceptableMax)}/mo` : '—'}
          sub={
            limits.acceptableMax <= 0
              ? 'Your other costs and savings goal already use your take-home. Lower the goal or costs to see a range.'
              : shared
                ? `With ${people} people, a place up to ${money(limits.acceptableRent)} a month${limits.extrasShare ? ' (rent, before extras)' : ''}.`
                : limits.extrasShare
                  ? `That's ${money(limits.acceptableRent)} rent + ${money(limits.extrasShare)} extras.`
                  : 'Type a listing below to check a place.'
          }
        />
      )}

      {takeHome > 0 && limits.acceptableMax > 0 && (
        <>
          {shared && (
            <div class="plan-block">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'share', label: 'Your share' },
                  { value: 'place', label: 'Whole place' },
                ]}
              />
            </div>
          )}
          <RentBand limits={limits} check={check} listing={listing} view={shared ? view : 'share'} />
          <Section
            title="Your ranges"
            footer={
              limits.limitedBy === 'budget'
                ? `Your budget, not the ${pct(ACCEPTABLE_SHARE, 0)} rule, sets the limit: after ${money(other)} of other costs and saving ${money(goal)}, ${money(Math.max(0, limits.budgetRoom))} is left for housing.`
                : `Cheap is up to ${pct(CHEAP_SHARE, 0)} of take-home and leaves a cushion on top of saving ${money(goal)}; acceptable is up to ${pct(ACCEPTABLE_SHARE, 0)} while still saving your goal.`
            }
          >
            <RangeRow tier="cheap" share={`up to ${money(limits.cheapMax)}`} place={shared ? `place up to ${money(limits.cheapRent)}` : undefined} />
            <RangeRow
              tier="acceptable"
              share={`${money(limits.cheapMax)}–${money(limits.acceptableMax)}`}
              place={shared ? `place ${money(limits.cheapRent)}–${money(limits.acceptableRent)}` : undefined}
            />
            <RangeRow tier="expensive" share={`over ${money(limits.acceptableMax)}`} place={shared ? `place over ${money(limits.acceptableRent)}` : undefined} />
          </Section>
        </>
      )}

      {takeHome > 0 && <TakeHomeBar takeHome={takeHome} other={other} goal={goal} cost={check?.cost ?? limits.acceptableMax} forListing={!!check} />}

      <Section title="Check a place" footer={shared ? 'The whole place’s rent: it’s split evenly between everyone.' : undefined}>
        <MoneyField label="Listing rent / mo" value={listingText} set={setListing} />
      </Section>

      <Section title="Roommates & extras">
        <CountField label="People" unit={people === 1 ? 'just you' : 'sharing'} value={peopleText} set={setPeople} hint="Everyone living there, you included. Rent is split evenly." />
        <Toggle checked={includeExtras} onChange={setIncludeExtras} label="Include utilities & extras" />
        {includeExtras && (
          <>
            <MoneyField label="Utilities / mo" value={utilitiesText} set={setUtilities} hint="For the whole place: electric, gas, water, internet" />
            {shared && <Toggle checked={splitUtilities} onChange={setSplitUtilities} label="Split utilities too" />}
            <MoneyField label="Your extras / mo" value={personalText} set={setPersonal} hint="Renter's insurance, parking, pet rent, fees" />
          </>
        )}
      </Section>

      <Section title="Landlord check" footer={`Many landlords want a yearly gross income of ${LANDLORD_MULTIPLE}× the monthly rent (often checked per roommate, for their share). Your salary is saved on this phone.`}>
        <MoneyField label="Gross salary / yr" value={grossText} set={setGross} hint="Before taxes" />
      </Section>
      {limits.landlordMax != null && (
        <div class="kpis two">
          <Stat label={shared ? 'Your share, max' : 'Max rent'} value={tile(limits.landlordMax)} sub={`on ${money(gross)} a year`} />
          {shared ? (
            <Stat label="Whole place, max" value={tile(limits.landlordMaxPlace!)} sub="if roommates earn about the same" />
          ) : (
            <Stat label="Budget says" value={tile(limits.acceptableRent)} sub={limits.landlordMax < limits.acceptableRent ? 'landlords will allow less' : 'the lower of the two'} />
          )}
        </div>
      )}
      {check?.landlordOk === false && (
        <p class="plan-note">
          <strong>Heads up:</strong> {money(check.rentShare)} {shared ? 'is more than your share can be' : 'is more than landlords usually approve'} on a {money(gross)} salary ({money(limits.landlordMax!)} max). A co-signer or guarantor may be needed.
        </p>
      )}
      {check?.landlordOk && check.tier === 'expensive' && (
        <p class="plan-note">Landlords would approve this, but it's more than your budget comfortably allows.</p>
      )}

      <Section title="Your numbers" footer={DISCLAIMER}>
        <MoneyField label="Take-home / mo" value={takeHomeText} set={setTakeHome} hint={`Average of ${monthsRange(d.averagedMonths)}, after taxes`} />
        <MoneyField
          label="Other costs / mo"
          value={otherText}
          set={setOther}
          hint={d.monthlyHousing > 0 ? `Your spending without today's rent (${money(d.monthlyHousing)})` : 'Bills, groceries, everything but rent'}
        />
        <MoneyField label="Save / mo" value={goalText} set={setGoal} hint="Your savings goal; 20% of take-home is a common target" />
      </Section>
    </Sheet>
  );
}

function RangeRow(props: { tier: RentTier; share: string; place?: string }) {
  const t = TIER[props.tier];
  return (
    <div class="row rent-range-row">
      <span class={`rent-key ${t.status}`} aria-hidden="true">
        {t.icon}
      </span>
      <span class="row-main">
        <span class="row-title">{t.label}</span>
        {props.place && <span class="row-subtitle">{props.place}</span>}
      </span>
      <span class="row-detail">{props.share}/mo</span>
    </div>
  );
}

/**
 * The three zones on one scale, with this place and the landlord's limit marked. Tap or hover a zone
 * for its range.
 */
function RentBand(props: { limits: RentLimits; check?: RentCheck; listing: Cents; view: 'share' | 'place' }) {
  const { limits: l, check, view } = props;
  const place = view === 'place';
  const cheap = place ? l.cheapRent : l.cheapMax;
  const ok = place ? l.acceptableRent : l.acceptableMax;
  const mark = check ? (place ? props.listing : check.cost) : undefined;
  const landlord = place ? l.landlordMaxPlace : l.landlordMax;
  const max = Math.max(ok * 1.5, (mark ?? 0) * 1.12, (landlord ?? 0) * 1.08, 1);
  const x = (v: Cents) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`;
  const [focus, setFocus] = useState<RentTier | null>(null);
  const zones: { tier: RentTier; from: Cents; to: Cents }[] = [
    { tier: 'cheap', from: 0, to: cheap },
    { tier: 'acceptable', from: cheap, to: ok },
    { tier: 'expensive', from: ok, to: max },
  ];
  const describe = (z: (typeof zones)[number]) =>
    z.tier === 'cheap' ? `Cheap: up to ${money(z.to)}` : z.tier === 'acceptable' ? `Acceptable: ${money(z.from)}–${money(z.to)}` : `Expensive: over ${money(z.from)}`;
  const readout = focus
    ? describe(zones.find((z) => z.tier === focus)!)
    : mark != null
      ? `This place: ${money(mark)}${place ? ' rent' : ' a month for you'}`
      : place
        ? 'Whole-place rent'
        : 'Your monthly housing cost';
  return (
    <figure class="chart rent-band" aria-label={`Rent ranges ${place ? 'for the whole place' : 'for your share'}: ${zones.map(describe).join('; ')}`}>
      <p class="rent-readout" aria-live="polite">
        {readout}
      </p>
      <div class="rent-track-wrap">
        <div class="rent-track">
          {zones.map((z) => (
            <button
              type="button"
              class={`rent-zone ${TIER[z.tier].status} ${focus && focus !== z.tier ? 'dim' : ''}`}
              style={{ width: `calc(${x(z.to - z.from)} - 2px)` }}
              aria-label={describe(z)}
              onPointerEnter={() => setFocus(z.tier)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(z.tier)}
              onBlur={() => setFocus(null)}
              onClick={() => setFocus(focus === z.tier ? null : z.tier)}
            >
              <span class="rent-zone-label" aria-hidden="true">
                {TIER[z.tier].icon}
                {(z.to - z.from) / max >= 0.24 ? ` ${TIER[z.tier].label}` : ''}
              </span>
            </button>
          ))}
          {landlord != null && landlord > 0 && (
            <span class="rent-landlord" style={{ left: x(landlord) }} title={`Landlord limit: ${money(landlord)}`} aria-hidden="true" />
          )}
          {mark != null && <span class="rent-marker" style={{ left: x(mark) }} aria-hidden="true" />}
          {mark != null && <span class="rent-pin" style={{ left: x(mark) }} aria-hidden="true" />}
        </div>
        <div class="rent-ticks" aria-hidden="true">
          <span style={{ left: '0%' }}>$0</span>
          <span style={{ left: x(cheap) }}>{tile(cheap)}</span>
          <span style={{ left: x(ok) }}>{tile(ok)}</span>
        </div>
      </div>
      <figcaption class="legend">
        {mark != null && (
          <span>
            <i class="rent-key-marker" /> This place
          </span>
        )}
        {landlord != null && landlord > 0 && (
          <span>
            <i class="rent-key-landlord" /> Landlord limit {tile(landlord)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Where take-home pay goes each month at this rent: housing, everything else, saving, left over. */
function TakeHomeBar(props: { takeHome: Cents; other: Cents; goal: Cents; cost: Cents; forListing: boolean }) {
  const { takeHome, other, cost } = props;
  const leftAfter = takeHome - other - cost;
  const saves = Math.max(0, Math.min(props.goal, leftAfter));
  const spare = Math.max(0, leftAfter - saves);
  const short = Math.max(0, -leftAfter);
  const total = Math.max(takeHome, cost + other);
  const parts = [
    { key: 'housing', name: 'Housing', value: cost, color: 'var(--chart-1)' },
    { key: 'other', name: 'Everything else', value: other, color: 'var(--chart-2)' },
    { key: 'save', name: 'Saving', value: saves, color: 'var(--chart-3)' },
    { key: 'spare', name: 'Left over', value: spare, color: 'var(--chart-deemph)' },
  ].filter((p) => p.value > 0);
  const [focus, setFocus] = useState<string | null>(null);
  const f = parts.find((p) => p.key === focus);
  return (
    <figure class="chart takehome" aria-label={`Take-home ${money(takeHome)}: ${parts.map((p) => `${p.name} ${money(p.value)}`).join(', ')}${short ? `, short ${money(short)}` : ''}`}>
      <p class="rent-readout" aria-live="polite">
        {f ? `${f.name}: ${money(f.value)} (${pct(f.value / takeHome, 0)})` : `Your ${money(takeHome)} take-home ${props.forListing ? 'at this rent' : 'at the acceptable limit'}`}
      </p>
      <div class="takehome-bar">
        {parts.map((p) => (
          <button
            type="button"
            class={`takehome-part ${focus && focus !== p.key ? 'dim' : ''}`}
            style={{ width: `calc(${(p.value / total) * 100}% - 2px)`, background: p.color }}
            aria-label={`${p.name}: ${money(p.value)}`}
            onPointerEnter={() => setFocus(p.key)}
            onPointerLeave={() => setFocus(null)}
            onFocus={() => setFocus(p.key)}
            onBlur={() => setFocus(null)}
            onClick={() => setFocus(focus === p.key ? null : p.key)}
          />
        ))}
        {short > 0 && <span class="takehome-limit" style={{ left: `${(takeHome / total) * 100}%` }} aria-hidden="true" />}
      </div>
      <figcaption class="legend takehome-legend">
        {parts.map((p) => (
          <span>
            <i class="key-rect" style={{ background: p.color }} /> {p.name} <strong>{money(p.value)}</strong>
          </span>
        ))}
        {short > 0 && (
          <span>
            <i class="rent-key-landlord" /> Short <strong>{money(short)}</strong>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
