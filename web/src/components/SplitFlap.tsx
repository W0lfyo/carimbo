import { useEffect, useRef, useState } from 'react';

const GLYPHS = '0123456789$€£¥.,ABCDEFGHJKLMNPRSTUVWXYZ';

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Props {
  /** Final text, e.g. "$129.85". */
  value: string;
  /** Text shown before the board starts flipping, e.g. "€112.20". */
  from?: string;
  /** Start flipping when true. */
  play?: boolean;
  /** ms before the first tile moves. */
  delay?: number;
  size?: 'md' | 'lg';
  label: string;
}

/**
 * Departure-board digits. Each tile cycles through glyphs and settles left to right,
 * like a Solari board announcing a gate. Only transform/opacity are animated.
 */
export function SplitFlap({ value, from, play = true, delay = 0, size = 'lg', label }: Props) {
  const width = Math.max(value.length, from?.length ?? 0);
  const pad = (s: string) => s.padStart(width, ' ');
  const [chars, setChars] = useState<string[]>(() => pad(play ? (from ?? value) : (from ?? value)).split(''));
  const [ticks, setTicks] = useState<number[]>(() => Array(width).fill(0));
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!play) {
      setChars(pad(from ?? value).split(''));
      return;
    }
    const target = pad(value).split('');
    if (reducedMotion()) {
      setChars(target);
      return;
    }
    let step = 0;
    const settleAt = target.map((_, i) => 7 + i * 3);
    const start = window.setTimeout(() => {
      timer.current = window.setInterval(() => {
        step += 1;
        setChars((prev) =>
          prev.map((c, i) => {
            if (step >= settleAt[i]) return target[i];
            if (target[i] === ' ' && c === ' ') return ' ';
            return GLYPHS[(Math.random() * GLYPHS.length) | 0];
          }),
        );
        setTicks((prev) => prev.map((t, i) => (step <= settleAt[i] ? t + 1 : t)));
        if (step >= settleAt[settleAt.length - 1]) window.clearInterval(timer.current);
      }, 52);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, from, play, delay]);

  return (
    <div className={`flap flap--${size}`} role="img" aria-label={label}>
      {chars.map((c, i) =>
        c === '.' || c === ',' ? (
          <span key={i} className="flap__sep" aria-hidden="true">
            {c}
          </span>
        ) : (
          <span key={i} className={`flap__tile${c === ' ' ? ' flap__tile--blank' : ''}`} aria-hidden="true">
            <span key={ticks[i]} className="flap__glyph">
              {c}
            </span>
          </span>
        ),
      )}
    </div>
  );
}
