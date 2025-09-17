#!/usr/bin/env node
import fs from 'node:fs';
import { summarize } from '../src/index.js';

const input = fs.readFileSync(0, 'utf-8');
console.log(summarize(input));
