import { spawn } from 'node:child_process';

import { createCliInvocation } from './command-allowlist.js';

function sanitizeCliBinary(value) {
  const candidate = value ?? 'jobbot';
  if (typeof candidate !== 'string') {
    throw new Error('CLI binary must be a string');
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error('CLI binary must be a non-empty string');
  }
  return trimmed;
}

function coerceTimeout(value) {
  if (value == null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('timeout must be a positive number');
  }
  return numeric;
}

function normalizeInput(value) {
  if (value == null) return undefined;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return value;
  throw new Error('input must be a string or Buffer');
}

function toStringChunk(chunk) {
  if (chunk == null) return '';
  return typeof chunk === 'string' ? chunk : chunk.toString();
}

export class CliInvocationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CliInvocationError';
    const {
      bin,
      command,
      args,
      cliArgs,
      exitCode,
      signal,
      stdout,
      stderr,
      timedOut = false,
      cause,
    } = details;
    this.bin = bin;
    this.command = command;
    this.args = args;
    this.cliArgs = cliArgs;
    this.exitCode = exitCode;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = Boolean(timedOut);
    if (cause) {
      this.cause = cause;
    }
  }
}

export async function runAllowlistedCommand(request, options = {}) {
  const invocation = createCliInvocation(request);
  const bin = sanitizeCliBinary(options.bin);
  const args = [invocation.command, ...invocation.args];
  const timeout = coerceTimeout(options.timeout);
  const killSignal = options.killSignal ?? 'SIGTERM';
  const input = normalizeInput(options.input);
  const onStdout = options.onStdout;
  const onStderr = options.onStderr;

  let child;
  try {
    child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: 'pipe',
    });
  } catch (error) {
    throw new CliInvocationError(`Failed to launch ${bin}`, {
      bin,
      command: invocation.command,
      args: invocation.args.slice(),
      cliArgs: args.slice(),
      cause: error,
    });
  }

  if (child.stdin && typeof child.stdin.end === 'function') {
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
    };

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        const text = toStringChunk(chunk);
        stdout += text;
        if (typeof onStdout === 'function') {
          onStdout(chunk);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', chunk => {
        const text = toStringChunk(chunk);
        stderr += text;
        if (typeof onStderr === 'function') {
          onStderr(chunk);
        }
      });
    }

    child.on('error', error => {
      cleanup();
      reject(
        new CliInvocationError('Failed to execute CLI command', {
          bin,
          command: invocation.command,
          args: invocation.args.slice(),
          cliArgs: args.slice(),
          stdout,
          stderr,
          cause: error,
        }),
      );
    });

    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          if (typeof child.kill === 'function') {
            child.kill(killSignal);
          }
        }, timeout)
      : undefined;

    child.on('close', (code, signal) => {
      cleanup();
      if (timedOut) {
        reject(
          new CliInvocationError(`Command timed out after ${timeout}ms`, {
            bin,
            command: invocation.command,
            args: invocation.args.slice(),
            cliArgs: args.slice(),
            stdout,
            stderr,
            timedOut: true,
            signal,
          }),
        );
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(
          new CliInvocationError(
            `Command failed: ${bin} ${args.join(' ')} (exit code ${code ?? 'unknown'})`,
            {
              bin,
              command: invocation.command,
              args: invocation.args.slice(),
              cliArgs: args.slice(),
              stdout,
              stderr,
              exitCode: code ?? undefined,
              signal,
            },
          ),
        );
        return;
      }

      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        invocation: {
          bin,
          command: invocation.command,
          args: invocation.args.slice(),
        },
        signal,
      });
    });
  });
}
