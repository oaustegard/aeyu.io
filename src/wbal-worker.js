import { fitWbal } from "./wbal.js";

self.onmessage = (e) => {
  const { id, rides, cpGuess } = e.data;
  self.postMessage({ id, fit: fitWbal(rides, cpGuess) });
};
