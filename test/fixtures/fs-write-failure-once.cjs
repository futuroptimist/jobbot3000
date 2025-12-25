// Injected via NODE_OPTIONS=--require in tests to simulate a locked file that
// clears after the first retry. Only the first write to an analytics export
// path throws to avoid disturbing other filesystem operations.
const fs = require('node:fs');

const originalWriteFile = fs.promises.writeFile;
let attempt = 0;

fs.promises.writeFile = async (file, ...args) => {
  const target = typeof file === 'string' ? file : String(file);
  if (attempt === 0 && target.includes('analytics')) {
    attempt += 1;
    const error = new Error('File is temporarily locked');
    error.code = 'EBUSY';
    throw error;
  }
  return originalWriteFile(file, ...args);
};
