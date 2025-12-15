const { SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const state = require('../state'); // use shared state so other commands (skip/stop/etc) can interact

// Path to the songs folder
const songsFolder = path.join(__dirname, '../../songs');

// Supported audio file extensions
const supportedExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

// ---------------------
// Helpers
// ---------------------
const levenshteinDistance = (a, b) => {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[a.length][b.length];
};

const normalize = (str) => str.toLowerCase().trim();

const findClosestMatch = (input, filenames) => {
  const normalizedInput = normalize(input);
  let closestMatch = null;
  let lowestDistance = Infinity;

  filenames.forEach((filename) => {
    const normalizedFilename = normalize(filename);
    const distance = levenshteinDistance(normalizedInput, normalizedFilename);
    if (distance < lowestDistance) {
      lowestDistance = distance;
      closestMatch = filename;
    }
  });

  return { closestMatch, lowestDistance };
};

const getFilesRecursively = (folder) => {
  let files = [];
  const entries = fs.readdirSync(folder, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

function getAllSupportedSongFiles() {
  const allFiles = getFilesRecursively(songsFolder);
  return allFiles.filter((file) =>
    supportedExtensions.includes(path.extname(file).toLowerCase())
  );
}

function selectSongFromInput(input, files) {
  const filenames = files.map((file) => path.parse(file).name);

  let selectedSongPath;
  let selectedSongName;

  // If input is an integer, treat as 1-based index
  const inputAsNumber = Number.parseInt(input, 10);
  if (!Number.isNaN(inputAsNumber)) {
    const idx = inputAsNumber - 1;
    if (idx < 0 || idx >= files.length) {
      return {
        error: `Invalid song index: ${inputAsNumber}. Please provide a number between 1 and ${files.length}.`,
      };
    }
    selectedSongPath = files[idx];
    selectedSongName = path.parse(selectedSongPath).name;
    return { selectedSongPath, selectedSongName, matchType: 'index' };
  }

  // Exact match by filename (excluding extension)
  const exactMatch = files.find(
    (file) => normalize(path.parse(file).name) === normalize(input)
  );

  if (exactMatch) {
    selectedSongPath = exactMatch;
    selectedSongName = path.parse(exactMatch).name;
    return { selectedSongPath, selectedSongName, matchType: 'exact' };
  }

  // Fuzzy match
  const { closestMatch, lowestDistance } = findClosestMatch(input, filenames);
  if (closestMatch && lowestDistance <= 6) {
    selectedSongPath = files.find(
      (file) => normalize(path.parse(file).name) === normalize(closestMatch)
    );
    selectedSongName = closestMatch;
    return { selectedSongPath, selectedSongName, matchType: 'fuzzy', distance: lowestDistance };
  }

  return {
    error: `No exact or close match found for **${input}**. Please try again with a valid song ID or filename.`,
  };
}

// ---------------------
// Core runner (shared by slash + prefix)
// ---------------------
async function run({ input, member, reply, followUp }) {
  console.log(`Executing play command (input="${input}")`);

  try {
    if (!fs.existsSync(songsFolder)) {
      return reply('The songs folder does not exist. Please create the folder and add songs.');
    }

    const files = getAllSupportedSongFiles();
    console.log(`Found ${files.length} supported song(s).`);

    if (files.length === 0) {
      return reply(
        'The playlist is empty or contains unsupported file types. Add some songs to the folder first.'
      );
    }

    const selection = selectSongFromInput(input, files);
    if (selection.error) return reply(selection.error);

    const { selectedSongPath, selectedSongName } = selection;

    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return reply('You need to be in a voice channel to play music!');
    }

    // Join the user's voice channel (store in shared state)
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Create (or replace) the shared player
    state.player = createAudioPlayer();

    // Cleanup listeners if play is called repeatedly
    state.player.removeAllListeners(AudioPlayerStatus.Playing);
    state.player.removeAllListeners('error');

    const resource = createAudioResource(selectedSongPath);

    state.player.on(AudioPlayerStatus.Playing, () => {
      console.log(`Now playing: ${selectedSongName}`);
    });

    state.player.on('error', (error) => {
      console.error(`Error playing ${selectedSongName}:`, error);
      if (typeof followUp === 'function') {
        followUp('There was an error playing the song.');
      }
    });

    state.player.play(resource);
    state.connection.subscribe(state.player);

    return reply(`🎵 Now playing: **${selectedSongName}**`);
  } catch (error) {
    console.error('Error playing the song:', error);
    if (typeof followUp === 'function') {
      return followUp('There was an error trying to play the song.');
    }
    return reply('There was an error trying to play the song.');
  }
}

// ---------------------
// Exports
// ---------------------
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Plays a song from the playlist')
    .addStringOption((option) =>
      option
        .setName('input')
        .setDescription('The song ID or filename (excluding extension)')
        .setRequired(true)
    ),

  // Slash: /play input:<id or name>
  async execute(interaction) {
    const input = interaction.options.getString('input');

    return run({
      input,
      member: interaction.member,
      reply: (payload) => interaction.reply(payload),
      followUp: (payload) => interaction.followUp(payload),
    });
  },

  // Prefix: !play <id or name...>
  async executeMessage(message, args) {
    const input = (args || []).join(' ').trim();
    if (!input) {
      return message.channel.send('Usage: `play <song id | filename>` (example: `play 12` or `play my song`)');
    }

    return run({
      input,
      member: message.member,
      reply: (payload) => message.channel.send(payload),
      followUp: (payload) => message.channel.send(payload),
    });
  },
};
