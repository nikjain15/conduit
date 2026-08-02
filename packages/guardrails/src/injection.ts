/**
 * A deterministic prompt-injection and jailbreak detector.
 *
 * This is a heuristic, pattern based screen over the raw input, not a model and
 * not a guarantee. It flags the common shapes of an attack: instruction override
 * ("ignore previous instructions"), role override ("you are now DAN"), safety
 * bypass ("disable your guardrails"), and exfiltration asks ("print your system
 * prompt"). It is intentionally conservative and explainable: every hit names the
 * pattern that matched so a reviewer can see why.
 *
 * Two tiers of pattern, because measurement showed one tier over blocks.
 *
 *  - Labels are the attack shapes. Some are WEAK: `developer_mode` and
 *    `role_override` match ordinary business language ("our doc has a section
 *    called Developer Mode", "you are now looking at the Q3 figures") and were
 *    responsible for the widest over reach on the golden set. The engine refuses
 *    to block on a weak label alone.
 *  - Corroborators are adversarial framing cues. They never block on their own,
 *    and they are not attack shapes in themselves. Their only job is to confirm
 *    a weak label, which is what turns "Developer Mode, please rewrite it" into
 *    an allow and "developer mode, skip the usual checks" into a block.
 *
 * Both tiers are still patterns over natural language. A novel phrasing that
 * avoids them passes, and this file should never be described as a boundary.
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

/**
 * Labels that must NOT block on their own.
 *
 * Measured, not guessed: on the 35 case golden set these two accounted for the
 * false blocks that a second signal can remove without losing a single catch
 * (`evals/README.md`). Every attack case that carries one of them also carries a
 * corroborator, so requiring corroboration costs no recall on that set.
 */
export const WEAK_LABELS: ReadonlySet<string> = new Set(["developer_mode", "role_override"]);

/**
 * Adversarial framing cues. Never sufficient to block by themselves; they exist
 * to corroborate a weak label. Kept narrow on purpose: a cue that fires on
 * ordinary business text would reintroduce the over blocking these fix.
 */
const CORROBORATORS: InjectionPattern[] = [
  // Jailbreak persona names. "DAN" is matched case-sensitively so the given name
  // "Dan" in ordinary prose does not corroborate anything.
  { label: "jailbreak_persona", test: /\bjailbreak\b/i },
  { label: "jailbreak_persona", test: /\bDAN\b/ },
  { label: "jailbreak_persona", test: /\bdo\s+anything\s+now\b/i },
  {
    label: "no_restrictions",
    test: /\b(?:unfiltered|unrestricted|no\s+(?:restrictions?|rules?|limits?|filters?)|without\s+(?:restrictions?|limits?|rules?|filters?))\b/i,
  },
  {
    label: "bypass_checks",
    test: /\b(?:skip|bypass|disable|turn\s+off|circumvent)\s+(?:the\s+|your\s+|all\s+)?(?:usual\s+|normal\s+|standard\s+)?(?:checks?|safeguards?|filters?|guardrails?|safety|restrictions?|validation|moderation|review)\b/i,
  },
  // The tell of injection arriving inside fetched or tool returned content: text
  // that asks the model to act without telling the person it is acting for.
  {
    label: "covert_instruction",
    test: /\b(?:do\s+not|don't|never)\s+(?:tell|inform|notify|mention\s+(?:this\s+)?to|reveal\s+this\s+to)\s+(?:the\s+)?(?:user|operator|human|customer)\b/i,
  },
  {
    label: "covert_instruction",
    test: /\b(?:this|the\s+following)\s+is\s+(?:an?\s+)?(?:new|updated|revised)\s+(?:system\s+)?(?:instruction|directive|prompt|rule)s?\b/i,
  },
];

/** The outcome of an injection scan. */
export interface InjectionScan {
  hit: boolean;
  /** Distinct labels that matched, in first-seen order. */
  labels: string[];
  /** Distinct corroborator labels that matched, in first-seen order. These are
   *  supporting evidence only: on their own they are not an attack shape and
   *  `hit` stays false. */
  corroborators: string[];
  /** Labels that are strong enough to act on alone (everything not in WEAK_LABELS). */
  strongLabels: string[];
  /** Always "heuristic": this screen is pattern based, not a model. */
  method: "heuristic";
}

/** Scan an input string for prompt-injection and jailbreak patterns. */
export function scanInjection(input: string): InjectionScan {
  const labels: string[] = [];
  for (const { label, test } of PATTERNS) {
    if (test.test(input) && !labels.includes(label)) labels.push(label);
  }
  const corroborators: string[] = [];
  for (const { label, test } of CORROBORATORS) {
    if (test.test(input) && !corroborators.includes(label)) corroborators.push(label);
  }
  return {
    hit: labels.length > 0,
    labels,
    corroborators,
    strongLabels: labels.filter((l) => !WEAK_LABELS.has(l)),
    method: "heuristic",
  };
}

/**
 * Is this scan strong enough to refuse on?
 *
 * Yes when a strong label fired, or when a weak label is corroborated either by
 * an adversarial cue or by a second, independent weak label. A lone weak label
 * is deliberately not enough: that is the false block fix, and it is the reason
 * `scanInjection` reports its evidence rather than a bare boolean.
 */
export function isBlockWorthy(scan: InjectionScan): boolean {
  if (!scan.hit) return false;
  if (scan.strongLabels.length > 0) return true;
  return scan.corroborators.length > 0 || scan.labels.length >= 2;
}
