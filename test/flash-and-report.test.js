import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runPython(script) {
  const interpreters = ['python3', 'python'];
  for (const cmd of interpreters) {
    const proc = spawnSync(cmd, ['-c', script], { encoding: 'utf-8' });
    if (proc.error && proc.error.code === 'ENOENT') continue;
    return { cmd, proc };
  }
  return null;
}

describe('flash_and_report._describe_device', () => {
  it('preserves the device system_id for auto-eject flows', () => {
    const pythonSnippet = `
import json
import importlib.util
from pathlib import Path

module_path = Path(${JSON.stringify(path.join(ROOT, 'scripts', 'flash_and_report.py'))})
spec = importlib.util.spec_from_file_location('flash_and_report', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DummyDevice:
    def __init__(self):
        self.path = '/dev/sdz'
        self.description = 'USB mass storage'
        self.is_removable = True
        self.human_size = '16 GB'
        self.bus = 'usb'
        self.mountpoints = ['/mnt/flash']
        self.system_id = 7

devices = [DummyDevice()]
info = module._describe_device(devices, '/dev/sdz')
print(json.dumps(info))
`;

    const result = runPython(pythonSnippet);
    if (!result) {
      console.warn('Skipping flash_and_report test because Python interpreter is unavailable.');
      return;
    }

    const { proc } = result;
    if (proc.status !== 0) {
      throw new Error(`Python exited with ${proc.status}: ${proc.stderr}`);
    }

    const info = JSON.parse(proc.stdout.trim());
    expect(info.system_id).toBe(7);
    expect(info.mountpoints).toEqual(['/mnt/flash']);
    expect(info.path).toBe('/dev/sdz');
  });
});
