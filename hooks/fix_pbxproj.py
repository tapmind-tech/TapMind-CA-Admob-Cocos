#!/usr/bin/env python3
"""
Convert CMake-generated old-style plist pbxproj to XML plist format.
Required for Xcode 26+ compatibility with Cocos Creator 3.8 (CMake 3.24).
Usage: python3 fix_pbxproj.py <path/to/project.pbxproj>
"""
import sys, re, plistlib


def tokenize(text):
    """Tokenize old-style Apple plist text, skipping comments."""
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        # Whitespace
        if c in ' \t\n\r':
            i += 1
            continue
        # Block comment /* ... */
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            end = text.find('*/', i + 2)
            i = (end + 2) if end != -1 else n
            continue
        # Line comment // ...
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            end = text.find('\n', i + 2)
            i = (end + 1) if end != -1 else n
            continue
        # Structural tokens
        if c in '{}()=;,':
            tokens.append(c)
            i += 1
            continue
        # Quoted string — handle escape sequences properly
        if c == '"':
            j = i + 1
            chars = []
            while j < n:
                ch = text[j]
                if ch == '\\' and j + 1 < n:
                    nxt = text[j + 1]
                    if nxt == 'n':
                        chars.append('\n')
                    elif nxt == 't':
                        chars.append('\t')
                    elif nxt == '\\':
                        chars.append('\\')
                    elif nxt == '"':
                        chars.append('"')
                    elif nxt == '0':
                        chars.append('\0')
                    elif nxt == 'r':
                        chars.append('\r')
                    elif nxt == ' ':
                        chars.append(' ')
                    else:
                        chars.append(nxt)
                    j += 2
                elif ch == '"':
                    j += 1
                    break
                else:
                    chars.append(ch)
                    j += 1
            tokens.append(('str', ''.join(chars)))
            i = j
            continue
        # Unquoted string
        if re.match(r'[a-zA-Z0-9._$/:+\-@~]', c):
            j = i
            while j < n and re.match(r'[a-zA-Z0-9._$/:+\-@~]', text[j]):
                j += 1
            tokens.append(('str', text[i:j]))
            i = j
            continue
        # Skip any other character
        i += 1
    return tokens


def parse_value(tokens, pos):
    if pos >= len(tokens):
        return '', pos
    tok = tokens[pos]
    if tok == '{':
        return parse_dict(tokens, pos)
    elif tok == '(':
        return parse_array(tokens, pos)
    elif isinstance(tok, tuple) and tok[0] == 'str':
        return tok[1], pos + 1
    else:
        return '', pos + 1


def parse_dict(tokens, pos):
    pos += 1
    d = {}
    while pos < len(tokens) and tokens[pos] != '}':
        key_tok = tokens[pos]
        if isinstance(key_tok, tuple) and key_tok[0] == 'str':
            key = key_tok[1]
            pos += 1
            if pos < len(tokens) and tokens[pos] == '=':
                pos += 1
            value, pos = parse_value(tokens, pos)
            if pos < len(tokens) and tokens[pos] == ';':
                pos += 1
            d[key] = value if value is not None else ''
        else:
            pos += 1
    if pos < len(tokens) and tokens[pos] == '}':
        pos += 1
    return d, pos


def parse_array(tokens, pos):
    pos += 1
    arr = []
    while pos < len(tokens) and tokens[pos] != ')':
        value, pos = parse_value(tokens, pos)
        if value is not None:
            arr.append(value)
        if pos < len(tokens) and tokens[pos] == ',':
            pos += 1
    if pos < len(tokens) and tokens[pos] == ')':
        pos += 1
    return arr, pos


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fix_pbxproj.py <path/to/project.pbxproj>", file=sys.stderr)
        sys.exit(1)

    infile = sys.argv[1]
    with open(infile, 'r', encoding='utf-8') as f:
        text = f.read()

    # Already XML plist? Skip.
    if text.strip().startswith('<?xml'):
        print("Already XML plist, skipping.", file=sys.stderr)
        sys.exit(0)

    # Fix known Cocos CMake bug: '""""' → '""'
    if '""""' in text:
        text = text.replace('""""', '""')
        print("Fixed Cocos quad-quote corruption.", file=sys.stderr)

    # Strip magic header
    text = re.sub(r'^//\s*!\$\*UTF8\*\$!\s*\n', '', text)

    tokens = tokenize(text)
    result, _ = parse_value(tokens, 0)

    if not isinstance(result, dict) or 'objects' not in result:
        print(f"ERROR: Parsed result missing 'objects' key. Keys: {list(result.keys()) if isinstance(result, dict) else 'N/A'}", file=sys.stderr)
        sys.exit(1)

    with open(infile, 'wb') as f:
        plistlib.dump(result, f, sort_keys=False)

    print(f"Converted to XML plist. Root keys: {list(result.keys())}", file=sys.stderr)


if __name__ == '__main__':
    main()
