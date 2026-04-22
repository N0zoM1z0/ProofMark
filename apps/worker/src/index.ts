export function createWorkerStatus() {
  return {
    status: 'idle',
    service: 'worker'
  };
}

if (process.env.NODE_ENV !== 'test') {
  // Phase 0 keeps the worker intentionally minimal until real jobs arrive.
  console.log(JSON.stringify(createWorkerStatus()));
}
