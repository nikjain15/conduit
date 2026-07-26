/**
 * PII masking.
 *
 * Detection is delegated to @conduit/evals' pii_scan method so the guardrails
 * engine and the eval gate agree on what counts as PII. Masking replaces the same
 * shapes pii_scan flags (email, phone, card-like digit runs) with a stable token,
 * so a redacted answer is safe to serve while staying readable.
 */

/** The masking rules, matching the shapes pii_scan detects. */
const MASKS: Array<{ pattern: RegExp; token: string }> = [
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, token: "[redacted-email]" },
  { pattern: /\b(?:\d[ -]?){13,16}\b/g, token: "[redacted-card]" },
  { pattern: /(?:\+?\d[\s-]?){10,}\d/g, token: "[redacted-phone]" },
];

/** Mask every PII match in `text`, returning the masked string and a hit count. */
export function maskPii(text: string): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const { pattern, token } of MASKS) {
    out = out.replace(pattern, () => {
      count++;
      return token;
    });
  }
  return { text: out, count };
}
