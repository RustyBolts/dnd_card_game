export type LoadoutSourceType = "CLASS" | "FEAT" | "WEAPON" | "ADVENTURE_SKILL";

export type CardOriginType = LoadoutSourceType | "STARTER" | "RECOVERY";

export type CardOrigin = {
  type: CardOriginType;
  sourceId: string;
  bindingId: string;
};

export type LoadoutSourceDefinition = {
  sourceType: LoadoutSourceType;
  sourceId: string;
  name: string;
  recoveryCardId?: string;
};

export type LoadoutCardDefinition = {
  sourceType: LoadoutSourceType;
  sourceId: string;
  cardId: string;
  count: number;
};

export type EquipmentStatus = "EQUIPPED" | "DROPPED";

export type WeaponSlotState = {
  weaponId: string;
  bindingId: string;
  status: EquipmentStatus;
};

export function loadoutSourceKey(sourceType: LoadoutSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}
