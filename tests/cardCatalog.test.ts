import { describe, expect, it } from "vitest";
import {
  normalizePublishedCsvUrl,
  parseCardCatalogFromCsv,
  parseCardCatalogJson
} from "../src/shared/data/cardCatalog.js";

const CARDS_CSV = `cardId,name,cost,type,description,effectType,effectValue,effectCount,enabled
fireball,火球術,2,ATTACK,對一名目標造成 3 點傷害。,DAMAGE,3,,true
dagger_strike,短刃突襲,1,ATTACK,對一名目標造成 1 點傷害。,DAMAGE,1,,true
healing_potion,治療藥水,1,ITEM,恢復自己 3 點 HP。,HEAL,3,,true
tactical_insight,戰術洞察,1,SKILL,抽 2 張牌。,DRAW,,2,true
mana_spark,魔力火花,0,SKILL,對一名目標造成 1 點傷害。,DAMAGE,1,,true
`;

const STARTER_DECK_CSV = `cardId,count
fireball,3
dagger_strike,3
healing_potion,2
tactical_insight,2
mana_spark,2
`;

describe("card catalog data source", () => {
  it("parses CSV data into the game card catalog shape", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv: CARDS_CSV,
      starterDeckCsv: STARTER_DECK_CSV,
      version: "test"
    });

    expect(catalog.version).toBe("test");
    expect(catalog.cardDefinitions.fireball).toEqual({
      cardId: "fireball",
      name: "火球術",
      cost: 2,
      type: "ATTACK",
      description: "對一名目標造成 3 點傷害。",
      effect: { type: "DAMAGE", value: 3 }
    });
    expect(catalog.cardDefinitions.tactical_insight.effect).toEqual({ type: "DRAW", count: 2 });
    expect(catalog.starterDeckCardIds).toHaveLength(12);
    expect(catalog.starterDeckCardIds.filter((cardId) => cardId === "fireball")).toHaveLength(3);
  });

  it("validates a serialized catalog read back from KV", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv: CARDS_CSV,
      starterDeckCsv: STARTER_DECK_CSV,
      version: "kv-test"
    });

    expect(parseCardCatalogJson(JSON.parse(JSON.stringify(catalog)), "test-kv")).toEqual(catalog);
  });

  it("rejects starter deck rows that reference unknown cards", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv: "cardId,name,cost,type,description,effectType,effectValue,effectCount,enabled\nknown,Known,1,SKILL,Draw.,DRAW,,1,true\n",
        starterDeckCsv: "cardId,count\nmissing,1\n",
        version: "bad"
      })
    ).toThrow(/unknown cardId/);
  });

  it("normalizes Google Sheets published HTML URLs to CSV URLs", () => {
    expect(
      normalizePublishedCsvUrl(
        "https://docs.google.com/spreadsheets/d/e/example/pubhtml?gid=123&single=true"
      )
    ).toBe("https://docs.google.com/spreadsheets/d/e/example/pub?gid=123&single=true&output=csv");
  });
});
