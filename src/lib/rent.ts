/**
 * Rent calculator: what cheap, acceptable and expensive rent looks like for you, from % of income
 * rules checked against your real budget, with roommates splitting the rent (and optionally the
 * utilities), plus the landlord's usual income check.
 */
import type { Cents } from '../types';

/** % of take-home pay rules for your share of housing costs. */
export const CHEAP_SHARE = 0.25;
export const ACCEPTABLE_SHARE = 0.3;
/** Cheap also leaves this much of take-home on top of your savings goal, as a cushion. */
export const CHEAP_CUSHION = 0.1;
/** Landlords usually want yearly gross income of at least 40× the monthly rent. */
export const LANDLORD_MULTIPLE = 40;

export type RentTier = 'cheap' | 'acceptable' | 'expensive';

export interface RentInputs {
  /** Monthly take-home pay. */
  takeHome: Cents;
  /** Everything else you spend per month (not rent). */
  otherCosts: Cents;
  /** What you want to save per month. */
  savingsGoal: Cents;
  /** People sharing the place, you included (1 = just you). */
  people: number;
  /** Count utilities and extras as part of housing. */
  includeExtras: boolean;
  /** Utilities for the whole place (electric, gas, water, internet). */
  utilities: Cents;
  /** Split utilities with roommates (otherwise you pay them all). */
  splitUtilities: boolean;
  /** Your own extras: renter's insurance, parking, fees. */
  personalExtras: Cents;
  /** Your gross yearly salary, for the landlord check (0 = not given). */
  grossYearly: Cents;
}

export interface RentLimits {
  /** Your monthly housing cost (your share of rent + extras) at the top of each tier. */
  cheapMax: Cents;
  acceptableMax: Cents;
  /** Most your housing can cost while still saving your whole goal (can be ≤ 0). */
  budgetRoom: Cents;
  /** What sets the acceptable limit: the 30% rule, or your budget (it's lower). */
  limitedBy: 'rule' | 'budget';
  /** Your extras per month, on top of your rent share. */
  extrasShare: Cents;
  /** The whole place's rent at the top of each tier (your share × people). */
  cheapRent: Cents;
  acceptableRent: Cents;
  /** The landlord check: most rent you'd qualify for on your own income, and for the whole place. */
  landlordMax?: Cents;
  landlordMaxPlace?: Cents;
}

const clamp0 = (c: Cents) => Math.max(0, Math.round(c));
const people = (i: Pick<RentInputs, 'people'>) => Math.max(1, Math.round(i.people) || 1);

/** Your extras per month: your part of the utilities, plus your own insurance, parking and fees. */
export function extrasShare(i: RentInputs): Cents {
  if (!i.includeExtras) return 0;
  return Math.round((i.splitUtilities ? i.utilities / people(i) : i.utilities) + i.personalExtras);
}

/** Your monthly housing cost for a place with this total rent. */
export function yourCost(i: RentInputs, rent: Cents): Cents {
  return Math.round(rent / people(i)) + extrasShare(i);
}

/** The total rent for a place where your monthly housing cost is `cost`. */
export function rentFor(i: RentInputs, cost: Cents): Cents {
  return clamp0((cost - extrasShare(i)) * people(i));
}

export function rentLimits(i: RentInputs): RentLimits {
  const budgetRoom = Math.round(i.takeHome - i.otherCosts - i.savingsGoal);
  const ruleCheap = i.takeHome * CHEAP_SHARE;
  const ruleAcceptable = i.takeHome * ACCEPTABLE_SHARE;
  const acceptableMax = clamp0(Math.min(ruleAcceptable, budgetRoom));
  const cheapMax = clamp0(Math.min(ruleCheap, budgetRoom - i.takeHome * CHEAP_CUSHION, acceptableMax));
  const extras = extrasShare(i);
  const landlordMax = i.grossYearly > 0 ? Math.floor(i.grossYearly / LANDLORD_MULTIPLE) : undefined;
  return {
    cheapMax,
    acceptableMax,
    budgetRoom,
    limitedBy: budgetRoom < ruleAcceptable ? 'budget' : 'rule',
    extrasShare: extras,
    cheapRent: rentFor(i, cheapMax),
    acceptableRent: rentFor(i, acceptableMax),
    landlordMax,
    // Landlords often check each roommate against their own share of the rent.
    landlordMaxPlace: landlordMax != null ? landlordMax * people(i) : undefined,
  };
}

export function tierFor(limits: Pick<RentLimits, 'cheapMax' | 'acceptableMax'>, cost: Cents): RentTier {
  if (cost <= limits.cheapMax) return 'cheap';
  if (cost <= limits.acceptableMax) return 'acceptable';
  return 'expensive';
}

export interface RentCheck {
  tier: RentTier;
  /** Your monthly housing cost for this place. */
  cost: Cents;
  rentShare: Cents;
  /** Share of take-home pay. */
  ofTakeHome: number;
  /** Left each month after housing and your other costs (before saving). */
  leftOver: Cents;
  /** What you'd actually be able to save (up to your goal). */
  saves: Cents;
  /** How far short of your savings goal (0 when it fits). */
  savingsShort: Cents;
  /** Passes the landlord's income check; undefined without a salary. */
  landlordOk?: boolean;
}

/** Check a listing: how its rent fits your money. */
export function checkRent(i: RentInputs, rent: Cents, limits = rentLimits(i)): RentCheck {
  const cost = yourCost(i, rent);
  const rentShare = Math.round(rent / people(i));
  const leftOver = Math.round(i.takeHome - i.otherCosts - cost);
  const saves = Math.max(0, Math.min(i.savingsGoal, leftOver));
  return {
    tier: tierFor(limits, cost),
    cost,
    rentShare,
    ofTakeHome: i.takeHome > 0 ? cost / i.takeHome : Infinity,
    leftOver,
    saves,
    savingsShort: Math.max(0, i.savingsGoal - Math.max(0, leftOver)),
    landlordOk: limits.landlordMax != null ? rentShare <= limits.landlordMax : undefined,
  };
}
