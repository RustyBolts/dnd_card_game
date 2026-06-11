import { describe, expect, it } from "vitest";
import {
  normalizePublishedCsvUrl,
  parseCardCatalogFromCsv,
  parseCardCatalogJson
} from "../src/shared/data/cardCatalog.js";

const CARDS_CSV = `cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled
fireball,火球術,2,ATTACK,對一名目標造成 3 點傷害。,DAMAGE,3,,SINGLE,ENEMY,true,true
dagger_strike,短刃突襲,1,ATTACK,對一名目標造成 1 點傷害。,DAMAGE,1,,SINGLE,ENEMY,true,true
healing_potion,治療藥水,1,ITEM,恢復自己 3 點 HP。,HEAL,3,,NONE,SELF,false,true
tactical_insight,戰術洞察,1,SKILL,抽 2 張牌。,DRAW,,2,NONE,SELF,false,true
mana_spark,魔力火花,0,SKILL,對一名目標造成 1 點傷害。,DAMAGE,1,,SINGLE,ENEMY,true,true
`;

const STARTER_DECK_CSV = `cardId,count
fireball,3
dagger_strike,3
healing_potion,2
tactical_insight,2
mana_spark,2
`;

const RACES_CSV = `raceId,name,baseHp,naturalArmorType,naturalArmorValue,strengthCreationMax,dexterityCreationMax,intelligenceCreationMax,wisdomCreationMax,charismaCreationMax,constitutionCreationMax,strengthLevelMax,dexterityLevelMax,intelligenceLevelMax,wisdomLevelMax,charismaLevelMax,constitutionLevelMax,enabled
human,人類,20,NONE,0,18,18,18,18,18,18,20,20,20,20,20,20,true
orc,獸人,25,FUR,1,20,18,15,15,15,20,20,20,20,20,20,20,true
`;

