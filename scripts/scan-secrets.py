#!/usr/bin/env python3
import re
import sys

def main():
    data = sys.stdin.read()
    patterns = [
        re.compile(r'AKIA[0-9A-Z]{16}'),
        re.compile(r'(?i)password\s*[:=]\s*\S+')
    ]
    findings = []
    for pattern in patterns:
        match = pattern.search(data)
        if match:
            findings.append(match.group(0))
    if findings:
        print('Potential secrets found:', ', '.join(findings))
        sys.exit(1)

if __name__ == '__main__':
    main()
