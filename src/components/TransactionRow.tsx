import type { Account, Category, Transaction } from '../types';
import { useNav } from '../nav';
import { CategoryIcon, Money } from './ui';
import { TransactionEditor } from '../screens/TransactionEditor';

export function TransactionRow(props: { txn: Transaction; category?: Category; account?: Account; showDate?: boolean }) {
  const nav = useNav();
  const { txn } = props;
  const transfer = props.category?.group === 'transfer';
  return (
    <button type="button" class="row txn-row" onClick={() => nav.present((close) => <TransactionEditor txn={txn} onClose={close} />)}>
      <CategoryIcon category={props.category} />
      <span class="row-main">
        <span class="row-title">{txn.payee || txn.description}</span>
        <span class="row-subtitle">
          {txn.categorySource === 'ai' && <span title="Categorized by on-device AI, not reviewed yet">✨ </span>}
          {props.category?.name ?? 'Uncategorized'}
          {props.account ? ` · ${props.account.name}` : ''}
        </span>
      </span>
      <span class={`row-detail ${transfer ? 'muted' : ''}`}>
        <Money cents={txn.amount} colored />
      </span>
    </button>
  );
}
