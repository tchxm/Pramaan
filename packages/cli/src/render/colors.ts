// Minimal hand-rolled ANSI color helpers — no chalk dependency, per mission.
const isTTY = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function wrap(code: string, text: string): string {
  if (!isTTY) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export const green = (s: string) => wrap("32", s);
export const amber = (s: string) => wrap("33", s);
export const red = (s: string) => wrap("31", s);
export const dim = (s: string) => wrap("2", s);
export const bold = (s: string) => wrap("1", s);
export const cyan = (s: string) => wrap("36", s);
