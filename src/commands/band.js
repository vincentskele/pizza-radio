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

const targetFolder = path.join(__dirname, '../../songs/band');

// Supported audio extensions
const supportedExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

// Shuffle helper
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getAudioFiles(folder) {
  return fs
    .readdirSync(folder)
    .filter((file) => supportedExtensions.includes(path.extname(file).toLowerCase()));
}

async function run({ member, guild, reply }) {
  try {
    // Check folder exists
    if (!fs.existsSync(targetFolder)) {
      return reply(
        'The folder does not exist. Please make sure the songs are in the correct location.'
      );
    }

    const allFiles = getAudioFiles(targetFolder);

    if (allFiles.length === 0) {
      return reply(
        'The folder is empty or contains unsupported file types. Add some songs to the folder first.'
      );
    }

    // Must be in a voice channel
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return reply('You need to be in a voice channel to play music!');
    }

    // Join the user's voice channel
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Create player if not already created
    state.player = createAudioPlayer();

    // Reset queue to shuffled list
    state.queue = shuffleArray([...allFiles]);

    // Define playNextSong and keep a reference so we can safely remove it if needed
    const playNextSong = () => {
      try {
        // Reshuffle when empty
        if (!state.queue || state.queue.length === 0) {
          console.log('Reshuffling the playlist...');
          state.queue = shuffleArray([...allFiles]);
        }

        const nextSong = state.queue.shift();
        const filePath = path.join(targetFolder, nextSong);

        console.log(`Playing: ${nextSong}`);
        const resource = createAudioResource(filePath);
        state.player.play(resource);
      } catch (err) {
        console.error('Error in playNextSong:', err);
      }
    };

    // IMPORTANT:
    // If this command can be run multiple times, you can accidentally add multiple listeners.
    // Remove old listeners first, then add fresh ones.
    state.player.removeAllListeners(AudioPlayerStatus.Idle);
    state.player.removeAllListeners('error');

    state.player.on(AudioPlayerStatus.Idle, playNextSong);

    state.player.on('error', (error) => {
      console.error('Error during playback:', error);
      playNextSong(); // skip to next
    });

    // Subscribe player to connection
    state.connection.subscribe(state.player);

    // Start playback
    playNextSong();

    return reply(
      '🎵 Playing songs from the Pizza Collection PizzaDAO House Band folder in random order!'
    );
  } catch (error) {
    console.error('Error executing the band command:', error);
    return reply('There was an error trying to play the songs.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('band')
    .setDescription('Plays songs from the Pizza Collection PizzaDAO House Band folder in random order'),

  // Slash handler
  async execute(interaction) {
    return run({
      member: interaction.member,
      guild: interaction.guild,
      reply: (payload) => interaction.reply(payload),
    });
  },

  // Prefix handler: !band
  async executeMessage(message) {
    return run({
      member: message.member,
      guild: message.guild,
      reply: (payload) => message.channel.send(payload),
    });
  },
};
