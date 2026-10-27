export type VisaRequirement = "restricted" | "open" | "unknown";

export type VisaClassification = {
  requirement: VisaRequirement;
  // true when the text mentions citizenship/PR but the rules can't settle it
  needsReview: boolean;
};

const stripHtml = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");

// Sentences that talk about citizenship, residency or security clearance.
const TOPIC =
  /\b(citizens?|citizenship|permanent resident(?:s|cy)?|permanent residence|pr|nv[12]|negative vetting|positive vetting|baseline (?:security )?clearance|agsva|security clearance)\b/;

// The topic is mentioned, but the job is open to non-citizens.
const OPEN_PATTERNS = [
  /\b(?:no|not|without|neither|nor)\b[^.]{0,50}\b(?:citizens?|citizenship|permanent resident(?:s|cy)?|pr|residency)\b/,
  /\b(?:citizens?|citizenship|permanent resident(?:s|cy)?|pr|residency)\b[^.]{0,40}\b(?:is|are)?\s*(?:not|n't)\s*(?:required|necessary|essential|needed|mandatory)\b/,
  /\bregardless of (?:your )?(?:citizenship|residency|visa|nationality|immigration status)\b/,
  /\birrespective of (?:your )?(?:citizenship|residency|visa|nationality|immigration status)\b/,
  /\b(?:open|available) to (?:all |any )?(?:visa holders|non[- ]citizens|international (?:candidates|applicants))\b/,
  /\b(?:visa )?sponsorship (?:is |may be )?(?:available|provided|offered|supported)\b/,
  /\b(?:we |will |can |able to )(?:offer |provide |support )?(?:visa )?sponsor(?:ship)?\b[^.]{0,30}\b(?:eligible|suitable|right|successful|candidates?)\b/,
  /\bwill sponsor\b/,
];

// The topic is mentioned as a hard requirement.
const RESTRICTED_PATTERNS = [
  /\b(?:must|need to|needs to|required to|have to|has to|should)\b[^.]{0,70}\b(?:be|hold|have|obtain|maintain)\b[^.]{0,50}\b(?:citizens?|citizenship|permanent resident(?:s|cy)?|pr)\b/,
  /\b(?:must|need to|needs to|required to|have to|has to)\b[^.]{0,70}\b(?:australian|aus|nz|new zealand) (?:citizens?|citizenship)\b/,
  /\b(?:citizens?|citizenship|permanent resident(?:s|cy)?|pr)\b[^.]{0,40}\b(?:only|required|essential|mandatory|necessary)\b/,
  /\b(?:only|exclusively)\b[^.]{0,40}\b(?:citizens?|citizenship|permanent resident(?:s|cy)?|pr)\b/,
  /\b(?:australian|nz|new zealand) citizens?\b[^.]{0,25}(?:,|\/| or | and )[^.]{0,25}\b(?:permanent resident(?:s|cy)?|pr)\b/,
  /\b(?:eligible|able|ability|eligibility) to (?:obtain|hold|maintain|gain)\b[^.]{0,40}\b(?:clearance|nv[12]|vetting)\b/,
  /\b(?:hold|holding|current|existing|obtain)\b[^.]{0,30}\b(?:nv[12]|negative vetting|positive vetting|baseline (?:security )?clearance|security clearance)\b/,
  /\b(?:nv[12]|negative vetting|positive vetting|baseline (?:security )?clearance|agsva)\b[^.]{0,30}\b(?:required|essential|mandatory)\b/,
];

const splitSentences = (text: string) =>
  text
    .split(/[.!?;\n\u2022\u00b7]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

export const classifyVisaByRules = (title: string | null | undefined, description: string | null | undefined): VisaClassification => {
  const text = stripHtml(`${title ?? ""}. ${description ?? ""}`).toLowerCase();
  const sentences = splitSentences(text);

  let restricted = 0;
  let open = 0;
  let unclear = 0;

  for (const sentence of sentences) {
    const hasTopic = TOPIC.test(sentence);
    const isOpen = OPEN_PATTERNS.some((pattern) => pattern.test(sentence));

    if (isOpen) {
      open += 1;
      continue;
    }

    if (!hasTopic) {
      continue;
    }

    if (RESTRICTED_PATTERNS.some((pattern) => pattern.test(sentence))) {
      restricted += 1;
    } else {
      unclear += 1;
    }
  }

  if (restricted && open) {
    return { requirement: "unknown", needsReview: true };
  }

  if (restricted) {
    return { requirement: "restricted", needsReview: false };
  }

  if (open) {
    return { requirement: "open", needsReview: false };
  }

  if (unclear) {
    return { requirement: "unknown", needsReview: true };
  }

  return { requirement: "unknown", needsReview: false };
};
