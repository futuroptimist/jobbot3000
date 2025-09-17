import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'flash_and_report.py');

function runPython(code) {
  const result = execFileSync('python3', ['-c', code], {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPATH: repoRoot },
  });
  return JSON.parse(result.toString());
}

describe('_describe_device', () => {
  it('includes system_id in metadata for matched devices', () => {
    const payload = runPython(`
import json
import importlib.util
spec = importlib.util.spec_from_file_location("flash_and_report", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Device:
    def __init__(self):
        self.path = "/dev/disk1"
        self.description = "USB Drive"
        self.is_removable = True
        self.human_size = "16 GB"
        self.bus = "USB"
        self.mountpoints = ["/Volumes/USB"]
        self.system_id = 777

devices = [Device()]
print(json.dumps(module._describe_device(devices, "/dev/disk1")))
    `);

    expect(payload).toMatchObject({
      path: '/dev/disk1',
      description: 'USB Drive',
      is_removable: true,
      human_size: '16 GB',
      bus: 'USB',
      mountpoints: ['/Volumes/USB'],
      system_id: 777,
    });
  });

  it('falls back to None when attributes are missing', () => {
    const payload = runPython(`
import json
import importlib.util
spec = importlib.util.spec_from_file_location("flash_and_report", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Device:
    def __init__(self):
        self.path = "/dev/disk2"

devices = [Device()]
print(json.dumps(module._describe_device(devices, "/dev/disk2")))
    `);

    expect(payload).toEqual({
      path: '/dev/disk2',
      description: null,
      is_removable: null,
      human_size: null,
      bus: null,
      mountpoints: [],
      system_id: null,
    });
  });
});
