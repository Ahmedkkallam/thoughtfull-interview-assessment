// Runs the API and the web dev server together; stops both on Ctrl+C or when either exits.
import { execSync, spawn } from "node:child_process";
import process from "node:process";

const win = process.platform === "win32";
// One command string per child, run through a shell on every OS (an args array with shell:true makes Node warn DEP0190).
// On Mac/Linux each child gets its own process group (detached), so the whole group can be stopped at once.
const commands = ["npm run start -w apps/api", "npm run dev -w apps/web"];
const children = commands.map((cmd) => spawn(cmd, { stdio: "inherit", shell: true, detached: !win }));

function stopChild(child) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    // Killing only the shell would leave npm, the API and Vite running and holding their ports.
    if (win) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function stop(code) {
  for (const child of children) stopChild(child);
  process.exit(code);
}
for (const child of children) child.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
