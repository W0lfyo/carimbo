import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  value: string;
  size?: number;
  label: string;
}

/** A real, scannable QR code rendered as inline SVG (generated locally, no network). */
export function QR({ value, size = 200, label }: Props) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#16181d', light: '#ffffff' } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div className="qr" style={{ width: size, height: size }} role="img" aria-label={label}>
      {svg ? <span className="qr__svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="qr__loading" />}
    </div>
  );
}