describe("card catalog data source", () => {
  it("parses CSV data into the game card catalog shape", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv: CARDS_CSV,
      starterDeckCsv: STARTER_DECK_CSV,
      version: "test"
    });

    expect(catalog.version).toBe("test");
    expect(catalog.transformRules).toEqual([]);
    expect(catalog.cardDefinitions.fireball).toEqual({
      cardId: "fireball",
      name: "火球術",
      cost: 2,
      type: "ATTACK",
      description: "對一名目標造成 3 點傷害。",
      effect: { type: "DAMAGE", value: 3 },
      targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
    });
    expect(catalog.cardDefinitions.tactical_insight.effect).toEqual({ type: "DRAW", count: 2 });
    expect(catalog.cardDefinitions.tactical_insight.targeting).toEqual({
      selection: "NONE",
      scope: "SELF",
      requiresTarget: false
    });
    expect(catalog.starterDeckCardIds).toHaveLength(12);
    expect(catalog.starterDeckCardIds.filter((cardId) => cardId === "fireball")).toHaveLength(3);
    expect(catalog.races?.human.baseHp).toBe(20);
  });

  it("parses external race definitions from CSV data", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv: CARDS_CSV,
      starterDeckCsv: STARTER_DECK_CSV,
      racesCsv: RACES_CSV,
      version: "race-csv"
    });

    expect(catalog.races?.orc).toEqual({
      raceId: "orc",
      name: "獸人",
      creationMax: {
        strength: 20,
        dexterity: 18,
        intelligence: 15,
        wisdom: 15,
        charisma: 15,
        constitution: 20
      },
      levelMax: {
        strength: 20,
        dexterity: 20,
        intelligence: 20,
        wisdom: 20,
        charisma: 20,
        constitution: 20
      },
      baseHp: 25,
      naturalArmorType: "FUR",
      naturalArmorValue: 1
    });
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

  it("infers targeting for legacy CSV data without targeting columns", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv: "cardId,name,cost,type,description,effectType,effectValue,effectCount,enabled\nknown,Known,1,ATTACK,Hit.,DAMAGE,1,,true\n",
      starterDeckCsv: "cardId,count\nknown,1\n",
      version: "legacy"
    });

    expect(catalog.cardDefinitions.known.targeting).toEqual({
      selection: "SINGLE",
      scope: "ENEMY",
      requiresTarget: true
    });
  });

  it("parses reversible hand-card transform rules from CSV data", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
        "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
        "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n" +
        "bear_form,Bear Form,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,true\n",
      starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\nbear_form,1\n",
      transformRulesCsv:
        "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
        "T001,stance_shift,wolf_form,bear_form,hand,true,turn_end\n",
      version: "transform-csv"
    });

    expect(catalog.cardDefinitions.stance_shift.effect).toEqual({ type: "NONE" });
    expect(catalog.transformRules).toEqual([{
      ruleId: "T001",
      triggerCardId: "stance_shift",
      sourceCardId: "wolf_form",
      targetCardId: "bear_form",
      scope: "OWNER_HAND",
      reversible: true,
      revertTiming: "TURN_END"
    }]);
    expect(parseCardCatalogJson(JSON.parse(JSON.stringify(catalog)), "transform-kv")).toEqual(catalog);
  });

  it("parses NONE effects for cards that only trigger external rules", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
        "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n",
      starterDeckCsv: "cardId,count\nstance_shift,1\n",
      version: "none-effect"
    });

    expect(catalog.cardDefinitions.stance_shift.effect).toEqual({ type: "NONE" });
  });

  it("validates a serialized legacy catalog without transform rules", () => {
    const catalog = parseCardCatalogJson(
      {
        version: "legacy-kv",
        cardDefinitions: {
          stance_shift: {
            cardId: "stance_shift",
            name: "Stance Shift",
            cost: 0,
            type: "SKILL",
            description: "Toggle forms.",
            effect: { type: "NONE" },
            targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
          }
        },
        starterDeckCardIds: ["stance_shift"]
      },
      "legacy-kv"
    );

    expect(catalog.transformRules).toEqual([]);
    expect(catalog.races?.human.name).toBe("人類");
  });

  it("accepts JSON race definitions", () => {
    const catalog = parseCardCatalogJson(
      {
        version: "race-json",
        cardDefinitions: {
          stance_shift: {
            cardId: "stance_shift",
            name: "Stance Shift",
            cost: 0,
            type: "SKILL",
            description: "Toggle forms.",
            effect: { type: "NONE" },
            targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
          }
        },
        starterDeckCardIds: ["stance_shift"],
        races: {
          human: {
            raceId: "human",
            name: "人類",
            creationMax: {
              strength: 18,
              dexterity: 18,
              intelligence: 18,
              wisdom: 18,
              charisma: 18,
              constitution: 18
            },
            levelMax: {
              strength: 20,
              dexterity: 20,
              intelligence: 20,
              wisdom: 20,
              charisma: 20,
              constitution: 20
            },
            baseHp: 20,
            naturalArmorType: "NONE",
            naturalArmorValue: 0
          }
        }
      },
      "race-json"
    );

    expect(catalog.races?.human.creationMax.strength).toBe(18);
  });

  it("accepts JSON transform rules", () => {
    const catalog = parseCardCatalogJson(
      {
        version: "transform-json",
        cardDefinitions: {
          stance_shift: {
            cardId: "stance_shift",
            name: "Stance Shift",
            cost: 0,
            type: "SKILL",
            description: "Toggle forms.",
            effect: { type: "NONE" },
            targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
          },
          wolf_form: {
            cardId: "wolf_form",
            name: "Wolf Form",
            cost: 1,
            type: "ATTACK",
            description: "Deal 1 damage.",
            effect: { type: "DAMAGE", value: 1 },
            targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
          },
          bear_form: {
            cardId: "bear_form",
            name: "Bear Form",
            cost: 2,
            type: "ATTACK",
            description: "Deal 2 damage.",
            effect: { type: "DAMAGE", value: 2 },
            targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
          }
        },
        starterDeckCardIds: ["stance_shift", "wolf_form", "bear_form"],
        transformRules: [{
          ruleId: "T001",
          triggerCardId: "stance_shift",
          sourceCardId: "wolf_form",
          targetCardId: "bear_form",
          scope: "OWNER_HAND",
          reversible: true,
          revertTiming: "TURN_END"
        }]
      },
      "transform-json"
    );

    expect(catalog.transformRules).toEqual([{
      ruleId: "T001",
      triggerCardId: "stance_shift",
      sourceCardId: "wolf_form",
      targetCardId: "bear_form",
      scope: "OWNER_HAND",
      reversible: true,
      revertTiming: "TURN_END"
    }]);
  });

  it("rejects transform rules that reference unknown card ids", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,missing_form,hand,true,turn_end\n",
        version: "bad-transform-csv"
      })
    ).toThrow(/targetCardId references unknown cardId/);
  });

  it("rejects non-reversible transform rules with a revert timing", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n" +
          "bear_form,Bear Form,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\nbear_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,bear_form,hand,false,turn_end\n",
        version: "bad-revert-csv"
      })
    ).toThrow(/revertTiming must be NEVER/);
  });

  it("rejects duplicate transform rule ids", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n" +
          "bear_form,Bear Form,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\nbear_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,bear_form,hand,true,turn_end\n" +
          "T001,stance_shift,wolf_form,bear_form,hand,true,turn_end\n",
        version: "duplicate-transform-csv"
      })
    ).toThrow(/duplicates ruleId/);
  });

  it("rejects transform rules whose source and target are the same card", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,wolf_form,hand,true,turn_end\n",
        version: "same-target-csv"
      })
    ).toThrow(/targetCardId must be different/);
  });

  it("rejects transform rules with unsupported scopes", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n" +
          "bear_form,Bear Form,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\nbear_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,bear_form,deck,true,turn_end\n",
        version: "bad-scope-csv"
      })
    ).toThrow(/scope must be HAND or OWNER_HAND/);
  });

  it("rejects transform rules with unsupported revert timing", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,NONE,,,NONE,SELF,false,true\n" +
          "wolf_form,Wolf Form,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true\n" +
          "bear_form,Bear Form,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\nwolf_form,1\nbear_form,1\n",
        transformRulesCsv:
          "ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming\n" +
          "T001,stance_shift,wolf_form,bear_form,hand,true,next_turn\n",
        version: "bad-timing-csv"
      })
    ).toThrow(/revertTiming must be NEVER or TURN_END/);
  });

  it("rejects the old card-effect transform schema", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv:
          "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
          "stance_shift,Stance Shift,0,SKILL,Toggle forms.,TRANSFORM_HAND_CARDS,,,NONE,SELF,false,true\n",
        starterDeckCsv: "cardId,count\nstance_shift,1\n",
        version: "old-transform-effect"
      })
    ).toThrow(/effectType must be NONE, DAMAGE, HEAL, or DRAW/);
  });

  it("normalizes Google Sheets published HTML URLs to CSV URLs", () => {
    expect(
      normalizePublishedCsvUrl(
        "https://docs.google.com/spreadsheets/d/e/example/pubhtml?gid=123&single=true"
      )
    ).toBe("https://docs.google.com/spreadsheets/d/e/example/pub?gid=123&single=true&output=csv");
  });
});
