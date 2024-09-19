import { Document } from "mongoose";

export interface IPremiumConfig {
  cacheTTL?: number;
  codeLength?: number;
  defaultPremiumDuration?: number;
  maxActivationsPerCode?: number;
  preloadTables?: boolean;
}

export interface IPremium {
  entityId: string;
  isPremium: boolean;
  expiresAt: Date | null;
  activatedBy: string | null;
  activatedAt: Date | null;
}

export interface IPremiumCode {
  code: string;
  duration: number;
  maxActivations: number;
  activations: { entityId: string; activatedAt: Date }[];
  createdBy: string;
  createdAt: Date;
}

export interface IStorage {
  findPremium(entityId: string): Promise<IPremium | null>;
  savePremium(premium: IPremium): Promise<void>;
  findPremiumCode(code: string): Promise<IPremiumCode | null>;
  savePremiumCode(premiumCode: IPremiumCode): Promise<void>;
  findExpiredPremiums(): Promise<IPremium[]>;
  getAllPremiums(): Promise<IPremium[]>;
  getAllPremiumCodes(): Promise<IPremiumCode[]>;
}
