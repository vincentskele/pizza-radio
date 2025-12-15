require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

// ========= ENV =========
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID; // optional default VC to join on startup
const GUILD_ID = process.env.DISCORD_GUILD_ID; // required for startup auto-join in your current design

const PREFIX = (process.env.PREFIX || process.env.COMMAND_PREFIX || '!').trim();

// ========= CLIENT =========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,

    // Needed for prefix commands:
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Track last voice channel the bot was connected to (per guild)
const lastVoiceChannelIdByGuild = new Map();

// ========= COMMAND LOADING =========
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`Loaded command: ${command.data.name}`);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    );
  }
}

// ========= VOICE HELPERS =========
function getGuild(guildId) {
  return client.guilds.cache.get(guildId) || null;
}

function getVoiceChannelFromId(guild, channelId) {
  if (!guild || !channelId) return null;
  const ch = guild.channels.cache.get(channelId);
  // Discord.js v14 voice channel type is 2, but stage is 13; add both if you want.
  if (!ch) return null;
  if (ch.type !== 2 && ch.type !== 13) return null;
  return ch;
}

function resolvePreferredVoiceChannel({ guild, member }) {
  // 1) If invoker is in VC, use that
  const memberVcId = member?.voice?.channelId;
  if (memberVcId) {
    const ch = getVoiceChannelFromId(guild, memberVcId);
    if (ch) return ch;
  }

  // 2) Else: use last VC the bot was in
  const lastId = lastVoiceChannelIdByGuild.get(guild?.id);
  if (lastId) {
    const ch = getVoiceChannelFromId(guild, lastId);
    if (ch) return ch;
  }

  // 3) Else: fall back to env VC (if provided and exists)
  if (VOICE_CHANNEL_ID) {
    const ch = getVoiceChannelFromId(guild, VOICE_CHANNEL_ID);
    if (ch) return ch;
  }

  return null;
}

function ensureBotInVoiceChannel(guild, voiceChannel) {
  if (!guild || !voiceChannel) return null;

  // If already connected, keep it (discordjs/voice connection is per guild)
  const existing = getVoiceConnection(guild.id);
  if (existing) {
    // Update last channel tracking (in case bot got moved)
    lastVoiceChannelIdByGuild.set(guild.id, voiceChannel.id);
    return existing;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  lastVoiceChannelIdByGuild.set(guild.id, voiceChannel.id);
  console.log(`Joined voice channel: ${voiceChannel.name}`);

  return connection;
}

// Wrap interaction.member.voice.channel/channelId so command guards see the fallback VC
function patchInteractionVoice(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  const preferred = resolvePreferredVoiceChannel({ guild, member });

  // If we found a preferred channel, make sure bot is connected there
  if (preferred) {
    ensureBotInVoiceChannel(guild, preferred);
  }

  // Proxy member.voice.channel/channelId for command checks
  const patchedVoice = new Proxy(member?.voice ?? {}, {
    get(target, prop) {
      if (prop === 'channel') return member?.voice?.channel || preferred || null;
      if (prop === 'channelId') return member?.voice?.channelId || preferred?.id || null;
      return Reflect.get(target, prop);
    },
  });

  const patchedMember = new Proxy(member, {
    get(target, prop) {
      if (prop === 'voice') return patchedVoice;
      return Reflect.get(target, prop);
    },
  });

  const patchedInteraction = new Proxy(interaction, {
    get(target, prop) {
      if (prop === 'member') return patchedMember;
      return Reflect.get(target, prop);
    },
  });

  return patchedInteraction;
}

// ========= STARTUP AUTO-JOIN =========
function joinVoiceChannelHandlerOnReady() {
  if (!GUILD_ID) {
    console.warn('DISCORD_GUILD_ID is not set; skipping startup auto-join.');
    return;
  }

  const guild = getGuild(GUILD_ID);
  if (!guild) {
    console.error('The specified guild was not found. Please check DISCORD_GUILD_ID.');
    return;
  }

  // Prefer env channel on startup; otherwise last-known (none yet) -> no join
  const vc = getVoiceChannelFromId(guild, VOICE_CHANNEL_ID);
  if (!vc) {
    console.warn(
      'Startup: VOICE_CHANNEL_ID not set/invalid; bot will join when commands run or when moved.'
    );
    return;
  }

  ensureBotInVoiceChannel(guild, vc);
}

// ========= EVENTS =========
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  joinVoiceChannelHandlerOnReady();
});

// Track bot being moved/disconnected and update last channel
client.on('voiceStateUpdate', (oldState, newState) => {
  // Only care about the bot user
  if (!client.user) return;
  if (newState.id !== client.user.id) return;

  // Bot moved or joined a channel
  if (newState.channelId) {
    lastVoiceChannelIdByGuild.set(newState.guild.id, newState.channelId);
    return;
  }

  // Bot disconnected: attempt to rejoin last known channel
  const lastId = lastVoiceChannelIdByGuild.get(newState.guild.id);
  if (lastId) {
    const guild = newState.guild;
    const vc = getVoiceChannelFromId(guild, lastId);
    if (vc) {
      console.log('Bot was disconnected. Attempting to rejoin last known voice channel...');
      ensureBotInVoiceChannel(guild, vc);
    }
  }
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  // Patch interaction so voice-channel guards see the fallback channel
  const patched = patchInteractionVoice(interaction);

  try {
    await command.execute(patched);
    console.log(`Executed slash command: ${interaction.commandName}`);
  } catch (error) {
    console.error(`Error executing slash command ${interaction.commandName}:`, error);
    const payload = { content: 'There was an error executing that command!', ephemeral: true };

    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (_) {}
  }
});

// Prefix commands (bots allowed)
client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return; // no DMs

    // Prefix check
    if (!PREFIX || !message.content.startsWith(PREFIX)) return;

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) return;

    const parts = content.split(/\s+/);
    const commandName = (parts.shift() || '').toLowerCase();
    const args = parts;

    const command = client.commands.get(commandName);
    if (!command) return;

    // If invoker isn't in VC, make sure bot joins last VC (or env VC) before running the command
    const guild = message.guild;
    const member = message.member;
    const preferred = resolvePreferredVoiceChannel({ guild, member });
    if (preferred) ensureBotInVoiceChannel(guild, preferred);

    // Prefer a dedicated message handler if your command modules support it
    if (typeof command.executeMessage === 'function') {
      await command.executeMessage(message, args);
      console.log(`Executed prefix command: ${commandName}`);
      return;
    }

    // Fallback: if command doesn't support prefix mode yet
    await message.reply(`That command is currently slash-only: \`/${commandName}\``);
  } catch (error) {
    console.error('Error handling prefix command:', error);
    try {
      await message.reply('There was an error executing that command!');
    } catch (_) {}
  }
});

// ========= LOGIN =========
client.login(TOKEN).catch((error) => {
  console.error('Failed to log in:', error);
});
