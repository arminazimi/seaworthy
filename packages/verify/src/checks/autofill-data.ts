// The HTML autofill field names (HTML Standard, "autofill") that autocomplete accepts, and the contact types allowed before some of them.

export const AUTOFILL_FIELDS: readonly string[] = [
  "name", "honorific-prefix", "given-name", "additional-name", "family-name", "honorific-suffix", "nickname",
  "username", "new-password", "current-password", "one-time-code",
  "organization-title", "organization",
  "street-address", "address-line1", "address-line2", "address-line3", "address-level1", "address-level2", "address-level3", "address-level4",
  "country", "country-name", "postal-code",
  "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type",
  "transaction-currency", "transaction-amount", "language",
  "bday", "bday-day", "bday-month", "bday-year", "sex", "url", "photo",
  "tel", "tel-country-code", "tel-national", "tel-area-code", "tel-local", "tel-extension", "email", "impp",
];

export const CONTACT_TYPES: ReadonlySet<string> = new Set(["home", "work", "mobile", "fax", "pager"]);

/** Fields a contact type (home, work, ...) may precede. */
export const CONTACT_FIELDS: ReadonlySet<string> = new Set(["tel", "tel-country-code", "tel-national", "tel-area-code", "tel-local", "tel-extension", "email", "impp"]);

/** Why an autocomplete value is not valid, with the offending token, or undefined when it is valid. */
export function autofillProblem(value: string): { token: string; reason: "unknown" | "contact" | "mixed" | "order" } | undefined {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { token: "", reason: "unknown" };
  if (tokens.length === 1 && (tokens[0] === "on" || tokens[0] === "off")) return undefined;
  if (tokens.includes("on") || tokens.includes("off")) return { token: tokens.find((t) => t === "on" || t === "off")!, reason: "mixed" };
  const rest = [...tokens];
  if (rest[rest.length - 1] === "webauthn") rest.pop();
  const field = rest.pop();
  if (field === undefined || !AUTOFILL_FIELDS.includes(field)) return { token: field ?? "", reason: "unknown" };
  // What precedes the field, in this order: section-*, shipping|billing, then a contact type.
  let i = 0;
  if (rest[i]?.startsWith("section-")) i++;
  if (rest[i] === "shipping" || rest[i] === "billing") i++;
  if (rest[i] !== undefined && CONTACT_TYPES.has(rest[i]!)) {
    if (!CONTACT_FIELDS.has(field)) return { token: rest[i]!, reason: "contact" };
    i++;
  }
  return i === rest.length ? undefined : { token: rest[i]!, reason: AUTOFILL_FIELDS.includes(rest[i]!) || CONTACT_TYPES.has(rest[i]!) || rest[i]!.startsWith("section-") || rest[i] === "shipping" || rest[i] === "billing" ? "order" : "unknown" };
}
