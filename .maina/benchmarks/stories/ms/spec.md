# ms — Millisecond Conversion Utility

## Requirements

Implement a utility that converts between human-readable duration strings and milliseconds.

### Exports

- `default function ms(value: string | number, options?: { long?: boolean }): number | string` — dual-mode: string input returns milliseconds, number input returns formatted string
- `function parse(str: string): number` — parse duration string to milliseconds
- `function format(ms: number, options?: { long?: boolean }): string` — format milliseconds to string

### Parsing Rules (String → Milliseconds)

Input format: `{number}{unit}` or `{number} {unit}`

Supported units and their millisecond values:

| Unit | Aliases | Milliseconds |
|------|---------|-------------|
| Years | y, yr, yrs, year, years | 31,557,600,000 (365.25 days) |
| Months | mo, month, months | 2,629,800,000 (365.25/12 days) |
| Weeks | w, week, weeks | 604,800,000 |
| Days | d, day, days | 86,400,000 |
| Hours | h, hr, hrs, hour, hours | 3,600,000 |
| Minutes | m, min, mins, minute, minutes | 60,000 |
| Seconds | s, sec, secs, second, seconds | 1,000 |
| Milliseconds | ms, msec, msecs, millisecond, milliseconds | 1 |

Rules:
- Case-insensitive: "1H" and "1h" are equivalent
- Decimal support: "1.5h" → 5,400,000
- Leading decimal: ".5m" → 30,000
- Negative values: "-1h" → -3,600,000
- Multiple spaces between number and unit are allowed
- Bare number string with no unit returns the number as milliseconds: "100" → 100
- Unparseable strings return NaN (do not throw)
- String length must be 1-100 characters

### Formatting Rules (Milliseconds → String)

**Short format (default):**
Select the largest unit where the value rounds to >= 1:
- `>= 1 day` → `"{n}d"`
- `>= 1 hour` → `"{n}h"`
- `>= 1 minute` → `"{n}m"`
- `>= 1 second` → `"{n}s"`
- `< 1 second` → `"{n}ms"`

Values are rounded with `Math.round()`. Negative values preserve the sign: `-60000` → `"-1m"`.

**Long format (`{ long: true }`):**
Same unit selection, but uses full word with pluralization:
- Singular when `Math.abs(ms) / unitMs < 1.5`: "1 minute"
- Plural otherwise: "2 minutes"
- Negative: "-1 hour", "-2 hours"

### Error Handling

**Throws TypeError:**
- Empty string `""`
- String longer than 100 characters
- Non-string, non-number input (null, undefined, arrays, objects, boolean)
- Non-finite numbers: NaN, Infinity, -Infinity

**Returns NaN (no throw):**
- String that doesn't match the parsing pattern: "foo", "☃", "10-.5"

## Constraints

- No dependencies
- Under 200 lines
- TypeScript strict mode
- Must handle all unit aliases listed above
