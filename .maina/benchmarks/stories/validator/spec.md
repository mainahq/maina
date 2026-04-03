# validator — Input Validation Library

## Overview

Implement a focused input validation library providing three validators: `isEmail`, `isURL`, and `isIP`. Each function takes a string input and an optional options object, returning a boolean. The library must handle RFC compliance, unicode, internationalized domains, and security-sensitive edge cases.

## Exports

```typescript
export function isEmail(str: string, options?: IsEmailOptions): boolean;
export function isURL(str: string, options?: IsURLOptions): boolean;
export function isIP(str: string, version?: 4 | 6): boolean;
```

---

## isEmail(str, options?)

Validates whether a string is a well-formed email address.

### Options

```typescript
interface IsEmailOptions {
  /** Allow "Display Name <email>" format. Default: false */
  allow_display_name?: boolean;
  /** Require display name to be present. Default: false */
  require_display_name?: boolean;
  /** Allow UTF-8 characters in the local part. Default: true */
  allow_utf8_local_part?: boolean;
  /** Allow IP address as domain, e.g. user@[192.168.1.1]. Default: false */
  allow_ip_domain?: boolean;
  /** Apply domain-specific rules (e.g. Gmail ignores dots). Default: false */
  domain_specific_validation?: boolean;
  /** Characters that must not appear in the local part. Default: none */
  blacklisted_chars?: string;
  /** Reject emails with these domains. Default: [] */
  host_blacklist?: string[];
  /** If non-empty, only allow these domains. Default: [] */
  host_whitelist?: string[];
}
```

### Validation Rules

**Structure:**
- Must contain exactly one `@` separating local part and domain
- Empty string returns false
- Whitespace-only string returns false

**Local part (before @):**
- Maximum 64 characters
- Must not start or end with a dot (`.`)
- Must not contain consecutive dots (`..`)
- ASCII alphanumeric plus `. _ % + -` are always valid
- When `allow_utf8_local_part` is true (default), allow characters above U+007F
- When `allow_utf8_local_part` is false, reject any non-ASCII characters
- The `+` character is valid for sub-addressing / plus-tags (e.g. `user+tag@domain.com`)
- Quoted local parts (e.g. `"user name"@domain.com`) should be accepted when the content between quotes contains otherwise-invalid characters like spaces or special characters

**Domain (after @):**
- Maximum total length of 254 characters for the full address
- Each domain label (between dots) must be 1-63 characters
- Must contain at least one dot (except for IP domains)
- Must not start or end with a hyphen in any label
- Must have a valid TLD (at least 2 alphabetic characters)
- Must not contain consecutive dots
- Internationalized domain names (IDN) with non-ASCII characters are valid

**IP Domain:**
- When `allow_ip_domain` is true, accept `user@[IPv4]` format (e.g. `user@[192.168.1.1]`)
- The IP must be valid according to `isIP` rules
- IPv6 in email domain uses `user@[IPv6:2001:db8::1]` syntax

**Display name:**
- When `allow_display_name` is true, accept `Display Name <email>` format
- The display name can contain any characters except unescaped `<` and `>`
- When `require_display_name` is true, the display name part is mandatory
- If display name is allowed but not present, validate as normal email
- Display name may be quoted: `"John Doe" <john@example.com>`

**Domain-specific validation:**
- When `domain_specific_validation` is true:
  - Gmail addresses (`gmail.com`, `googlemail.com`): reject dots in local part because Gmail ignores them, but this creates ambiguity for validation purposes
  - Other providers: apply standard rules

**Blacklisted characters:**
- When `blacklisted_chars` is set, reject any email whose local part contains any of those characters
- Example: `blacklisted_chars: "!#"` would reject `user!name@domain.com`

**Host lists:**
- When `host_blacklist` is non-empty, reject emails with matching domains
- When `host_whitelist` is non-empty, only accept emails with matching domains
- Matching is case-insensitive

### Edge Cases

- Very long emails just under the 254 limit
- Local part with exactly 64 characters
- Domains with single-char labels: `a.b.c.d`
- Punycode domains: `xn--nxasmq6b.com`
- Multiple `@` signs (invalid)
- Null bytes or control characters in the string
- Email addresses with only a TLD domain (no subdomain)

---

## isURL(str, options?)

Validates whether a string is a well-formed URL.

### Options

```typescript
interface IsURLOptions {
  /** Accepted protocols. Default: ['http', 'https', 'ftp'] */
  protocols?: string[];
  /** Require a protocol prefix. Default: true */
  require_protocol?: boolean;
  /** Require a host component. Default: true */
  require_host?: boolean;
  /** Require a port number. Default: false */
  require_port?: boolean;
  /** Only allow protocols from the protocols list. Default: true */
  require_valid_protocol?: boolean;
  /** Allow underscores in host. Default: false */
  allow_underscores?: boolean;
  /** Allow trailing dot in domain. Default: false */
  allow_trailing_dot?: boolean;
  /** Allow protocol-relative URLs like //example.com. Default: false */
  allow_protocol_relative_urls?: boolean;
  /** Allow fragment identifiers (#section). Default: true */
  allow_fragments?: boolean;
  /** Allow query strings (?key=value). Default: true */
  allow_query_components?: boolean;
  /** Reject URLs longer than 2083 characters. Default: true */
  validate_length?: boolean;
}
```

