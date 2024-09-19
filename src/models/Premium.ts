import { Schema } from "mongoose";

export const PremiumSchema: Schema = new Schema({
  entityId: { type: String, required: true, unique: true },
  isPremium: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  activatedBy: { type: String, default: null },
  activatedAt: { type: Date, default: null },
});
