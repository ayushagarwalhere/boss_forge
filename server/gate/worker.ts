import { parentPort, workerData } from 'node:worker_threads';
import { runGate } from './runner';

parentPort?.postMessage(runGate(workerData));
parentPort?.close();
