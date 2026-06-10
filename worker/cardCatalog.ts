import {
  normalizePublishedCsvUrl,
  parseCardCatalogFromCsv,
  parseCardCatalogJson
} from "../src/shared/data/cardCatalog.js";
import { DEFAULT_CARD_CATALOG } from "../src/shared/rules/cardDefinitions.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";

export type CardCatalogEnv = {
  CARD_CATALOG_KV?: KVNamespace;
  CARD_CATALOG_KEY?: string;
  CARD_CARDS_CSV_URL?: string;
  CARD_STARTER_DECK_CSV_URL?: string;
  CARD_TRANSFORM_RULES_CSV_URL?: string;
};

export type WorkerCardCatalogResult = {
  catalog: CardCatalog;
  source: "kv" | "default";
};

const DEFAULT_CARD_CATALOG_KEY = "card-catalog:active";

export async function loadWorkerCardCatalog(env: CardCatalogEnv): Promise<WorkerCardCatalogResult> {
  const kv = env.CARD_CATALOG_KV;
  if (!kv) {
    return {
      catalog: DEFAULT_CARD_CATALOG,
      source: "default"
    };
  }

  const key = getCardCatalogKey(env);
  const rawCatalog = await kv.get(key);
  if (!rawCatalog) {
    return {
      catalog: DEFAULT_CARD_CATALOG,
      source: "default"
    };
  }

  return {
    catalog: parseCardCatalogJson(JSON.parse(rawCatalog), `KV ${key}`),
    source: "kv"
  };
}

export async function syncWorkerCardCatalog(env: CardCatalogEnv): Promise<CardCatalog> {
  if (!env.CARD_CATALOG_KV) {
    throw new Error("CARD_CATALOG_KV binding is not configured.");
  }

  if (!env.CARD_CARDS_CSV_URL || !env.CARD_STARTER_DECK_CSV_URL) {
    throw new Error("CARD_CARDS_CSV_URL and CARD_STARTER_DECK_CSV_URL must both be configured.");
  }

  const [cardsCsv, starterDeckCsv, transformRulesCsv] = await Promise.all([
    fetchText(env.CARD_CARDS_CSV_URL, "cards CSV"),
    fetchText(env.CARD_STARTER_DECK_CSV_URL, "starter deck CSV"),
    env.CARD_TRANSFORM_RULES_CSV_URL
      ? fetchText(env.CARD_TRANSFORM_RULES_CSV_URL, "transform rules CSV")
      : Promise.resolve(undefined)
  ]);
  const catalog = parseCardCatalogFromCsv({
    cardsCsv,
    starterDeckCsv,
    transformRulesCsv,
    version: `google-sheets:${new Date().toISOString()}`
  });

  await env.CARD_CATALOG_KV.put(getCardCatalogKey(env), JSON.stringify(catalog));
  return catalog;
}

export function getCardCatalogKey(env: CardCatalogEnv): string {
  return env.CARD_CATALOG_KEY || DEFAULT_CARD_CATALOG_KEY;
}

async function fetchText(url: string, label: string): Promise<string> {
  const normalizedUrl = normalizePublishedCsvUrl(url);
  const response = await fetch(normalizedUrl, {
    headers: {
      Accept: "text/csv,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch ${label}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (looksLikeHtml(text, response.headers.get("Content-Type"))) {
    throw new Error(
      `${label} URL returned HTML instead of CSV. Use a Google Sheets published CSV URL, or a /pubhtml URL that can be converted to /pub?output=csv.`
    );
  }

  return text;
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return contentType?.toLowerCase().includes("text/html") === true || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}
