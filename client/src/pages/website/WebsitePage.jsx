import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DealsEditor from './DealsEditor';
import WebsiteRequests from './WebsiteRequests';
import CalculatorPricing from './CalculatorPricing';

const TABS = ['Latest Deals', 'Calculator Pricing', 'Change Requests'];

export default function WebsitePage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || TABS[0]);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Website</h1>
        <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Manage what dekkerair.co.nz shows, and keep a list of changes to make
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 22, borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none',
              color: tab === t ? 'var(--color-text)' : 'var(--color-text-muted)',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Latest Deals' && <DealsEditor />}
      {tab === 'Calculator Pricing' && <CalculatorPricing />}
      {tab === 'Change Requests' && <WebsiteRequests />}
    </div>
  );
}
