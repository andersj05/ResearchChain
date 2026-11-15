import { spawn } from "node:child_process";

export async function holdWorkers() {
  const child = spawn(
    "uv",
    ["run", "--project", "../api", "python", "../api/tests/worker_browser_fixture.py"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    child.stdin.end("\n");
    await closed;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker hold was not ready.")), 25000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("ready")) finish();
      });
      child.once("error", () => finish(new Error("Worker hold could not start.")));
      child.once("exit", (code) => {
        if (code !== 0) finish(new Error("Worker hold exited unexpectedly."));
      });
    });
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
