import { model } from "mongoose";
import { EventEmitter } from "events";
import NodeCache from "node-cache";
import path from "node:path";
import fs from "node:fs/promises";
import { generateCode } from "./utils";
import { IPremium, IPremiumCode, IPremiumConfig, IStorage } from "../types";
import { PremiumSchema } from "./models/Premium";
import { PremiumCodeSchema } from "./models/PremiumCode";

class MongoStorage implements IStorage {
  private premiumModel = model<IPremium>("Premium", PremiumSchema);
  private premiumCodeModel = model<IPremiumCode>(
    "PremiumCode",
    PremiumCodeSchema
  );

  /**
   * Obtient les informations d'un premium.
   */
  async findPremium(entityId: string): Promise<IPremium | null> {
    return this.premiumModel.findOne({ entityId });
  }

  /**
   * Sauvegarde les changements d'un premium.
   */
  async savePremium(premium: IPremium): Promise<void> {
    await this.premiumModel.findOneAndUpdate(
      { entityId: premium.entityId },
      premium,
      { upsert: true }
    );
  }

  /**
   * Obtient les informations d'un code premium.
   */
  async findPremiumCode(code: string): Promise<IPremiumCode | null> {
    return this.premiumCodeModel.findOne({ code });
  }

  /**
   * Sauvegarde un code premium dans la base de données.
   */
  async savePremiumCode(premiumCode: IPremiumCode): Promise<void> {
    await this.premiumCodeModel.create(premiumCode);
  }

  /**
   * Obtention des codes expirés.
   */
  async findExpiredPremiums(): Promise<IPremium[]> {
    return this.premiumModel.find({
      isPremium: true,
      expiresAt: { $lt: new Date() },
    });
  }

  /**
   * Obtention de tout les premiums existant.
   */
  async getAllPremiums(): Promise<IPremium[]> {
    return this.premiumModel.find({});
  }

  /**
   * Obtention de tout les codes existant.
   */
  async getAllPremiumCodes(): Promise<IPremiumCode[]> {
    return this.premiumCodeModel.find({});
  }
}

class LocalStorage implements IStorage {
  private premiumPath: string;
  private premiumCodePath: string;

  constructor(dataDir: string) {
    this.premiumPath = path.join(dataDir, "premiums.json");
    this.premiumCodePath = path.join(dataDir, "premiumsCodes.json");
  }

