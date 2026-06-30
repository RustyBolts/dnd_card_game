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

  it("parses optional consumable card flags from CSV and JSON catalogs", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,consumable,enabled\n" +
        "scroll_burst,Scroll Burst,1,ITEM,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,true,true\n",
      starterDeckCsv: "cardId,count\nscroll_burst,1\n",
      version: "consumable-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "consumable-json",
      cardDefinitions: {
        scroll_burst: {
          cardId: "scroll_burst",
          name: "Scroll Burst",
          cost: 1,
          type: "ITEM",
          description: "Deal 1 damage.",
          effect: { type: "DAMAGE", value: 1 },
          targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
          consumable: true
        }
      },
      starterDeckCardIds: ["scroll_burst"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.scroll_burst.consumable).toBe(true);
    expect(jsonCatalog.cardDefinitions.scroll_burst.consumable).toBe(true);
  });

  it("parses DAMAGE effectCount as the number of damage hits", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
        "combo,連擊,2,ATTACK,對一名目標造成 2 次 3 點傷害。,DAMAGE,3,2,SINGLE,ENEMY,true,true\n",
      starterDeckCsv: "cardId,count\ncombo,1\n",
      version: "damage-count-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "damage-count-json",
      cardDefinitions: {
        combo: {
          cardId: "combo",
          name: "連擊",
          cost: 2,
          type: "ATTACK",
          description: "對一名目標造成 2 次 3 點傷害。",
          effect: { type: "DAMAGE", value: 3, count: 2 },
          targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
        }
      },
      starterDeckCardIds: ["combo"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.combo.effect).toEqual({
      type: "DAMAGE",
      value: 3,
      count: 2
    });
    expect(jsonCatalog.cardDefinitions.combo.effect).toEqual({
      type: "DAMAGE",
      value: 3,
      count: 2
    });

    expect(() => parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,enabled\n" +
        "invalid_combo,Invalid Combo,1,ATTACK,Invalid.,DAMAGE,3,0,true\n",
      starterDeckCsv: "cardId,count\ninvalid_combo,1\n",
      version: "invalid-damage-count"
    })).toThrow(/effectCount must be an integer >= 1/);
  });

  it("parses optional resource costs from CSV and JSON catalogs", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,consumeCardCount,hpCost,enabled\n" +
        "blood_rite,Blood Rite,1,SKILL,Pay HP and consume cards.,DRAW,,1,NONE,SELF,false,2,3,true\n",
      starterDeckCsv: "cardId,count\nblood_rite,1\n",
      version: "resource-costs-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "resource-costs-json",
      cardDefinitions: {
        blood_rite: {
          cardId: "blood_rite",
          name: "Blood Rite",
          cost: 1,
          type: "SKILL",
          description: "Pay HP and consume cards.",
          effect: { type: "DRAW", count: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
          resourceCosts: {
            consumeCardCount: 2,
            hp: 3
          }
        }
      },
      starterDeckCardIds: ["blood_rite"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.blood_rite.resourceCosts).toEqual({
      consumeCardCount: 2,
      hp: 3
    });
    expect(jsonCatalog.cardDefinitions.blood_rite.resourceCosts).toEqual({
      consumeCardCount: 2,
      hp: 3
    });
  });

  it("parses status card HP and energy loss effects from CSV and JSON catalogs", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,consumable,enabled\n" +
        "bleeding,出血,9,STATUS,結算時失去 1 HP。,LOSE_HP,1,,NONE,SELF,false,,true\n" +
        "clumsy,笨拙,4,STATUS,結算時失去 1 點能量。,ENERGY_LOSS,1,,NONE,SELF,false,true,true\n",
      starterDeckCsv: "cardId,count\nbleeding,1\nclumsy,1\n",
      version: "status-effects-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "status-effects-json",
      cardDefinitions: {
        bleeding: {
          cardId: "bleeding",
          name: "出血",
          cost: 9,
          type: "STATUS",
          description: "結算時失去 1 HP。",
          effect: { type: "HP_LOSS", value: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
        },
        clumsy: {
          cardId: "clumsy",
          name: "笨拙",
          cost: 4,
          type: "STATUS",
          description: "結算時失去 1 點能量。",
          effect: { type: "LOSE_ENERGY", value: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
          consumable: true
        }
      },
      starterDeckCardIds: ["bleeding", "clumsy"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.bleeding.effect).toEqual({ type: "LOSE_HP", value: 1 });
    expect(csvCatalog.cardDefinitions.clumsy.effect).toEqual({ type: "LOSE_ENERGY", value: 1 });
    expect(csvCatalog.cardDefinitions.clumsy.consumable).toBe(true);
    expect(jsonCatalog.cardDefinitions.bleeding.effect).toEqual({ type: "LOSE_HP", value: 1 });
    expect(jsonCatalog.cardDefinitions.clumsy.effect).toEqual({ type: "LOSE_ENERGY", value: 1 });
  });

  it("parses add-card-to-hand effects and validates their card references", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,effectCardId,targetSelection,targetScope,targetRequired,enabled\n" +
        "sneak_attack,偷襲,1,ATTACK,使目標獲得 2 張出血。,ADD_CARD_TO_HAND,,2,bleeding,SINGLE,ENEMY,true,true\n" +
        "bleeding,出血,9,STATUS,結算時失去 1 HP。,LOSE_HP,1,,,NONE,SELF,false,true\n",
      starterDeckCsv: "cardId,count\nsneak_attack,1\n",
      version: "add-card-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "add-card-json",
      cardDefinitions: {
        stealth: {
          cardId: "stealth",
          name: "隱匿",
          cost: 1,
          type: "SKILL",
          description: "獲得 1 張躲藏。",
          effect: { type: "ADD_TO_HAND", cardId: "hide", count: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
        },
        hide: {
          cardId: "hide",
          name: "躲藏",
          cost: 1,
          type: "SKILL",
          description: "準備躲藏。",
          effect: { type: "NONE" },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
        }
      },
      starterDeckCardIds: ["stealth"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.sneak_attack.effect).toEqual({
      type: "ADD_CARD_TO_HAND",
      cardId: "bleeding",
      count: 2
    });
    expect(jsonCatalog.cardDefinitions.stealth.effect).toEqual({
      type: "ADD_CARD_TO_HAND",
      cardId: "hide",
      count: 1
    });

    expect(() => parseCardCatalogJson({
      version: "bad-add-card-json",
      cardDefinitions: {
        stealth: {
          cardId: "stealth",
          name: "隱匿",
          cost: 1,
          type: "SKILL",
          description: "獲得不存在的牌。",
          effect: { type: "ADD_CARD_TO_HAND", cardId: "missing", count: 1 }
        }
      },
      starterDeckCardIds: ["stealth"]
    }, "catalog.json")).toThrow(/effect\.cardId references unknown cardId "missing"/);
  });

  it("parses draw-from-pile effects from CSV and JSON catalogs", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
        "verdant_call,自然呼喚,0,SKILL,從自然牌庫抽 2 張。,從牌堆抽牌,自然,2,NONE,SELF,false,true\n",
      starterDeckCsv: "cardId,count\nverdant_call,1\n",
      version: "draw-from-pile-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "draw-from-pile-json",
      cardDefinitions: {
        scavenge: {
          cardId: "scavenge",
          name: "Scavenge",
          cost: 0,
          type: "SKILL",
          description: "Draw from discard.",
          effect: { type: "DRAW_FROM_PILE", pile: "棄牌堆", count: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
        }
      },
      starterDeckCardIds: ["scavenge"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.verdant_call.effect).toEqual({
      type: "DRAW_FROM_PILE",
      pile: "NATURE",
      count: 2
    });
    expect(jsonCatalog.cardDefinitions.scavenge.effect).toEqual({
      type: "DRAW_FROM_PILE",
      pile: "GRAVEYARD",
      count: 1
    });
  });

  it("parses and validates end-turn status action tags", () => {
    const catalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,effectCardId,targetSelection,targetScope,targetRequired,consumable,consumeCardCount,hpCost,actionTags,enabled\n" +
        "ignited,點燃,2,STATUS,回合結束時加入 3 張灼傷。,ADD_CARD_TO_HAND,,3,burn,NONE,SELF,false,true,,,回合結束時觸發其他狀態,true\n" +
        "burn,灼傷,1,STATUS,結算時失去 1 HP。,LOSE_HP,1,,,NONE,SELF,false,true,,,,true\n",
      starterDeckCsv: "cardId,count\nignited,1\n",
      version: "end-turn-status-csv"
    });

    expect(catalog.cardDefinitions.ignited.actionTags).toEqual([{
      type: "END_TURN_STATUS",
      label: "回合結束時觸發其他狀態",
      trigger: "TURN_ENDED"
    }]);

    expect(() => parseCardCatalogJson({
      version: "invalid-end-turn-status",
      cardDefinitions: {
        invalid_ignited: {
          cardId: "invalid_ignited",
          name: "Invalid Ignited",
          cost: 2,
          type: "SKILL",
          description: "Wrong source type.",
          effect: { type: "ADD_CARD_TO_HAND", cardId: "burn", count: 3 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
          actionTags: ["END_TURN_STATUS"]
        },
        burn: {
          cardId: "burn",
          name: "Burn",
          cost: 1,
          type: "STATUS",
          description: "Lose 1 HP.",
          effect: { type: "LOSE_HP", value: 1 },
          targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
        }
      },
      starterDeckCardIds: ["invalid_ignited"]
    }, "catalog.json")).toThrow(/END_TURN_STATUS requires type STATUS/);
  });

  it("parses action tags from CSV and JSON catalogs", () => {
    const csvCatalog = parseCardCatalogFromCsv({
      cardsCsv:
        "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,actionTags,enabled\n" +
        "quick_shot,Quick Shot,2,ATTACK,Deal 2 damage.,DAMAGE,2,,SINGLE,ENEMY,true,附贈動作,true\n" +
        "riposte,Riposte,1,ATTACK,Deal 1 damage.,DAMAGE,1,,SINGLE,ENEMY,true,反應動作,true\n",
      starterDeckCsv: "cardId,count\nquick_shot,1\nriposte,1\n",
      version: "action-tags-csv"
    });
    const jsonCatalog = parseCardCatalogJson({
      version: "action-tags-json",
      cardDefinitions: {
        quick_shot: {
          cardId: "quick_shot",
          name: "Quick Shot",
          cost: 2,
          type: "ATTACK",
          description: "Deal 2 damage.",
          effect: { type: "DAMAGE", value: 2 },
          targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
          actionTags: ["BONUS_ACTION", "COUNTER_ACTION", "READY_ACTION"]
        }
      },
      starterDeckCardIds: ["quick_shot"]
    }, "catalog.json");

    expect(csvCatalog.cardDefinitions.quick_shot.actionTags).toEqual([{
      type: "BONUS_ACTION",
      label: "附贈動作",
      trigger: "DISCARD"
    }]);
    expect(csvCatalog.cardDefinitions.riposte.actionTags).toEqual([{
      type: "REACTION_ACTION",
      label: "反應動作",
      trigger: "DAMAGE_TARGETED"
    }]);
    expect(jsonCatalog.cardDefinitions.quick_shot.actionTags).toEqual([
      {
        type: "BONUS_ACTION",
        label: "附贈動作",
        trigger: "DISCARD"
      },
      {
        type: "COUNTER_ACTION",
        label: "反制動作",
        trigger: "SKILL_TARGETED"
      },
      {
        type: "READY_ACTION",
        label: "準備動作",
        trigger: "TURN_STARTED"
      }
    ]);
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
      hiddenDecksCsv:
        "pile,cardId,count,enabled\n" +
        "知識,tactical_insight,2,true\n" +
        "ENVIRONMENT,mana_spark,1,true\n",
      version: "kv-test"
    });

    expect(catalog.hiddenDeckCardIds).toEqual({
      NATURE: [],
      KNOWLEDGE: ["tactical_insight", "tactical_insight"],
      ENVIRONMENT: ["mana_spark"]
    });
    expect(parseCardCatalogJson(JSON.parse(JSON.stringify(catalog)), "test-kv")).toEqual(catalog);
  });

  it("rejects hidden deck rows that reference unknown cards or non-hidden piles", () => {
    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv: CARDS_CSV,
        starterDeckCsv: STARTER_DECK_CSV,
        hiddenDecksCsv: "pile,cardId,count,enabled\nKNOWLEDGE,missing,1,true\n",
        version: "bad-hidden-card"
      })
    ).toThrow(/unknown cardId "missing"/);

    expect(() =>
      parseCardCatalogFromCsv({
        cardsCsv: CARDS_CSV,
        starterDeckCsv: STARTER_DECK_CSV,
        hiddenDecksCsv: "pile,cardId,count,enabled\nDECK,tactical_insight,1,true\n",
        version: "bad-hidden-pile"
      })
    ).toThrow(/pile must be NATURE, KNOWLEDGE, or ENVIRONMENT/);
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
    ).toThrow(/effectType must be .*DRAW_FROM_PILE.*ADD_CARD_TO_HAND/);
  });

  it("normalizes Google Sheets published HTML URLs to CSV URLs", () => {
    expect(
      normalizePublishedCsvUrl(
        "https://docs.google.com/spreadsheets/d/e/example/pubhtml?gid=123&single=true"
      )
    ).toBe("https://docs.google.com/spreadsheets/d/e/example/pub?gid=123&single=true&output=csv");
  });
});
