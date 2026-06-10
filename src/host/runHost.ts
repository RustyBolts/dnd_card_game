import { HostServer } from "./HostServer.js";
import { loadCardCatalogForHost } from "./CardCatalogLoader.js";

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
const cardCatalog = loadCardCatalogForHost({
  cardsCsvPath: args.get("cards-csv"),
  starterDeckCsvPath: args.get("starter-deck-csv"),
  transformRulesCsvPath: args.get("transform-rules-csv"),
  version: args.get("card-catalog-version")
});

const server = new HostServer({ host, port, cardCatalog });
server.start();

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
