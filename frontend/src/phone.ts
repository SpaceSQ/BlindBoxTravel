/** 美国 10 位号码，或原有的 11 位、以 1 开头的号码。 */
const ACCEPTED = /^(?:1\d{10}|[2-9]\d{9})$/;

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function isAcceptedPhone(value: string): boolean {
  return ACCEPTED.test(normalizePhone(value));
}
