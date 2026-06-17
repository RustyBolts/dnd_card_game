import { describe, expect, it } from "vitest";
import { parseCardCatalogFromCsv } from "../src/shared/data/cardCatalog.js";
import type { CardInstance } from "../src/shared/types/card.js";
import type { CardCatalog } from "../src/shared/types/cardCatalog.js";
import type { CardResolvedEvent, GameEvent } from "../src/shared/types/network.js";
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

    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("RESOLVING");
    expect(events.find((event) => event.type === "CARD_RESOLVED")?.payload.destinationZone).toBe("EXHAUST");
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

  it("keeps a played draw card out of the recycled temporary pile until it resolves", () => {
    const store = createStartedGame(createDrawResolutionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const sourceCard: CardInstance = {
      instanceId: "test_focus_draw",
      cardId: "focus_draw",
      ownerId: playerId,
      zone: "HAND"
    };
    const recycledCard: CardInstance = {
      instanceId: "test_recycled_focus",
      cardId: "recycled_focus",
      ownerId: playerId,
      zone: "TEMPORARY"
    };

    state.players[playerId].energy = 0;
    state.zones.deck[playerId] = [];
    state.zones.hand[playerId] = [sourceCard];
    state.zones.temporary[playerId] = [recycledCard];

    const events = store.playCard(playerId, sourceCard.instanceId);

    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("RESOLVING");
    expect(events.find((event) => event.type === "DECK_RECYCLED")?.payload.recycledCount).toBe(1);
    expect(events.find((event) => event.type === "CARD_DRAWN")?.payload.cardInstanceId).toBe(recycledCard.instanceId);
    expect(events.find((event) => event.type === "CARD_RESOLVED")?.payload).toMatchObject({
      cardInstanceId: sourceCard.instanceId,
      destinationZone: "TEMPORARY"
    });
    expect(Object.prototype.hasOwnProperty.call(state.zones, "resolving")).toBe(false);
    expect(sourceCard.zone).toBe("TEMPORARY");
    expect(state.zones.hand[playerId]).not.toContain(sourceCard);
    expect(state.zones.deck[playerId]).not.toContain(sourceCard);
    expect(state.zones.temporary[playerId]).toContain(sourceCard);
  });

  it("keeps a bonus action draw card out of the recycled temporary pile until it resolves", () => {
    const store = createStartedGame(createBonusDrawResolutionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const sourceCard: CardInstance = {
      instanceId: "test_bonus_draw",
      cardId: "bonus_draw",
      ownerId: playerId,
      zone: "HAND"
    };
    const recycledCard: CardInstance = {
      instanceId: "test_recycled_focus",
      cardId: "recycled_focus",
      ownerId: playerId,
      zone: "TEMPORARY"
    };

    state.players[playerId].energy = 0;
    state.zones.deck[playerId] = [];
    state.zones.hand[playerId] = [sourceCard];
    state.zones.temporary[playerId] = [recycledCard];

    const events = store.discardCard(playerId, sourceCard.instanceId);

    expect(events.find((event) => event.type === "CARD_DISCARDED")?.payload.destinationZone).toBe("RESOLVING");
    expect(events.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload.destinationZone).toBe("RESOLVING");
    expect(events.find((event) => event.type === "DECK_RECYCLED")?.payload.recycledCount).toBe(1);
    expect(events.find((event) => event.type === "CARD_DRAWN")?.payload.cardInstanceId).toBe(recycledCard.instanceId);
    expect(events.find((event) => event.type === "CARD_RESOLVED")?.payload).toMatchObject({
      cardInstanceId: sourceCard.instanceId,
      destinationZone: "TEMPORARY"
    });
    expect(sourceCard.zone).toBe("TEMPORARY");
    expect(state.zones.hand[playerId]).not.toContain(sourceCard);
    expect(state.zones.deck[playerId]).not.toContain(sourceCard);
    expect(state.zones.temporary[playerId]).toContain(sourceCard);
  });

  it("triggers a bonus action card effect for free when discarded during the main phase", () => {
    const store = createStartedGame(createBonusActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_quick_shot",
      cardId: "quick_shot",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 0;
    state.zones.hand[playerId].push(card);

    const events = store.discardCard(playerId, card.instanceId, targetId);

    expect(events.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(events.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(events.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload).toMatchObject({
      playerId,
      cardInstanceId: card.instanceId,
      cardId: "quick_shot",
      actionTag: "BONUS_ACTION",
      trigger: "DISCARD",
      destinationZone: "RESOLVING",
      targetId
    });
    expect(events.find((event) => event.type === "CARD_RESOLVED")?.payload).toMatchObject({
      playerId,
      cardInstanceId: card.instanceId,
      destinationZone: "TEMPORARY"
    });
    expect(state.players[playerId].energy).toBe(0);
    expect(state.players[targetId].hp).toBe(18);
    expect(card.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(card);
  });

  it("rejects a target-required bonus action discard without moving the card", () => {
    const store = createStartedGame(createBonusActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_quick_shot",
      cardId: "quick_shot",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 0;
    state.zones.hand[playerId].push(card);

    expect(() => store.discardCard(playerId, card.instanceId)).toThrow("requires a target");
    expect(card.zone).toBe("HAND");
    expect(state.zones.hand[playerId]).toContain(card);
    expect(state.zones.temporary[playerId]).not.toContain(card);
  });

  it("triggers bonus action effects during the discard phase", () => {
    const store = createStartedGame(createBonusActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_quick_shot",
      cardId: "quick_shot",
      ownerId: playerId,
      zone: "HAND"
    };

    state.turnPhase = "DISCARD";
    state.pendingDiscard = {
      playerId,
      retainCount: 0
    };
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [card];

    const events = store.discardCard(playerId, card.instanceId, targetId);

    expect(events.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(events.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(state.players[targetId].hp).toBe(18);
    expect(card.zone).toBe("TEMPORARY");
  });

  it("starts a discard phase after end turn when a bonus action discard needs a target", () => {
    const store = createStartedGame(createBonusActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_quick_shot",
      cardId: "quick_shot",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].character!.abilityModifiers.intelligence = 0;
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [card];

    const endEvents = store.endTurn(playerId);

    expect(endEvents.map((event) => event.type)).toEqual(["DISCARD_PHASE_STARTED"]);
    expect(state.turnPhase).toBe("DISCARD");
    expect(state.pendingDiscard).toEqual({ playerId, retainCount: 0 });
    expect(state.zones.hand[playerId]).toContain(card);

    const discardEvents = store.discardCard(playerId, card.instanceId, targetId);

    expect(discardEvents.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(discardEvents.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(discardEvents.map((event) => event.type)).toContain("TURN_ENDED");
    expect(state.players[targetId].hp).toBe(18);
    expect(state.currentPlayerId).toBe(targetId);
  });

  it("triggers automatically resolved bonus action discards during end-turn discard cleanup", () => {
    const store = createStartedGame(createAutomaticBonusActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const targetId = "p2";
    const card: CardInstance = {
      instanceId: "test_shockwave",
      cardId: "shockwave",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].character!.abilityModifiers.intelligence = 0;
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [card];

    const endEvents = store.endTurn(playerId);

    expect(endEvents.map((event) => event.type)).toEqual(["DISCARD_PHASE_STARTED"]);
    expect(state.turnPhase).toBe("DISCARD");

    const discardEvents = store.discardCard(playerId, card.instanceId);

    expect(discardEvents.map((event) => event.type)).toContain("CARD_DISCARDED");
    expect(discardEvents.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(discardEvents.map((event) => event.type)).toContain("DAMAGE_APPLIED");
    expect(discardEvents.map((event) => event.type)).toContain("TURN_ENDED");
    expect(state.players[targetId].hp).toBe(19);
    expect(card.zone).toBe("TEMPORARY");
    expect(state.currentPlayerId).toBe(targetId);
  });

  it("triggers prepared reaction actions from another player's bonus action discard", () => {
    const store = createStartedGame(createBonusPreparedActionCatalog());
    const state = store.getState();
    const defenderId = "p1";
    const attackerId = "p2";
    const reactionCard: CardInstance = {
      instanceId: "test_riposte",
      cardId: "riposte",
      ownerId: defenderId,
      zone: "PREPARED"
    };
    const bonusCard: CardInstance = {
      instanceId: "test_quick_shot",
      cardId: "quick_shot",
      ownerId: attackerId,
      zone: "HAND"
    };

    state.currentPlayerId = attackerId;
    state.players[attackerId].energy = 0;
    state.zones.prepared[defenderId] = [reactionCard];
    state.zones.hand[attackerId].push(bonusCard);

    const events = store.discardCard(attackerId, bonusCard.instanceId, defenderId);
    const actionEvents = events.filter((event) => event.type === "CARD_ACTION_TRIGGERED");

    expect(actionEvents).toHaveLength(2);
    expect(actionEvents[0]?.payload).toMatchObject({
      playerId: attackerId,
      cardInstanceId: bonusCard.instanceId,
      actionTag: "BONUS_ACTION",
      trigger: "DISCARD",
      targetId: defenderId
    });
    expect(actionEvents[1]?.payload).toMatchObject({
      playerId: defenderId,
      cardInstanceId: reactionCard.instanceId,
      actionTag: "REACTION_ACTION",
      trigger: "DAMAGE_TARGETED",
      destinationZone: "RESOLVING",
      targetId: attackerId
    });
    expect(findResolvedEvent(events, reactionCard.instanceId)?.payload.destinationZone).toBe("EXHAUST");
    expect(state.players[defenderId].hp).toBe(18);
    expect(state.players[attackerId].hp).toBe(19);
    expect(reactionCard.zone).toBe("EXHAUST");
    expect(state.zones.prepared[defenderId]).not.toContain(reactionCard);
    expect(state.zones.exhaust[defenderId]).toContain(reactionCard);
  });

  it("plays prepared action cards into the prepared pile without resolving their effect", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_riposte",
      cardId: "riposte",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);
    const playedEvent = events.find((event) => event.type === "CARD_PLAYED");

    expect(playedEvent?.payload.destinationZone).toBe("PREPARED");
    expect(events.map((event) => event.type)).not.toContain("DAMAGE_APPLIED");
    expect(state.players[playerId].energy).toBe(0);
    expect(card.zone).toBe("PREPARED");
    expect(state.zones.prepared[playerId]).toContain(card);
  });

  it("triggers reaction actions when another player's damage targets the prepared card owner", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const defenderId = "p1";
    const attackerId = "p2";
    const reactionCard: CardInstance = {
      instanceId: "test_riposte",
      cardId: "riposte",
      ownerId: defenderId,
      zone: "PREPARED"
    };
    const attackCard: CardInstance = {
      instanceId: "test_firebolt",
      cardId: "firebolt",
      ownerId: attackerId,
      zone: "HAND"
    };

    state.currentPlayerId = attackerId;
    state.players[attackerId].energy = 2;
    state.zones.prepared[defenderId] = [reactionCard];
    state.zones.hand[attackerId].push(attackCard);

    const events = store.playCard(attackerId, attackCard.instanceId, defenderId);

    expect(events.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(events.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload).toMatchObject({
      playerId: defenderId,
      cardInstanceId: reactionCard.instanceId,
      actionTag: "REACTION_ACTION",
      trigger: "DAMAGE_TARGETED",
      destinationZone: "RESOLVING",
      targetId: attackerId
    });
    expect(findResolvedEvent(events, reactionCard.instanceId)?.payload.destinationZone).toBe("EXHAUST");
    expect(state.players[defenderId].hp).toBe(18);
    expect(state.players[attackerId].hp).toBe(19);
    expect(reactionCard.zone).toBe("EXHAUST");
    expect(state.zones.prepared[defenderId]).not.toContain(reactionCard);
    expect(state.zones.exhaust[defenderId]).toContain(reactionCard);
  });

  it("triggers counter actions when another player's skill or mage card targets the owner", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const defenderId = "p1";
    const casterId = "p2";
    const counterCard: CardInstance = {
      instanceId: "test_counter",
      cardId: "counter_jab",
      ownerId: defenderId,
      zone: "PREPARED"
    };
    const mageCard: CardInstance = {
      instanceId: "test_hex",
      cardId: "hex",
      ownerId: casterId,
      zone: "HAND"
    };

    state.currentPlayerId = casterId;
    state.players[casterId].energy = 1;
    state.zones.prepared[defenderId] = [counterCard];
    state.zones.hand[casterId].push(mageCard);

    const events = store.playCard(casterId, mageCard.instanceId, defenderId);

    expect(events.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload).toMatchObject({
      playerId: defenderId,
      cardInstanceId: counterCard.instanceId,
      actionTag: "COUNTER_ACTION",
      trigger: "MAGE_TARGETED",
      destinationZone: "RESOLVING",
      targetId: casterId
    });
    expect(findResolvedEvent(events, counterCard.instanceId)?.payload.destinationZone).toBe("TEMPORARY");
    expect(state.players[defenderId].hp).toBe(19);
    expect(state.players[casterId].hp).toBe(18);
    expect(counterCard.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[defenderId]).toContain(counterCard);
  });

  it("plays non-consumable ready action cards directly instead of preparing them", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_guarded_recovery",
      cardId: "guarded_recovery",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.players[playerId].hp = 10;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.map((event) => event.type)).toContain("HEAL_APPLIED");
    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("RESOLVING");
    expect(events.find((event) => event.type === "CARD_RESOLVED")?.payload.destinationZone).toBe("TEMPORARY");
    expect(state.players[playerId].hp).toBe(13);
    expect(card.zone).toBe("TEMPORARY");
    expect(state.zones.prepared[playerId]).not.toContain(card);
  });

  it("plays consumable ready action cards into the prepared pile", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const card: CardInstance = {
      instanceId: "test_stored_blessing",
      cardId: "stored_blessing",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.players[playerId].hp = 10;
    state.zones.hand[playerId].push(card);

    const events = store.playCard(playerId, card.instanceId);

    expect(events.map((event) => event.type)).not.toContain("HEAL_APPLIED");
    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("PREPARED");
    expect(state.players[playerId].hp).toBe(10);
    expect(card.zone).toBe("PREPARED");
    expect(state.zones.prepared[playerId]).toContain(card);
  });

  it("pays card and hp resource costs before resolving a played card", () => {
    const store = createStartedGame(createResourceCostCatalog());
    const state = store.getState();
    const playerId = "p1";
    const sourceCard: CardInstance = {
      instanceId: "test_blood_rite",
      cardId: "blood_rite",
      ownerId: playerId,
      zone: "HAND"
    };
    const readyResource: CardInstance = {
      instanceId: "test_stored_blessing",
      cardId: "stored_blessing",
      ownerId: playerId,
      zone: "HAND"
    };
    const normalResource: CardInstance = {
      instanceId: "test_dagger",
      cardId: "dagger_strike",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [sourceCard, readyResource, normalResource];

    const events = store.playCard(playerId, sourceCard.instanceId, undefined, [
      readyResource.instanceId,
      normalResource.instanceId
    ]);
    const consumedEvents = events.filter((event) => event.type === "CARD_CONSUMED");

    expect(consumedEvents).toHaveLength(2);
    expect(consumedEvents[0]?.payload).toMatchObject({
      cardInstanceId: readyResource.instanceId,
      destinationZone: "PREPARED"
    });
    expect(consumedEvents[1]?.payload).toMatchObject({
      cardInstanceId: normalResource.instanceId,
      destinationZone: "EXHAUST"
    });
    expect(events.find((event) => event.type === "HP_PAID")?.payload).toMatchObject({
      playerId,
      sourceCardInstanceId: sourceCard.instanceId,
      amount: 3,
      hpAfter: 7
    });
    expect(events.find((event) => event.type === "CARD_PLAYED")?.payload.destinationZone).toBe("RESOLVING");
    expect(findResolvedEvent(events, sourceCard.instanceId)?.payload.destinationZone).toBe("TEMPORARY");
    expect(state.players[playerId].hp).toBe(7);
    expect(readyResource.zone).toBe("PREPARED");
    expect(normalResource.zone).toBe("EXHAUST");
    expect(sourceCard.zone).toBe("TEMPORARY");
    expect(state.zones.prepared[playerId]).toContain(readyResource);
    expect(state.zones.exhaust[playerId]).toContain(normalResource);
    expect(state.zones.temporary[playerId]).toContain(sourceCard);
  });

  it("prepares a transformed ready-action card when it is consumed as a resource", () => {
    const store = createStartedGame(createTransformedReadyResourceCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_stance_shift",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const sourceCard: CardInstance = {
      instanceId: "test_observe",
      cardId: "observe",
      ownerId: playerId,
      zone: "HAND"
    };
    const transformedResource: CardInstance = {
      instanceId: "test_combat_slash",
      cardId: "combat_slash",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [catalyst, sourceCard, transformedResource];

    store.playCard(playerId, catalyst.instanceId);

    expect(transformedResource.cardId).toBe("combat_thrust");

    const events = store.playCard(playerId, sourceCard.instanceId, undefined, [
      transformedResource.instanceId
    ]);
    const consumedEvent = events.find((event) => event.type === "CARD_CONSUMED");

    expect(consumedEvent?.payload).toMatchObject({
      cardInstanceId: transformedResource.instanceId,
      cardId: "combat_thrust",
      destinationZone: "PREPARED",
      targetId: "p2",
      targetIds: ["p2"]
    });
    expect(events.filter((event) =>
      event.type === "CARD_TRANSFORMED" && event.payload.cardInstanceId === transformedResource.instanceId
    )).toHaveLength(0);
    expect(transformedResource.cardId).toBe("combat_thrust");
    expect(transformedResource.zone).toBe("PREPARED");
    expect(transformedResource.preparedTargetIds).toEqual(["p2"]);
    expect(state.zones.prepared[playerId]).toContain(transformedResource);
    expect(state.zones.exhaust[playerId]).not.toContain(transformedResource);

    state.currentPlayerId = "p2";
    state.zones.hand.p2 = [];
    state.players[playerId].drawPerTurn = 0;
    state.players[playerId].character!.abilityModifiers.dexterity = 0;

    const turnEvents = store.endTurn("p2");

    expect(turnEvents.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload).toMatchObject({
      playerId,
      cardInstanceId: transformedResource.instanceId,
      actionTag: "READY_ACTION",
      trigger: "TURN_STARTED",
      targetId: "p2",
      targetIds: ["p2"]
    });
    expect(turnEvents.find((event) =>
      event.type === "DAMAGE_APPLIED" && event.payload.sourceId === transformedResource.instanceId
    )?.payload).toMatchObject({
      targetId: "p2",
      amount: 1,
      hpAfter: 19
    });
    expect(findResolvedEvent(turnEvents, transformedResource.instanceId)?.payload.destinationZone).toBe("TEMPORARY");
    expect(transformedResource.preparedTargetIds).toBeUndefined();
    expect(transformedResource.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(transformedResource);
  });

  it("cancels a prepared ready action if its scheduled target is no longer selectable", () => {
    const store = createStartedGame(createTransformedReadyResourceCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_stance_shift",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const sourceCard: CardInstance = {
      instanceId: "test_observe",
      cardId: "observe",
      ownerId: playerId,
      zone: "HAND"
    };
    const transformedResource: CardInstance = {
      instanceId: "test_combat_slash",
      cardId: "combat_slash",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [catalyst, sourceCard, transformedResource];

    store.playCard(playerId, catalyst.instanceId);
    store.playCard(playerId, sourceCard.instanceId, undefined, [
      transformedResource.instanceId
    ]);

    state.players.p2.hp = 0;
    state.currentPlayerId = "p2";
    state.zones.hand.p2 = [];
    state.players[playerId].drawPerTurn = 0;
    state.players[playerId].character!.abilityModifiers.dexterity = 0;

    const turnEvents = store.endTurn("p2");
    const resolvedEvent = findResolvedEvent(turnEvents, transformedResource.instanceId);

    expect(turnEvents.find((event) =>
      event.type === "DAMAGE_APPLIED" && event.payload.sourceId === transformedResource.instanceId
    )).toBeUndefined();
    expect(resolvedEvent?.payload).toMatchObject({
      destinationZone: "EXHAUST",
      cancelled: true,
      cancelReason: "INVALID_TARGET"
    });
    expect(transformedResource.preparedTargetIds).toBeUndefined();
    expect(transformedResource.zone).toBe("EXHAUST");
    expect(state.zones.exhaust[playerId]).toContain(transformedResource);
  });

  it("requires an explicit scheduled target for consumed ready actions when multiple enemies are selectable", () => {
    const store = createStartedGameWithPlayers(["Alice", "Bob", "Cara", "Dan"], createTransformedReadyResourceCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_stance_shift",
      cardId: "stance_shift",
      ownerId: playerId,
      zone: "HAND"
    };
    const sourceCard: CardInstance = {
      instanceId: "test_observe",
      cardId: "observe",
      ownerId: playerId,
      zone: "HAND"
    };
    const transformedResource: CardInstance = {
      instanceId: "test_combat_slash",
      cardId: "combat_slash",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [catalyst, sourceCard, transformedResource];
    store.playCard(playerId, catalyst.instanceId);

    expect(() => store.playCard(playerId, sourceCard.instanceId, undefined, [
      transformedResource.instanceId
    ])).toThrow("requires a target");

    const events = store.playCard(playerId, sourceCard.instanceId, undefined, [
      transformedResource.instanceId
    ], {
      [transformedResource.instanceId]: "p4"
    });

    expect(events.find((event) => event.type === "CARD_CONSUMED")?.payload).toMatchObject({
      cardInstanceId: transformedResource.instanceId,
      destinationZone: "PREPARED",
      targetId: "p4",
      targetIds: ["p4"]
    });
    expect(transformedResource.preparedTargetIds).toEqual(["p4"]);
  });

  it("rejects hp resource costs that would reduce the player to 0 hp", () => {
    const store = createStartedGame(createResourceCostCatalog());
    const state = store.getState();
    const playerId = "p1";
    const sourceCard: CardInstance = {
      instanceId: "test_blood_rite",
      cardId: "blood_rite",
      ownerId: playerId,
      zone: "HAND"
    };
    const readyResource: CardInstance = {
      instanceId: "test_stored_blessing",
      cardId: "stored_blessing",
      ownerId: playerId,
      zone: "HAND"
    };
    const normalResource: CardInstance = {
      instanceId: "test_dagger",
      cardId: "dagger_strike",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 3;
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [sourceCard, readyResource, normalResource];

    expect(() => store.playCard(playerId, sourceCard.instanceId, undefined, [
      readyResource.instanceId,
      normalResource.instanceId
    ])).toThrow("cannot reduce the player to 0 HP");
    expect(state.players[playerId].hp).toBe(3);
    expect(sourceCard.zone).toBe("HAND");
    expect(readyResource.zone).toBe("HAND");
    expect(normalResource.zone).toBe("HAND");
    expect(state.zones.hand[playerId]).toEqual([sourceCard, readyResource, normalResource]);
  });

  it("rejects card resource costs until the required number of cards is selected", () => {
    const store = createStartedGame(createResourceCostCatalog());
    const state = store.getState();
    const playerId = "p1";
    const sourceCard: CardInstance = {
      instanceId: "test_blood_rite",
      cardId: "blood_rite",
      ownerId: playerId,
      zone: "HAND"
    };
    const readyResource: CardInstance = {
      instanceId: "test_stored_blessing",
      cardId: "stored_blessing",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].hp = 10;
    state.players[playerId].energy = 0;
    state.zones.hand[playerId] = [sourceCard, readyResource];

    expect(() => store.playCard(playerId, sourceCard.instanceId, undefined, [
      readyResource.instanceId
    ])).toThrow("requires 2 consumed card resource");
    expect(state.zones.hand[playerId]).toEqual([sourceCard, readyResource]);
  });

  it("triggers ready actions at the start of their owner's turn with self as the target", () => {
    const store = createStartedGame(createPreparedActionCatalog());
    const state = store.getState();
    const playerId = "p1";
    const currentPlayerId = "p2";
    const readyCard: CardInstance = {
      instanceId: "test_guarded_recovery",
      cardId: "guarded_recovery",
      ownerId: playerId,
      zone: "PREPARED"
    };

    state.currentPlayerId = currentPlayerId;
    state.zones.hand[currentPlayerId] = [];
    state.players[playerId].drawPerTurn = 0;
    state.players[playerId].character!.abilityModifiers.dexterity = 0;
    state.players[playerId].hp = 10;
    state.zones.prepared[playerId] = [readyCard];

    const events = store.endTurn(currentPlayerId);

    expect(events.map((event) => event.type)).toContain("TURN_STARTED");
    expect(events.find((event) => event.type === "CARD_ACTION_TRIGGERED")?.payload).toMatchObject({
      playerId,
      cardInstanceId: readyCard.instanceId,
      actionTag: "READY_ACTION",
      trigger: "TURN_STARTED",
      destinationZone: "RESOLVING",
      targetId: playerId
    });
    expect(findResolvedEvent(events, readyCard.instanceId)?.payload.destinationZone).toBe("TEMPORARY");
    expect(state.players[playerId].hp).toBe(13);
    expect(readyCard.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(readyCard);
  });

  it("does not apply transform rules when a prepared action only enters the prepared pile", () => {
    const store = createStartedGame(createPreparedTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const catalyst: CardInstance = {
      instanceId: "test_delayed_stance",
      cardId: "delayed_stance",
      ownerId: playerId,
      zone: "HAND"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.players[playerId].energy = 1;
    state.zones.hand[playerId] = [catalyst, wolfForm];

    const events = store.playCard(playerId, catalyst.instanceId);

    expect(events.map((event) => event.type)).not.toContain("CARD_TRANSFORMED");
    expect(catalyst.zone).toBe("PREPARED");
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(state.zones.prepared[playerId]).toContain(catalyst);
  });

  it("applies transform rules when a prepared action triggers", () => {
    const store = createStartedGame(createPreparedTransformCatalog());
    const state = store.getState();
    const playerId = "p1";
    const currentPlayerId = "p2";
    const catalyst: CardInstance = {
      instanceId: "test_delayed_stance",
      cardId: "delayed_stance",
      ownerId: playerId,
      zone: "PREPARED"
    };
    const wolfForm: CardInstance = {
      instanceId: "test_wolf_form",
      cardId: "wolf_form",
      ownerId: playerId,
      zone: "HAND"
    };

    state.currentPlayerId = currentPlayerId;
    state.zones.hand[currentPlayerId] = [];
    state.players[playerId].drawPerTurn = 0;
    state.players[playerId].character!.abilityModifiers.dexterity = 0;
    state.zones.prepared[playerId] = [catalyst];
    state.zones.hand[playerId] = [wolfForm];

    const events = store.endTurn(currentPlayerId);
    const transformEvents = events.filter((event) => event.type === "CARD_TRANSFORMED");

    expect(events.map((event) => event.type)).toContain("CARD_ACTION_TRIGGERED");
    expect(transformEvents).toHaveLength(1);
    expect(transformEvents[0]?.payload).toMatchObject({
      playerId,
      sourceId: catalyst.instanceId,
      cardInstanceId: wolfForm.instanceId
    });
    expect(transformEvents[0]?.payload.privateCardData).toEqual({
      previousCardId: "wolf_form",
      cardId: "bear_form"
    });
    expect(wolfForm.cardId).toBe("bear_form");
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

  it("reverts a reversible transformed card before end-turn discard cleanup", () => {
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

    const endEvents = store.endTurn(playerId);

    expect(endEvents.map((event) => event.type)).toEqual(["DISCARD_PHASE_STARTED"]);
    expect(state.turnPhase).toBe("DISCARD");
    expect(wolfForm.cardId).toBe("bear_form");

    const discardEvents = store.discardCard(playerId, wolfForm.instanceId);
    const discardedEvent = discardEvents.find((event) => event.type === "CARD_DISCARDED");

    expect(discardEvents.map((event) => event.type).slice(0, 2)).toEqual(["CARD_TRANSFORMED", "CARD_DISCARDED"]);
    expect(discardedEvent?.payload.cardId).toBe("wolf_form");
    expect(wolfForm.cardId).toBe("wolf_form");
    expect(wolfForm.zone).toBe("TEMPORARY");
    expect(state.zones.temporary[playerId]).toContain(wolfForm);
    expect(discardEvents.filter((event) => event.type === "CARD_TRANSFORMED")).toHaveLength(1);
  });
});

function findResolvedEvent(events: GameEvent[], cardInstanceId: string): CardResolvedEvent | undefined {
  return events.find((event): event is CardResolvedEvent =>
    event.type === "CARD_RESOLVED" && event.payload.cardInstanceId === cardInstanceId
  );
}

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

function createBonusActionCatalog(): CardCatalog {
  return {
    version: "bonus-action-test",
    cardDefinitions: {
      quick_shot: {
        cardId: "quick_shot",
        name: "Quick Shot",
        cost: 2,
        type: "ATTACK",
        description: "Deal 2 damage.",
        effect: { type: "DAMAGE", value: 2 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
        actionTags: [{
          type: "BONUS_ACTION",
          label: "附贈動作",
          trigger: "DISCARD"
        }]
      }
    },
    starterDeckCardIds: ["quick_shot"],
    transformRules: []
  };
}

function createAutomaticBonusActionCatalog(): CardCatalog {
  return {
    version: "automatic-bonus-action-test",
    cardDefinitions: {
      shockwave: {
        cardId: "shockwave",
        name: "Shockwave",
        cost: 2,
        type: "ATTACK",
        description: "Deal 1 damage to all enemies.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "GROUP", scope: "ENEMY", requiresTarget: false },
        actionTags: [{
          type: "BONUS_ACTION",
          label: "附贈動作",
          trigger: "DISCARD"
        }]
      }
    },
    starterDeckCardIds: ["shockwave"],
    transformRules: []
  };
}

function createDrawResolutionCatalog(): CardCatalog {
  return {
    version: "draw-resolution-test",
    cardDefinitions: {
      focus_draw: {
        cardId: "focus_draw",
        name: "Focus Draw",
        cost: 0,
        type: "SKILL",
        description: "Draw 1 card.",
        effect: { type: "DRAW", count: 1 },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
      },
      recycled_focus: {
        cardId: "recycled_focus",
        name: "Recycled Focus",
        cost: 0,
        type: "SKILL",
        description: "No effect.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
      }
    },
    starterDeckCardIds: ["focus_draw", "recycled_focus"],
    transformRules: []
  };
}

function createBonusDrawResolutionCatalog(): CardCatalog {
  const drawCatalog = createDrawResolutionCatalog();

  return {
    version: "bonus-draw-resolution-test",
    cardDefinitions: {
      ...drawCatalog.cardDefinitions,
      bonus_draw: {
        cardId: "bonus_draw",
        name: "Bonus Draw",
        cost: 0,
        type: "SKILL",
        description: "Discard to draw 1 card.",
        effect: { type: "DRAW", count: 1 },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        actionTags: [{
          type: "BONUS_ACTION",
          label: "附贈動作",
          trigger: "DISCARD"
        }]
      }
    },
    starterDeckCardIds: ["bonus_draw", ...drawCatalog.starterDeckCardIds],
    transformRules: []
  };
}

function createBonusPreparedActionCatalog(): CardCatalog {
  const bonusCatalog = createBonusActionCatalog();
  const preparedCatalog = createPreparedActionCatalog();

  return {
    version: "bonus-prepared-action-test",
    cardDefinitions: {
      ...bonusCatalog.cardDefinitions,
      ...preparedCatalog.cardDefinitions
    },
    starterDeckCardIds: ["quick_shot", ...preparedCatalog.starterDeckCardIds],
    transformRules: []
  };
}

function createResourceCostCatalog(): CardCatalog {
  const preparedCatalog = createPreparedActionCatalog();

  return {
    version: "resource-cost-test",
    cardDefinitions: {
      blood_rite: {
        cardId: "blood_rite",
        name: "Blood Rite",
        cost: 0,
        type: "SKILL",
        description: "Pay 3 HP and consume 2 cards.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        resourceCosts: {
          consumeCardCount: 2,
          hp: 3
        }
      },
      dagger_strike: {
        cardId: "dagger_strike",
        name: "Dagger Strike",
        cost: 1,
        type: "ATTACK",
        description: "Deal 1 damage.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
      },
      stored_blessing: preparedCatalog.cardDefinitions.stored_blessing
    },
    starterDeckCardIds: ["blood_rite", "dagger_strike", "stored_blessing"],
    transformRules: []
  };
}

function createTransformedReadyResourceCatalog(): CardCatalog {
  return {
    version: "transformed-ready-resource-test",
    cardDefinitions: {
      stance_shift: {
        cardId: "stance_shift",
        name: "Stance Shift",
        cost: 0,
        type: "SKILL",
        description: "Transform combat slash into combat thrust.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false }
      },
      observe: {
        cardId: "observe",
        name: "Observe",
        cost: 0,
        type: "SKILL",
        description: "Consume 1 card.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        resourceCosts: {
          consumeCardCount: 1
        }
      },
      combat_slash: {
        cardId: "combat_slash",
        name: "Combat Slash",
        cost: 1,
        type: "ATTACK",
        description: "Deal 1 damage.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
      },
      combat_thrust: {
        cardId: "combat_thrust",
        name: "Combat Thrust",
        cost: 1,
        type: "ATTACK",
        description: "Prepare a thrust attack.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
        actionTags: [{
          type: "READY_ACTION",
          label: "準備動作",
          trigger: "TURN_STARTED"
        }]
      }
    },
    starterDeckCardIds: ["stance_shift", "observe", "combat_slash", "combat_thrust"],
    transformRules: [{
      ruleId: "T_THRUST",
      triggerCardId: "stance_shift",
      sourceCardId: "combat_slash",
      targetCardId: "combat_thrust",
      scope: "OWNER_HAND",
      reversible: true,
      revertTiming: "TURN_END"
    }]
  };
}

function createPreparedActionCatalog(): CardCatalog {
  return {
    version: "prepared-action-test",
    cardDefinitions: {
      riposte: {
        cardId: "riposte",
        name: "Riposte",
        cost: 1,
        type: "ATTACK",
        description: "Prepare to deal 1 damage back to an attacker.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
        consumable: true,
        actionTags: [{
          type: "REACTION_ACTION",
          label: "反應動作",
          trigger: "DAMAGE_TARGETED"
        }]
      },
      counter_jab: {
        cardId: "counter_jab",
        name: "Counter Jab",
        cost: 1,
        type: "SKILL",
        description: "Prepare to deal 2 damage to a caster.",
        effect: { type: "DAMAGE", value: 2 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true },
        actionTags: [{
          type: "COUNTER_ACTION",
          label: "反制動作",
          trigger: "SKILL_TARGETED"
        }]
      },
      guarded_recovery: {
        cardId: "guarded_recovery",
        name: "Guarded Recovery",
        cost: 1,
        type: "SKILL",
        description: "Prepare to heal yourself at the start of your next turn.",
        effect: { type: "HEAL", value: 3 },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        actionTags: [{
          type: "READY_ACTION",
          label: "準備動作",
          trigger: "TURN_STARTED"
        }]
      },
      stored_blessing: {
        cardId: "stored_blessing",
        name: "Stored Blessing",
        cost: 1,
        type: "SKILL",
        description: "Prepare to heal yourself at the start of your next turn.",
        effect: { type: "HEAL", value: 4 },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        consumable: true,
        actionTags: [{
          type: "READY_ACTION",
          label: "準備動作",
          trigger: "TURN_STARTED"
        }]
      },
      firebolt: {
        cardId: "firebolt",
        name: "Firebolt",
        cost: 2,
        type: "ATTACK",
        description: "Deal 2 damage.",
        effect: { type: "DAMAGE", value: 2 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
      },
      hex: {
        cardId: "hex",
        name: "Hex",
        cost: 1,
        type: "MAGE",
        description: "Deal 1 damage.",
        effect: { type: "DAMAGE", value: 1 },
        targeting: { selection: "SINGLE", scope: "ENEMY", requiresTarget: true }
      }
    },
    starterDeckCardIds: ["riposte", "counter_jab", "guarded_recovery", "stored_blessing", "firebolt", "hex"],
    transformRules: []
  };
}

function createPreparedTransformCatalog(): CardCatalog {
  return {
    version: "prepared-transform-test",
    cardDefinitions: {
      delayed_stance: {
        cardId: "delayed_stance",
        name: "Delayed Stance",
        cost: 1,
        type: "SKILL",
        description: "Prepare a delayed transformation.",
        effect: { type: "NONE" },
        targeting: { selection: "NONE", scope: "SELF", requiresTarget: false },
        consumable: true,
        actionTags: [{
          type: "READY_ACTION",
          label: "準備動作",
          trigger: "TURN_STARTED"
        }]
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
    starterDeckCardIds: ["delayed_stance", "wolf_form", "bear_form"],
    transformRules: [{
      ruleId: "T_PREPARED",
      triggerCardId: "delayed_stance",
      sourceCardId: "wolf_form",
      targetCardId: "bear_form",
      scope: "OWNER_HAND",
      reversible: true,
      revertTiming: "TURN_END"
    }]
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
