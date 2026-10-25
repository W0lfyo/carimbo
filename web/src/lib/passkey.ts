/**
 * Passkey check before the traveller signs anything: Face ID, Touch ID, Windows Hello
 * or the phone's fingerprint, through WebAuthn. The first time, a passkey is created on
 * this device; afterwards the same passkey must be confirmed.
 *
 * In this demo the passkey unlocks the traveller's Testnet key held by the app. In
 * production it would be the signer of a Stellar smart account (secp256r1, verified
 * on-chain), so no secret key would exist at all.
 */

const KEY = 'carimbo.passkey.v1';

function random(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Resolved once on load, so the click handler can call WebAuthn immediately (Safari needs the user gesture). */
let available = false;
export const passkeyReady: Promise<boolean> = (async () => {
  try {
    available = !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    available = false;
  }
  return available;
})();

export const hasPasskeyDevice = () => available;

/** What the device calls its biometric check, for the button label. */
export function biometricName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Android/.test(ua)) return 'your fingerprint';
  return 'your passkey';
}

export class PasskeyCancelled extends Error {}

/**
 * Ask the device to verify the traveller. Resolves when verified, or immediately when
 * this device has no platform authenticator (the demo still works there).
 */
export async function verifyTraveller(displayName: string): Promise<'verified' | 'skipped'> {
  if (!available) return 'skipped';
  const challenge = random(32);
  const id = stored();
  try {
    if (!id) {
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { name: 'Carimbo' },
          user: { id: random(16), name: `${displayName.toLowerCase().replace(/\s+/g, '.')}@carimbo`, displayName },
          challenge,
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 }, // ES256, the curve Stellar verifies on-chain (secp256r1)
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new PasskeyCancelled('No passkey was created.');
      try {
        localStorage.setItem(KEY, b64(cred.rawId));
      } catch {
        /* the passkey still exists; next time the device offers it */
      }
    } else {
      const got = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal', 'hybrid'] }],
          userVerification: 'required',
          timeout: 60_000,
        },
      });
      if (!got) throw new PasskeyCancelled('The passkey was not confirmed.');
    }
    return 'verified';
  } catch (e) {
    if (e instanceof PasskeyCancelled) throw e;
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' && id) {
      // Cancelled, or the passkey was removed from the device: the next try creates a fresh one.
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelled(`${biometricName()} was cancelled. Try again when you are ready.`);
    // Passkeys blocked here (an embedded preview, a policy): carry on without it.
    if (name === 'SecurityError' || name === 'NotSupportedError') return 'skipped';
    throw e;
  }
}
