import { Schema } from "mongoose";

export const PremiumCodeSchema: Schema = new Schema({
  code: { type: String, required: true, unique: true },
  duration: { type: Number, required: true },
  maxActivations: { type: Number, required: true },
  activations: [{ guildId: String, activatedAt: Date }],
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