### Validation Rules

**Protocol:**
- Default accepted protocols: `http`, `https`, `ftp`
- When `require_protocol` is true (default), the URL must start with a valid protocol followed by `://`
- When `require_valid_protocol` is true, the protocol must be in the `protocols` list
- Protocol matching is case-insensitive

**Host:**
- When `require_host` is true (default), a host must be present
- Valid hosts include: domain names, IPv4 addresses, IPv6 addresses in brackets
- Domain labels follow the same rules as email domains (1-63 chars, no leading/trailing hyphens)
- When `allow_underscores` is true, underscores are permitted in domain labels
- When `allow_trailing_dot` is true, `http://example.com.` is valid (DNS root dot)
- Internationalized domain names are accepted
- `localhost` is a valid host

**Port:**
- Optional unless `require_port` is true
- Must be a number between 0 and 65535
- Leading zeros in port numbers should be handled (ambiguous: some implementations reject, some accept)
- No non-numeric characters

**Path:**
- Forward-slash separated segments after the host
- URL-encoded characters (`%20`, `%2F`) are valid in paths
- Empty path is valid

**Query string:**
- Starts with `?` after the path
- When `allow_query_components` is false, reject URLs with query strings
- Key-value pairs separated by `&` with `=` between key and value
- URL-encoded characters are valid

**Fragment:**
- Starts with `#` after path or query
- When `allow_fragments` is false, reject URLs with fragments

**Length:**
- When `validate_length` is true (default), reject URLs longer than 2083 characters (IE limit, widely used as a practical bound)

**IP Hosts:**
- IPv4 addresses as host: `http://192.168.1.1/path`
- IPv6 addresses must be enclosed in brackets: `http://[::1]/path` or `http://[2001:db8::1]:8080/path`
- IP addresses are validated according to `isIP` rules

**Protocol-relative URLs:**
- When `allow_protocol_relative_urls` is true, URLs starting with `//` are valid
- Must still have a valid host after `//`

### Edge Cases

- URL with empty path: `http://example.com`
- URL with only a port: `http://example.com:8080`
- URL with auth: `http://user:pass@example.com` (should be accepted)
- Spaces anywhere in the URL (invalid)
- Double slashes in the path: `http://example.com//path` (valid)
- URL with all components: `http://user:pass@sub.example.com:8080/path/to?query=val&k=v#frag`
- URLs with IP addresses containing zones (ambiguous behavior)
- Data URLs and non-standard protocols when custom protocols list is provided

---

## isIP(str, version?)

Validates whether a string is a valid IP address.

### Parameters

- `str`: the string to validate
- `version`: optional, `4` for IPv4 only, `6` for IPv6 only, omit to accept either

### IPv4 Rules

- Four decimal octets separated by dots: `a.b.c.d`
- Each octet: integer 0-255
- No leading zeros: `01.02.03.04` is invalid (octal ambiguity)
- No extra dots, no trailing dots
- No whitespace
- Exactly 4 octets — no more, no fewer

### IPv6 Rules

- Up to 8 groups of 1-4 hexadecimal digits separated by colons
- Full form: `2001:0db8:85a3:0000:0000:8a2e:0370:7334`
- Abbreviated form: leading zeros in a group can be omitted (`2001:db8:85a3::8a2e:370:7334`)
- `::` shorthand collapses one or more groups of zeros (maximum one `::` per address)
- Loopback: `::1`
- All zeros: `::`
- Mixed IPv4-mapped: `::ffff:192.168.1.1` — last 32 bits expressed as IPv4
- Zone IDs (e.g. `fe80::1%eth0`) should be stripped or rejected (behavior is ambiguous for validators; test both interpretations)
- Case-insensitive: `2001:DB8::1` and `2001:db8::1` are both valid

### Version Filtering

- `isIP("127.0.0.1", 4)` returns true
- `isIP("127.0.0.1", 6)` returns false
- `isIP("::1", 6)` returns true
- `isIP("::1", 4)` returns false
- `isIP("127.0.0.1")` returns true (no version filter)
- `isIP("::1")` returns true (no version filter)

### Edge Cases

- Empty string returns false
- Strings with only whitespace return false
- IPv4 with port notation (`192.168.1.1:80`) should return false (not an IP)
- Very long strings (performance — should not hang on pathological input)
- Embedded null bytes
- IPv4-mapped IPv6 with invalid IPv4 part: `::ffff:999.999.999.999`
- Multiple `::` in IPv6 (invalid)
- IPv6 with more than 8 groups (invalid)

---

## Constraints

- No dependencies
- TypeScript strict mode
- Under 600 lines total across all validators
- Each function must return boolean — never throw
- Invalid or unexpected input types (null, undefined, numbers) should return false
- Performance: must handle adversarial regex input without catastrophic backtracking
