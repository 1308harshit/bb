import { parentPort, workerData } from "node:worker_threads";
import http from "node:http";
import { performance } from "node:perf_hooks";
const samples = [];
let count = 0;
let inflight = 0;
let stopped = false;
const timer = setInterval(() => {
  const start = performance.now();
  const path = count++ % 2 ? "/read" : "/ping";
  inflight++;
  const req = http.get(
    { host: "127.0.0.1", port: workerData.port, path, agent: false },
    (res) => {
      res.resume();
      res.on("end", () => {
        samples.push({ path, ms: performance.now() - start });
        inflight--;
        finish();
      });
    },
  );
  req.on("error", () => {
    samples.push({ path, error: true });
    inflight--;
    finish();
  });
}, 5);
function finish() {
  if (stopped && inflight === 0) parentPort.postMessage(samples);
}
parentPort.on("message", () => {
  clearInterval(timer);
  stopped = true;
  finish();
});
parentPort.postMessage("ready");
