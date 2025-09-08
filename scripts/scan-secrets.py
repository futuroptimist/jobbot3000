#!/usr/bin/env python3
# cspell:ignore AKIA
import re
import sys

PLACEHOLDER_VALUES = {
    'changeme',
    '<password>',
    'example',
    'your-password',
    'jobbot',
    'minio123',
}

def main():
    data = sys.stdin.read()
    patterns = [
        re.compile(r'AKIA[0-9A-Z]{16}'),
        re.compile(r'(?i)password\s*[:=]\s*(\S+)')
    ]
    findings = []
    for pattern in patterns:
        for match in pattern.finditer(data):
            if pattern.pattern.startswith('(?i)password'):
                value = match.group(1).lower().strip("'\"")
                if value in PLACEHOLDER_VALUES:
                    continue
                findings.append(match.group(0))
            else:
                findings.append(match.group(0))
    if findings:
        print('Potential secrets found:', ', '.join(findings))
        sys.exit(1)

if __name__ == '__main__':
    main()