  /**
   * Permet de lire un fichier json.
   */
  private async readJsonFile(filePath: string): Promise<any[]> {
    try {
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Permet de mettre à jour un fichier json.
   */
  private async writeJsonFile(filePath: string, data: any[]): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Permet d'obtenir un premium via son id.
   */
  async findPremium(entityId: string): Promise<IPremium | null> {
    const premiums = await this.readJsonFile(this.premiumPath);
    return premiums.find((p) => p.entityId === entityId) || null;
  }

  /**
   * Permet de sauvegarder les changements effectué sur un premium.
   */
  async savePremium(premium: IPremium): Promise<void> {
    const premiums = await this.readJsonFile(this.premiumPath);
    const index = premiums.findIndex((p) => p.entityId === premium.entityId);
    if (index !== -1) {
      premiums[index] = premium;
    } else {
      premiums.push(premium);
    }
    await this.writeJsonFile(this.premiumPath, premiums);
  }

  /**
   * Permet de trouver un code premium.
   */
  async findPremiumCode(code: string): Promise<IPremiumCode | null> {
    const premiumCodes = await this.readJsonFile(this.premiumCodePath);
    return premiumCodes.find((pc) => pc.code === code) || null;
  }

  /**
   * Permet de sauvegarder un code.
   */
  async savePremiumCode(premiumCode: IPremiumCode): Promise<void> {
    const premiumCodes = await this.readJsonFile(this.premiumCodePath);

    // Vérifie si le code existe déjà
    const existingCodeIndex = premiumCodes.findIndex(
      (code: IPremiumCode) => code.code === premiumCode.code
    );

    if (existingCodeIndex !== -1) {
      premiumCodes[existingCodeIndex] = {
        ...premiumCodes[existingCodeIndex],
        ...premiumCode,
      };
    } else {
      // Le code n'existe pas, on l'ajoute
      premiumCodes.push(premiumCode);
    }

    // Sauvegarde les modifications
    await this.writeJsonFile(this.premiumCodePath, premiumCodes);
  }

  /**
   * Permet d'obtenir les codes expirés.
   */
  async findExpiredPremiums(): Promise<IPremium[]> {
    const premiums = await this.readJsonFile(this.premiumPath);
    const now = new Date();
    return premiums.filter(
      (p) => p.isPremium && p.expiresAt && p.expiresAt < now
    );
  }

  /**
   * Permet d'obtenir tout les premiums.
   */
  async getAllPremiums(): Promise<IPremium[]> {
    return this.readJsonFile(this.premiumPath);
  }

  /**
   * Permet d'obtenir tout les codes.
   */
  async getAllPremiumCodes(): Promise<IPremiumCode[]> {
    return this.readJsonFile(this.premiumCodePath);
  }
}

export class PremiumManager extends EventEmitter {
  private storage: IStorage;
  private config: Required<IPremiumConfig>;
  private cache: NodeCache;

  constructor(
    config: IPremiumConfig & {
      storage: "mongo" | "local";
      localDataDir?: string;
    }
  ) {
    super();
    this.config = {
      maxActivationsPerCode: 1,
      cacheTTL: 0,
      preloadTables: true,
      codeLength: 12,
      defaultPremiumDuration: 30,
      ...config,
    };

    if (config.storage === "mongo") {
      this.storage = new MongoStorage();
    } else {
      if (!config.localDataDir) config.localDataDir = "./";
      this.storage = new LocalStorage(config.localDataDir);
    }

    this.cache = new NodeCache({ stdTTL: this.config.cacheTTL });
  }

  /**
   * Permet de trouver une donnée dans le cache.
   */
  private getCacheKey(type: string, id: string): string {
    return `${type}_${id}`;
  }

  /**
   * Permet de vérifier si l'entité est premium.
   */
  async isPremium(entityId: string): Promise<boolean> {
    const cacheKey = this.getCacheKey("isPremium", entityId);
    const cachedResult = this.cache.get<boolean>(cacheKey);

    if (cachedResult !== undefined) return cachedResult;

    const entity = await this.storage.findPremium(entityId);
    const isPremium =
      entity?.isPremium && (!entity.expiresAt || entity.expiresAt > new Date());

    if (!isPremium && entity?.isPremium) {
      await this.removePremium(entityId);
    }

    this.cache.set(cacheKey, isPremium);
    return isPremium || false;
  }

  /**
   * Permet d'ajouter un premium à une entité.
   */
  async addPremium(
    entityId: string,
    duration: number,
    activatedBy: string
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    await this.storage.savePremium({
      entityId,
      isPremium: true,
      expiresAt,
      activatedBy,
      activatedAt: new Date(),
    });

    this.cache.del(this.getCacheKey("isPremium", entityId));
    this.cache.del(this.getCacheKey("premiumStatus", entityId));
    this.emit("premiumAdded", { entityId, expiresAt, activatedBy });
  }

  /**
   * Permet de supprimer le premium à une entité.
   */
  async removePremium(entityId: string): Promise<void> {
    const entity = await this.storage.findPremium(entityId);
    if (entity) {
      entity.isPremium = false;
      entity.expiresAt = null;
      await this.storage.savePremium(entity);

      this.cache.del(this.getCacheKey("isPremium", entityId));
      this.cache.del(this.getCacheKey("premiumStatus", entityId));
      this.emit("premiumRemoved", { entityId });
    }
  }

  /**
   * Permet d'obtenir des informations conçernant le premium d'une entité.
   */
  async getPremiumStatus(entityId: string): Promise<IPremium | null> {
    const cacheKey = this.getCacheKey("premiumStatus", entityId);
    const cachedResult = this.cache.get<IPremium | null>(cacheKey);

    if (cachedResult !== undefined) {
      console.log("Statut premium récupéré du cache");
      return cachedResult;
    }

    const status = await this.storage.findPremium(entityId);
    this.cache.set(cacheKey, status);

    console.log(
      status
        ? "Statut premium récupéré du stockage"
        : "Aucun statut premium trouvé"
    );
    return status;
  }

  /**
   * Permet d'obtenir le temps restant avant la fin du premium d'une entité. (en jours)
   */
  async getPremiumTimeRemaining(entityId: string): Promise<number | null> {
    const status = await this.getPremiumStatus(entityId);
    if (!status?.isPremium || !status.expiresAt) return null;

    const timeRemaining = Math.max(
      0,
      Math.ceil(
        (new Date(status.expiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    );
    return timeRemaining;
  }

  /**
   * Permet de créé un code premium.
   */
  async createPremiumCode(
    createdBy: string,
    duration?: number,
    maxActivations?: number
  ): Promise<string> {
    const code = generateCode(this.config.codeLength);
    await this.storage.savePremiumCode({
      code,
      duration: duration || this.config.defaultPremiumDuration,
      maxActivations: maxActivations || this.config.maxActivationsPerCode,
      createdBy,
      createdAt: new Date(),
      activations: [],
    });

    this.emit("premiumCodeCreated", { code, duration, createdBy });
    return code;
  }

  /**
   * Permet de récupérer un code premium.
   */
  async redeemPremiumCode(
    entityId: string,
    code: string,
    redeemedBy: string
  ): Promise<boolean> {
    const premiumCode = await this.storage.findPremiumCode(code);

    if (
      !premiumCode ||
      premiumCode.activations.length >= premiumCode.maxActivations
    )
      return false;

    premiumCode.activations.push({ entityId, activatedAt: new Date() });
    await this.storage.savePremiumCode(premiumCode);

    await this.addPremium(entityId, premiumCode.duration, redeemedBy);
    this.emit("premiumCodeRedeemed", { entityId, code, redeemedBy });
    return true;
  }

  /**
   * Permet de vérifier si le premium des entités est expiré. Si oui, le premium est retiré.
   */
  async checkExpiredPremiums(): Promise<void> {
    const expiredEntities = await this.storage.findExpiredPremiums();

    for (const entity of expiredEntities) {
      await this.removePremium(entity.entityId);
    }
  }

  /**
   * Permet d'obtenir des informations conçernant un code premium.
   */
  async getPremiumCodeInfo(code: string): Promise<IPremiumCode | null> {
    const cacheKey = this.getCacheKey("premiumCodeInfo", code);
    const cachedResult = this.cache.get<IPremiumCode | null>(cacheKey);

    if (cachedResult !== undefined) return cachedResult;

    const codeInfo = await this.storage.findPremiumCode(code);
    this.cache.set(cacheKey, codeInfo);
    return codeInfo;
  }

  /**
   * Permet d'étendre un premium existant. (en jours)
   */
  async extendPremium(entityId: string, days: number): Promise<void> {
    const entity = await this.storage.findPremium(entityId);
    if (!entity?.isPremium) {
      throw new Error("Entity is not premium");
    }

    const newExpiresAt = entity.expiresAt
      ? new Date(new Date(entity.expiresAt).getTime() + days * 86400000)
      : new Date(Date.now() + days * 86400000);

    entity.expiresAt = newExpiresAt;
    await this.storage.savePremium(entity);

    this.cache.del(this.getCacheKey("isPremium", entityId));
    this.cache.del(this.getCacheKey("premiumStatus", entityId));

    this.emit("premiumExtended", { entityId, newExpiresAt });
  }

  /**
   * Lorsqu'un premium est ajouté.
   */
  onPremiumAdded(
    listener: (data: {
      entityId: string;
      expiresAt: Date;
      activatedBy: string;
    }) => void
  ): void {
    this.on("premiumAdded", listener);
  }

  /**
   * Lorsqu'un premium est retiré.
   */
  onPremiumRemoved(listener: (data: { entityId: string }) => void): void {
    this.on("premiumRemoved", listener);
  }

  /**
   * Lorsqu'un code premium est créé.
   */
  onPremiumCodeCreated(
    listener: (data: {
      code: string;
      duration: number;
      createdBy: string;
    }) => void
  ): void {
    this.on("premiumCodeCreated", listener);
  }

  /**
   * Lorsqu'un code premium est récupéré.
   */
  onPremiumCodeRedeemed(
    listener: (data: {
      entityId: string;
      code: string;
      redeemedBy: string;
    }) => void
  ): void {
    this.on("premiumCodeRedeemed", listener);
  }

  /**
   * Lorsqu'un premium est étendu.
   */
  onPremiumExtended(
    listener: (data: { entityId: string; newExpiresAt: Date }) => void
  ): void {
    this.on("premiumExtended", listener);
  }

  /**
   * Permet de mettre en cache les données existant.
   */
  private async preloadTables(): Promise<void> {
    console.log("Préchargement des tables...");

    try {
      const [premiums, premiumCodes] = await Promise.all([
        this.storage.getAllPremiums(),
        this.storage.getAllPremiumCodes(),
      ]);

      premiums.forEach((premium) => {
        this.cache.set(
          this.getCacheKey("isPremium", premium.entityId),
          premium.isPremium
        );
        this.cache.set(
          this.getCacheKey("premiumStatus", premium.entityId),
          premium
        );
      });

      premiumCodes.forEach((code) => {
        this.cache.set(this.getCacheKey("premiumCodeInfo", code.code), code);
      });

      console.log(
        `Préchargement terminé. ${premiums.length} primes et ${premiumCodes.length} codes chargés.`
      );
    } catch (error) {
      console.error("Erreur lors du préchargement des tables:", error);
    }
  }

  /**
   * Permet de rafraichir le cache.
   */
  async clearCache(): Promise<void> {
    this.cache.flushAll();
    if (this.config.preloadTables) {
      await this.preloadTables();
    }
  }
}
