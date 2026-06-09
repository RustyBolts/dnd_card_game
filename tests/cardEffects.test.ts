import { describe, expect, it } from "vitest";
import { parseCardCatalogFromCsv } from "../src/shared/data/cardCatalog.js";
import type { CardInstance } from "../src/shared/types/card.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";
import { createStartedGame, createStartedGameWithPlayers } from "./testUtils.js";

describe("card effects", () => {
  it("plays a damage card from hand, pays energy, moves the card to graveyard, and damages the target", () => {
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
    expect(state.zones.graveyard).toContain(card);
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
      starterDeckCardIds: ["focus"]
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
