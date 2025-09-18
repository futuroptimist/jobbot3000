import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = path.resolve(__dirname, '..', 'scripts');

describe('flash_and_report helpers', () => {
  it('exposes system_id in device metadata for eject support', () => {
    const program = `
import json
import os
import sys
sys.path.insert(0, os.getcwd())
from flash_and_report import _describe_device

class Device:
    def __init__(self):
        self.path = '/dev/disk1'
        self.description = 'USB Disk'
        self.is_removable = True
        self.human_size = '16 GB'
        self.bus = 'USB'
        self.mountpoints = ['/Volumes/PI']
        self.system_id = 4242

devices = [Device()]
print(json.dumps(_describe_device(devices, '/dev/disk1')))
`;

    const result = spawnSync('python3', ['-c', program], {
      cwd: scriptsDir,
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const metadata = JSON.parse(result.stdout.trim());
    expect(metadata).toMatchObject({
      path: '/dev/disk1',
      description: 'USB Disk',
      is_removable: true,
      human_size: '16 GB',
      bus: 'USB',
      mountpoints: ['/Volumes/PI'],
      system_id: 4242,
    });
  });
});
