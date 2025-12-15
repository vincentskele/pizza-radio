const { SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const state = require('../state'); // shared state

const targetFolder = path.join(__dirname, '../../songs/lobo');

// Supported audio extensions
const supportedExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

// Get audio files recursively from a folder
function getAudioFilesRecursively(folder) {
  let files = [];
  fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAudioFilesRecursively(fullPath));
    } else if (supportedExtensions.includes(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  });
  return files;
}

// Get immediate subfolders (albums) under targetFolder
function getSubfolders() {
  return fs
    .readdirSync(targetFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(targetFolder, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Shuffle helper (Fisher–Yates)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function run({ member, reply, albumId }) {
  try {
    if (!fs.existsSync(targetFolder)) {
      return reply(
        'The folder does not exist. Please make sure the songs are in the correct location.'
      );
    }

    const subfolders = getSubfolders();

    // Determine play folder + order
    let playFolder = targetFolder;
    let playOrder = 'random';
    let albumName = 'all songs';

    if (albumId) {
      const album = subfolders[albumId - 1];
      if (!album) {
        return reply(
          `Album ${albumId} does not exist. Please choose a valid album number (1, 2, or 3).`
        );
      }
      playFolder = album.path;
      playOrder = 'ordered';
      albumName = album.name;
    }

    // Collect files
    let allFiles = getAudioFilesRecursively(playFolder);

    if (allFiles.length === 0) {
      return reply(
        'The folder is empty or contains unsupported file types. Add some songs to the folder first.'
      );
    }

    // Shuffle if random
    if (playOrder === 'random') {
      allFiles = shuffleArray([...allFiles]);
    }

    // Must be in voice channel
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return reply('You need to be in a voice channel to play music!');
    }

    // Join voice
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Create player
    state.player = createAudioPlayer();

    // Store queue
    state.queue = [...allFiles];

    const playNextSong = () => {
      try {
        if (!state.queue || state.queue.length === 0) {
          console.log('Finished all songs.');
          return;
        }

        const nextSong = state.queue.shift();
        const resource = createAudioResource(nextSong);

        console.log(`Playing: ${nextSong}`);
        state.player.play(resource);
      } catch (err) {
        console.error('Error in playNextSong:', err);
      }
    };

    // Prevent stacking listeners if command is run repeatedly
    state.player.removeAllListeners(AudioPlayerStatus.Idle);
    state.player.removeAllListeners('error');

    state.player.on(AudioPlayerStatus.Idle, playNextSong);

    state.player.on('error', (error) => {
      console.error('Error during playback:', error);
      playNextSong();
    });

    // Subscribe
    state.connection.subscribe(state.player);

    // Start
    playNextSong();

    const playbackMessage = albumId
      ? `🎵 Playing Album ${albumId} (${albumName}) from the songs/lobo folder in order!`
      : '🎵 Playing all songs from the songs/lobo folder in random order!';

    return reply(playbackMessage);
  } catch (error) {
    console.error('Error executing the lobo command:', error);
    return reply('There was an error trying to play the songs.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lobo')
    .setDescription('Plays songs from the lobo folder randomly or by specific album')
    .addIntegerOption((option) =>
      option
        .setName('album')
        .setDescription('Specify the album number (1, 2, or 3)')
        .setMinValue(1)
        .setMaxValue(3)
    ),

  // Slash command: /lobo album:2
  async execute(interaction) {
    const albumId = interaction.options.getInteger('album'); // number or null
    return run({
      member: interaction.member,
      albumId,
      reply: (payload) => interaction.reply(payload),
    });
  },

  // Prefix command:
  //   !lobo           -> random all
  //   !lobo 2         -> album 2 ordered
  async executeMessage(message, args) {
    const raw = (args[0] || '').trim();
    const albumId = raw ? Number.parseInt(raw, 10) : null;

    // If they typed something non-numeric, treat as no-album (random all),
    // or you can return usage — your choice. I’ll return usage to avoid confusion.
    if (raw && Number.isNaN(albumId)) {
      return message.channel.send('Usage: `lobo` or `lobo <albumNumber>` (example: `lobo 2`)');
    }

    return run({
      member: message.member,
      albumId: albumId || null,
      reply: (payload) => message.channel.send(payload),
    });
  },
};
