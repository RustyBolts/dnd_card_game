import { describe, expect, it } from "vitest";
import { parseCardCatalogFromCsv } from "../src/shared/data/cardCatalog.js";
import type { CardInstance } from "../src/shared/types/card.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";
import { createStartedGame, createStartedGameWithPlayers } from "./testUtils.js";

describe("card effects", () => {
  it("plays a damage card from hand, pays energy, moves the card to temporary pile, and damages the target", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, targetId);

    expect(events.map((event) => event.type)).toContain("CARD_PLAYED");
    expect(events.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(state.players[playerId].energy).toBe(0);
    expect(state.players[targetId].hp).toBe(17);
    expect(state.zones.hand[playerId]).not.toContain(card);
    expect(card.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(card);
  });

  it("moves consumable cards to the exhaust pile when played", () => {
    const store = createStartedGame(createConsumableCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_scroll",
      cardId: "scroll_burst",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, "p2");

    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("EXHAUST");
    expect(card.zone).toBe("EXHAUST");
    expect(state.zones.exhaust[playerId]).toContain(card);
    expect(state.zones.temporary[playerId]).not.toContain(card);
  });

  it("rejects enemy single-target damage cards without an explicit target", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    expect(() => store.playCard(playerId, card.instanceId)).toThrow("requires a target");
  });

  it("rejects enemy single-target damage cards targeting self", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_fireball",
      cardId: "fireball",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    expect(() => store.playCard(playerId, card.instanceId, playerId)).toThrow("cannot target p1");
  });

  it("allows a card to explicitly target self when its targeting scope permits any player", () => {
    const selfTargetCatalog: CardCatalog = {
      version: "self-target-test",
      cardDefinitions: {
        focus: {
          cardId: "focus",
          name: "Focus",
          cost: 0,
          type: "SKILL",
          description: "Restore 1 HP to any player.",
          effect: { type: "HEAL", value: 1 },
          targeting: { selection: "SINGLE", scope: "ANY", requiresTarget: true }
        }
      },
      starterDeckCardIds: ["focus"],
      transformRules: []
    };
    const store = createStartedGame(selfTargetCatalog);
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_focus",
      cardId: "focus",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, playerId);

    expect(events.map((event) => event.type)).toContain("HEAL_APPLIED");
    expect(state.players[playerId].hp).toBe(11);
  });

  it("plays an externally loaded self-target healing card without a command target", () => {
    const store = createStartedGame(createExternalHealingCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_healing_potion",
      cardId: "healing_potion",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.map((event) => event.type)).toContain("HEAL_APPLIED");
    expect(state.players[playerId].hp).toBe(13);
  });

  it("ignores stale command targets for externally loaded no-target self cards", () => {
    const store = createStartedGame(createExternalHealingCatalog());
    const state = store.getState();
    const playerId = "p1";
    const staleTargetId = "p2";
    const card: CardInstance = {
      instanceId: "test_healing_potion",
      cardId: "healing_potion",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.players[playerId].energy = 1;
    state.players[staleTargetId].hp = 10;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId, staleTargetId);

    expect(events.map((event) => event.type)).toContain("HEAL_APPLIED");
    expect(state.players[playerId].hp).toBe(13);
    expect(state.players[staleTargetId].hp).toBe(10);
  });

  it("assigns players to two default teams by join order", () => {
    const store = createStartedGameWithPlayers(["Alice", "Bob", "Cara", "Dan"]);
    const state = store.getState();

    expect(state.players.p1.teamId).toBe("team_1");
    expect(state.players.p2.teamId).toBe("team_2");
    expect(state.players.p3.teamId).toBe("team_1");
    expect(state.players.p4.teamId).toBe("team_2");
  });

  it("applies a group enemy damage card to every enemy team member without a target command", () => {
    const store = createStartedGameWithPlayers(["Alice", "Bob", "Cara", "Dan"], createGroupDamageCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_flame_wave",
      cardId: "flame_wave",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 2;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.filter((event) => event.type === "DAMAGE_APPLIED")).toHaveLength(2);
    expect(state.players.p1.hp).toBe(20);
    expect(state.players.p2.hp).toBe(18);
    expect(state.players.p3.hp).toBe(20);
    expect(state.players.p4.hp).toBe(18);
  });

  it("normalizes group targeting as automatic even when external data marks targetRequired true", () => {
    const catalog = createGroupDamageCatalog("true");

    expect(catalog.cardDefinitions.flame_wave.targeting).toEqual({
      selection: "GROUP",
      scope: "ENEMY",
      requiresTarget: false
    });
  });

  it("draw effect adds cards to the acting player's hand", () => {
    const store = createStartedGame();
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_draw",
      cardId: "tactical_insight",
      ownerId: playerId,
      zone: "HAND"
    };
    const handBefore = state.zones.hand[playerId].length;

    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.filter((event) => event.type === "CARD_DRAWN")).toHaveLength(2);
    expect(state.zones.hand[playerId].length).toBe(handBefore + 2);
  });

  it("applies transform rules when the trigger card is played and reverts them at turn end", () => {
    const store = createStartedGame(createTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_catalyst",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.zones.hand[playerId] = [catalyst, wolfForm];

    const events = store.playCard(playerId, catalyst.instanceId);
    const transformEvents = events.filter((event) => event.type === "CARD_TRANSFORMED");

    expect(transformEvents).toHaveLength(1);
    expect(wolfForm.cardId).toBe("bear_form");
    expect(transformEvents.map((event) => event.payload.privateCardData)).toEqual([
      { previousCardId: "wolf_form", cardId: "bear_form" }
    ]);
    expect(transformEvents[0]?.payload.ruleId).toBe("T001");

    const turnEvents = store.endTurn(playerId);
    const revertEvents = turnEvents.filter((event) => event.type === "CARD_TRANSFORMED");

    expect(revertEvents).toHaveLength(1);
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(revertEvents[0]?.payload.privateCardData).toEqual({
      previousCardId: "bear_form",
      cardId: "wolf_form"
    });
  });

  it("reverts a reversible transformed card after it is played into a pile", () => {
    const store = createStartedGame(createTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_catalyst",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.zones.hand[playerId] = [catalyst, wolfForm];
    store.playCard(playerId, catalyst.instanceId);

    expect(wolfForm.cardId).toBe("bear_form");

    const events = store.playCard(playerId, wolfForm.instanceId, "p2");
    const playedEvent = events.find((event) => event.type === "CARD_PLAYED");
    const revertEvents = events.filter((event) => event.type === "CARD_TRANSFORMED");

    expect(playedEvent?.payload.cardId).toBe("bear_form");
    expect(state.players.p2.hp).toBe(18);
    expect(revertEvents).toHaveLength(1);
    expect(revertEvents[0]?.payload.privateCardData).toEqual({
      previousCardId: "bear_form",
      cardId: "wolf_form"
    });
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(wolfForm.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(wolfForm);
    expect(store.endTurn(playerId).filter((event) => event.type === "CARD_TRANSFORMED")).toHaveLength(0);
  });

  it("reverts a reversible transformed card before it is discarded into the temporary pile", () => {
    const store = createStartedGame(createTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_catalyst",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.zones.hand[playerId] = [catalyst, wolfForm];
    store.playCard(playerId, catalyst.instanceId);

    expect(wolfForm.cardId).toBe("bear_form");

    const events = store.discardCard(playerId, wolfForm.instanceId);
    const discardedEvent = events.find((event) => event.type === "CARD_DISCARDED");

    expect(events.map((event) => event.type)).toEqual(["CARD_TRANSFORMED", "CARD_DISCARDED"]);
    expect(discardedEvent?.payload.cardId).toBe("wolf_form");
    expect(events[0]?.type === "CARD_TRANSFORMED" ? events[0].payload.privateCardData : null).toEqual({
      previousCardId: "bear_form",
      cardId: "wolf_form"
    });
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(wolfForm.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(wolfForm);
    expect(store.endTurn(playerId).filter((event) => event.type === "CARD_TRANSFORMED")).toHaveLength(0);
  });

  it("reverts a reversible transformed card before automatic end-turn discard", () => {
    const store = createStartedGame(createTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_catalyst",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].character!.abilityModifiers.intelligence = 0;
    state.zones.hand[playerId] = [catalyst, wolfForm];
    store.playCard(playerId, catalyst.instanceId);

    expect(wolfForm.cardId).toBe("bear_form");

    const events = store.endTurn(playerId);
    const discardedEvent = events.find((event) => event.type === "CARD_DISCARDED");

    expect(events.map((event) => event.type).slice(0, 2)).toEqual(["CARD_TRANSFORMED", "CARD_DISCARDED"]);
    expect(discardedEvent?.payload.cardId).toBe("wolf_form");
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(wolfForm.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(wolfForm);
    expect(events.filter((event) => event.type === "CARD_TRANSFORMED")).toHaveLength(1);
  });
});

function createExternalHealingCatalog(): CardCatalog {
  return parseCardCatalogFromCsv({
    cardsCsv:
      "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
      "healing_potion,治療藥水,1,ITEM,恢復自己 3 點 HP。,HEAL,3,,NONE,SELF,false,true\n",
    starterDeckCsv: "cardId,count\nhealing_potion,1\n",
    version: "external-healing-test"
  });
}

function createGroupDamageCatalog(targetRequired = "false"): CardCatalog {
  return parseCardCatalogFromCsv({
    cardsCsv:
      "cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled\n" +
      `flame_wave,烈焰波,2,ATTACK,對所有敵方角色造成 2 點傷害。,DAMAGE,2,,GROUP,ENEMY,${targetRequired},true\n`,
    starterDeckCsv: "cardId,count\nflame_wave,1\n",
    version: "external-group-test"
  });
}

function createConsumableCatalog(): CardCatalog {
  return {
    version: "consumable-test",
    cardDefinitions: {
      scroll_burst: {
        cardId: "scroll_burst",
        name: "Scroll Burst",
        cost: 1,
        type: "ITEM",
        description: "Deal 1 damage, then exhaust.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
        consumable: true
      }
    },
    starterDeckCardIds: ["scroll_burst"],
    transformRules: []
  };
}

function createTransformCatalog(): CardCatalog {
  return {
    version: "transform-test",
    cardDefinitions: {
      stance_shift: {
        cardId: "stance_shift",
        name: "Stance Shift",
        cost: 0,
        type: "SKILL",
        description: "Transform wolf forms into bear forms until end of turn.",
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
  };
}
