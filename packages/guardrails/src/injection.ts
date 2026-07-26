/**
 * A deterministic prompt-injection and jailbreak detector.
 *
 * This is a heuristic, pattern based screen over the raw input, not a model and
 * not a guarantee. It flags the common shapes of an attack: instruction override
 * ("ignore previous instructions"), role override ("you are now DAN"), safety
 * bypass ("disable your guardrails"), and exfiltration asks ("print your system
 * prompt"). It is intentionally conservative and explainable: every hit names the
 * pattern that matched so a reviewer can see why.
 */

/** One labelled detection pattern. */
interface InjectionPattern {
  /** Short, stable name for the shape being detected. */
  label: string;
  test: RegExp;
}

/** The pattern set. Case-insensitive; ordered from most to least common. */
const PATTERNS: InjectionPattern[] = [
  { label: "instruction_override", test: /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above)\s+(?:instructions?|prompts?|messages?|rules?)/i },
  { label: "instruction_override", test: /\bdisregard\s+(?:all\s+|the\s+|your\s+)?(?:previous|prior|above)?\s*(?:instructions?|rules?|guidelines?)/i },
  { label: "role_override", test: /\byou\s+are\s+now\b/i },
  { label: "role_override", test: /\bact\s+as\b.*\b(?:dan|jailbreak|unfiltered|no\s+restrictions?)\b/i },
  { label: "role_override", test: /\bpretend\s+(?:to\s+be|you\s+are)\b/i },
  { label: "developer_mode", test: /\bdeveloper\s+mode\b/i },
  { label: "safety_bypass", test: /\b(?:disable|bypass|turn\s+off|ignore)\b.*\b(?:safety|guardrails?|filters?|restrictions?|rules?)\b/i },
  { label: "exfiltration", test: /\b(?:reveal|show|print|repeat|display|leak|output)\b.*\b(?:system\s+prompt|initial\s+instructions?|api\s+key|secret|password|credentials?)\b/i },
  { label: "exfiltration", test: /\bwhat\s+(?:are|were)\s+your\s+(?:original\s+)?(?:instructions?|system\s+prompt)\b/i },
];

/** The outcome of an injection scan. */
export interface InjectionScan {
  hit: boolean;
  /** Distinct labels that matched, in first-seen order. */
  labels: string[];
  /** Always "heuristic": this screen is pattern based, not a model. */
  method: "heuristic";
}

/** Scan an input string for prompt-injection and jailbreak patterns. */
export function scanInjection(input: string): InjectionScan {
  const labels: string[] = [];
  for (const { label, test } of PATTERNS) {
    if (test.test(input) && !labels.includes(label)) labels.push(label);
  }
  return { hit: labels.length > 0, labels, method: "heuristic" };
}
