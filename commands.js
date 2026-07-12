import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("ตั้งค่า auto reaction")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("เพิ่ม rule สำหรับ auto reaction")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("ห้องที่ต้องการให้บอท react")
            .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emojis")
            .setDescription("emoji เช่น 🔥 หรือ custom emoji จาก server")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("keyword")
            .setDescription("คำที่ต้องเจอในข้อความ เว้นว่าง = ทุกข้อความ")
            .setRequired(false)
            .setMaxLength(100)
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("วิธี match keyword")
            .setRequired(false)
            .addChoices(
              { name: "ทุกข้อความ", value: "all" },
              { name: "มีคำนี้อยู่", value: "contains" },
              { name: "ตรงทั้งข้อความ", value: "exact" },
              { name: "regular expression", value: "regex" }
            )
        )
        .addBooleanOption((option) =>
          option
            .setName("ignore_bots")
            .setDescription("ไม่ react ข้อความจากบอทอื่น")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("ดู auto reaction rules ทั้งหมด")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("scan")
        .setDescription("scan recent messages and apply reactions")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("ลบ rule")
        .addStringOption((option) =>
          option.setName("id").setDescription("rule id").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("toggle")
        .setDescription("เปิดหรือปิด rule")
        .addStringOption((option) =>
          option.setName("id").setDescription("rule id").setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("เปิด = true, ปิด = false")
            .setRequired(true)
        )
    )
].map((command) => command.toJSON());
