/** Hostinger passes port via `npm start -- -p $PORT`, not always via PORT env. */
export function resolvePort(): number {
  const flag = process.argv.indexOf("-p");
  if (flag >= 0) {
    const fromArg = Number(process.argv[flag + 1]);
    if (Number.isFinite(fromArg) && fromArg > 0) return fromArg;
  }

  const fromEnv = Number(process.env.PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  return 3000;
}
