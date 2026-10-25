import type { TaxFreeRules } from '../lib/taxFreeRules';

/** Where the rules come from, and a warning when they still need confirming. */
export function RulesNote({ rules, compact = false }: { rules: TaxFreeRules; compact?: boolean }) {
  return (
    <span className={`rules-note${compact ? ' rules-note--compact' : ''}`}>
      {!rules.verified && (
        <span className="rules-note__flag" role="note">
          Rules to be confirmed: {rules.name}’s figures come from a single secondary source.
        </span>
      )}
      <span className="rules-note__src">
        Rules:{' '}
        {rules.sources.map((src, i) => (
          <span key={src}>
            {i > 0 && ', '}
            <a href={src} target="_blank" rel="noreferrer">
              source{rules.sources.length > 1 ? ` ${i + 1}` : ''}
            </a>
          </span>
        ))}
      </span>
    </span>
  );
}
