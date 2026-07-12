import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";

const DEFAULT_STATE = {
  guilds: {}
};

export class ConfigStore {
  constructor(filePath) {
    this.filePath = resolve(filePath || "./data/rules.json");
    this.state = structuredClone(DEFAULT_STATE);
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw);
      if (!this.state.guilds) this.state.guilds = {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  getGuild(guildId) {
    if (!this.state.guilds[guildId]) {
      this.state.guilds[guildId] = { rules: [] };
    }
    return this.state.guilds[guildId];
  }

  listRules(guildId) {
    return this.getGuild(guildId).rules;
  }

  async addRule(guildId, rule) {
    const guild = this.getGuild(guildId);
    const savedRule = {
      id: crypto.randomUUID().slice(0, 8),
      enabled: true,
      keyword: "",
      mode: "all",
      ignoreBots: false,
      createdAt: new Date().toISOString(),
      ...rule
    };
    guild.rules.push(savedRule);
    await this.save();
    return savedRule;
  }

  async removeRule(guildId, id) {
    const guild = this.getGuild(guildId);
    const before = guild.rules.length;
    guild.rules = guild.rules.filter((rule) => rule.id !== id);
    await this.save();
    return guild.rules.length !== before;
  }

  async setRuleEnabled(guildId, id, enabled) {
    const rule = this.listRules(guildId).find((item) => item.id === id);
    if (!rule) return null;
    rule.enabled = enabled;
    await this.save();
    return rule;
  }
}
