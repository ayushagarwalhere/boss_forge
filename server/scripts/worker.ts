import { parentPort, workerData } from 'node:worker_threads';
import { compileScript } from './compiler';
try {
  if (typeof workerData !== 'string') throw new Error('Invalid script input.');
  parentPort?.postMessage({ tape: await compileScript(workerData) });
} catch { parentPort?.postMessage({ error: 'Script failed static validation, isolated execution, or resource limits. See docs/scripts.md.' }); }
parentPort?.close();
