import { Worker } from 'node:worker_threads';

/** Run a TypeScript module in a worker thread (registers tsx inside the worker first). */
export function runTsWorker<T>(moduleUrl: string | URL, data: unknown): Promise<T> {
  // A data: URL has no base to resolve package names from, so pass tsx's absolute URL.
  const bootstrap = `
    const { register } = await import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))});
    register();
    await import(${JSON.stringify(String(moduleUrl))});
  `;
  return new Promise<T>((resolve, reject) => {
    const w = new Worker(`import(${JSON.stringify('data:text/javascript,' + encodeURIComponent(bootstrap))})`, {
      eval: true,
      workerData: data,
    });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}
