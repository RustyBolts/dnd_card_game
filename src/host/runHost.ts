import { HostServer } from "./HostServer.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value) {
    args.set(key.slice(2), value);
  }
}

const port = Number(args.get("port") ?? process.env.PORT ?? 7777);
const host = args.get("host") ?? process.env.HOST;

const server = new HostServer({ host, port });
server.start();

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
