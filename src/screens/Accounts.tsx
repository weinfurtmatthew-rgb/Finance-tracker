import { useMemo } from 'preact/hooks';
import { useAccounts, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account, AccountType } from '../types';
import { accountBalance, isLiability } from '../lib/balances';
import { Empty, Money, Row, Section } from '../components/ui';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from './Import';
import { Icons } from '../components/icons';

const GROUPS: { title: string; types: AccountType[]; icon: string }[] = [
  { title: 'Cash', types: ['checking', 'savings', 'cash'], icon: '🏦' },
  { title: 'Credit cards', types: ['credit'], icon: '💳' },
  { title: 'Investments', types: ['brokerage'], icon: '📈' },
  { title: 'Loans', types: ['loan'], icon: '🏠' },
  { title: 'Other', types: ['other'], icon: '📁' },
];

export function Accounts() {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const balances = useMemo(() => new Map(accounts.map((a) => [a.id, accountBalance(a, txns)])), [accounts, txns]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1);
    return m;
  }, [txns]);
  const open = accounts.filter((a) => !a.archived);
  const hidden = accounts.filter((a) => a.archived);
  const net = open.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);

  const edit = (account?: Account) => nav.present((close) => <AccountEditor account={account} onClose={close} />);
  const row = (a: Account) => {
    const b = balances.get(a.id) ?? 0;
    return (
      <Row
        title={a.name}
        subtitle={[a.institution, a.last4 && `•••• ${a.last4}`, `${counts.get(a.id) ?? 0} transactions`].filter(Boolean).join(' · ')}
        detail={<Money cents={isLiability(a) ? -b : b} class={isLiability(a) && b < 0 ? 'owed' : ''} />}
        onClick={() => edit(a)}
      />
    );
  };

  return (
    <>
      <header class="large-title">
        <h1>Accounts</h1>
        <div class="header-actions">
          <button type="button" class="icon-button" aria-label="Import a file" onClick={() => nav.present((close) => <ImportFlow onClose={close} />)}>
            {Icons.import()}
          </button>
          <button type="button" class="icon-button" aria-label="Add account" onClick={() => edit()}>
            {Icons.plus()}
          </button>
        </div>
      </header>
      {open.length === 0 ? (
        <Empty icon="🏦" title="No accounts yet">
          <p>Add your checking, credit cards and investment accounts to see your net worth.</p>
          <button type="button" class="button primary" onClick={() => edit()}>
            Add Account
          </button>
        </Empty>
      ) : (
        <>
          <div class="hero">
            <span class="card-label">Net worth</span>
            <Money cents={net} class="hero-value" />
          </div>
          {GROUPS.map((g) => {
            const items = open.filter((a) => g.types.includes(a.type));
            if (!items.length) return null;
            const total = items.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
            return (
              <Section
                title={
                  <>
                    <span>
                      {g.icon} {g.title}
                    </span>
                    <Money cents={g.types.includes('credit') || g.types.includes('loan') ? -total : total} />
                  </>
                }
              >
                {items.map(row)}
              </Section>
            );
          })}
          <p class="section-footer center">Credit cards and loans show the amount you owe.</p>
        </>
      )}
      {hidden.length > 0 && <Section title="Hidden">{hidden.map(row)}</Section>}
    </>
  );
}
