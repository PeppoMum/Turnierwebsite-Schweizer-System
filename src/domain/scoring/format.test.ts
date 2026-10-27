import { add, compare, fraction } from './fraction';
import { formatGoalDiff, formatQuotient } from './format';

describe('formatQuotient', () => {
  it.each([
    [17, 7, '2,429'],
    [18, 8, '2,250'],
    [3, 1, '3,000'],
    [0, 4, '0,000'],
    [2, 3, '0,667'],
    [1, 3, '0,333'],
    [5, 8, '0,625'],
  ])('%i Punkte aus %i Spielen -> %s', (points, played, expected) => {
    expect(formatQuotient(points, played)).toBe(expected);
  });

  it('zeigt „–“ bei 0 Spielen', () => {
    expect(formatQuotient(0, 0)).toBe('–');
  });

  it('rundet kaufmännisch mit wählbaren Nachkommastellen', () => {
    expect(formatQuotient(1, 8, 2)).toBe('0,13');
    expect(formatQuotient(5, 2, 0)).toBe('3');
    expect(formatQuotient(17, 7, 5)).toBe('2,42857');
  });
});

describe('formatGoalDiff', () => {
  it('zeigt Vorzeichen', () => {
    expect(formatGoalDiff(3)).toBe('+3');
    expect(formatGoalDiff(0)).toBe('0');
    expect(formatGoalDiff(-2)).toBe('−2');
  });
});

describe('Bruchrechnung', () => {
  it('ist exakt, wo Fließkomma scheitert', () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(compare(add(fraction(1, 10), fraction(2, 10)), fraction(3, 10))).toBe(0);
  });

  it('kürzt und normalisiert das Vorzeichen', () => {
    expect(fraction(6, -4)).toEqual({ num: -3n, den: 2n });
    expect(() => fraction(1, 0)).toThrow();
  });
});
