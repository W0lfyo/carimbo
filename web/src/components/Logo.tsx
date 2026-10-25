export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="14" cy="14" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 2" />
      <path d="M17.2 10.4a4.6 4.6 0 1 0 0 7.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ href = '#/' }: { href?: string }) {
  return (
    <a className="logo" href={href} aria-label="Carimbo, back to the demo">
      <LogoMark />
      <span>Carimbo</span>
    </a>
  );
}
