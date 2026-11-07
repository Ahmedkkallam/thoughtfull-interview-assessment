// Runs the API and the web dev server together; stops both on Ctrl+C or when either exits.
import { spawn } from "node:child_process";
import process from "node:process";

const commands = [
  ["npm", ["run", "start", "-w", "apps/api"]],
  ["npm", ["run", "dev", "-w", "apps/web"]],
];
const children = commands.map(([cmd, args]) =>
  spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" }),
);

function stop(code) {
  for (const child of children) child.kill();
  process.exit(code);
}
for (const child of children) child.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
