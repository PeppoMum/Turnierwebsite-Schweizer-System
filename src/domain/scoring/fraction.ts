// Exakte Bruchrechnung für Vergleiche ohne Rundungsfehler (Quotienten, Buchholz).

export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function fraction(num: number | bigint, den: number | bigint = 1): Fraction {
  let n = BigInt(num);
  let d = BigInt(den);
  if (d === 0n) throw new RangeError('Nenner darf nicht 0 sein');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { num: n / g, den: d / g };
}

export const ZERO: Fraction = fraction(0);

export function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function divide(a: Fraction, divisor: number): Fraction {
  return fraction(a.num, a.den * BigInt(divisor));
}

/** Negativ, wenn a < b; 0 bei Gleichheit; positiv, wenn a > b. */
export function compare(a: Fraction, b: Fraction): number {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function toNumber(a: Fraction): number {
  return Number(a.num) / Number(a.den);
}
