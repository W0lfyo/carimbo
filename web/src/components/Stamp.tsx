import { stampDate } from '../lib/money';

interface Props {
  at: number;
  /** Words around the ring, in the customs authority's language. */
  text?: string;
  /** Airport code in the middle. */
  port?: string;
  /** Animate the stamp hitting the paper. */
  strike?: boolean;
  size?: number;
}

/** The customs stamp: the one moment the violet appears in the product. */
export function Stamp({ at, strike = true, size = 184, text = 'ALFÂNDEGA DE LISBOA ✦ SAÍDA DA UE ✦', port = 'LIS' }: Props) {
  return (
    <div className={`stamp${strike ? ' stamp--strike' : ''}`} style={{ width: size, height: size }} role="img" aria-label={`Cleared by customs at ${port} on ${stampDate(at)}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <path id="stamp-ring" d="M100 100 m-74 0 a74 74 0 1 1 148 0 a74 74 0 1 1 -148 0" />
          <filter id="stamp-ink" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.55" result="speckle" />
            <feComposite in="SourceGraphic" in2="speckle" operator="in" />
          </filter>
        </defs>
        <g filter="url(#stamp-ink)" fill="none" stroke="currentColor">
          <circle cx="100" cy="100" r="94" strokeWidth="5" />
          <circle cx="100" cy="100" r="60" strokeWidth="2" />
          <text fill="currentColor" stroke="none" fontSize="15.5" fontWeight="700" letterSpacing="3.2" fontFamily="var(--font-sans)">
            <textPath href="#stamp-ring" startOffset="0">
              {text}
            </textPath>
          </text>
          <rect x="34" y="84" width="132" height="34" fill="var(--paper)" stroke="currentColor" strokeWidth="2.5" />
          <text x="100" y="108" textAnchor="middle" fill="currentColor" stroke="none" fontSize="22" fontWeight="700" letterSpacing="1.5" fontFamily="var(--font-sans)">
            CLEARED
          </text>
          <text x="100" y="140" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11.5" fontWeight="700" fontFamily="var(--font-mono)">
            {stampDate(at)}
          </text>
          <text x="100" y="72" textAnchor="middle" fill="currentColor" stroke="none" fontSize="12" fontWeight="700" letterSpacing="2" fontFamily="var(--font-mono)">
            {port} T1
          </text>
        </g>
      </svg>
    </div>
  );
}
