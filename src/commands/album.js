const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to the songs folder
const songsFolder = path.join(__dirname, '../../songs');

// Path to the playlist file
const playlistFile = path.join(songsFolder, 'playlist.json');

async function run({ folderName, reply }) {
  try {
    if (!folderName || !folderName.trim()) {
      return reply('Usage: album <folder>\nExample: `album "Pizza Collection PizzaDAO\'s House Band"`');
    }

    const targetFolder = path.join(songsFolder, folderName);

    if (!fs.existsSync(targetFolder)) {
      return reply(`The folder "${folderName}" does not exist. Please check the name and try again.`);
    }

    // Check if playlist.json exists
    if (!fs.existsSync(playlistFile)) {
      return reply('The playlist.json file does not exist. Please run the /playlist command first.');
    }

    // Read and parse playlist.json
    const playlistData = JSON.parse(fs.readFileSync(playlistFile, 'utf-8'));

    if (!playlistData.songs || !Array.isArray(playlistData.songs)) {
      return reply('Invalid playlist data. Please regenerate the playlist using the /playlist command.');
    }

    // Filter songs based on the specified folder
    const folderPath = path
      .relative(songsFolder, targetFolder)
      .replace(/\\/g, '/'); // Normalize for Windows paths

    const songsInFolder = playlistData.songs.filter((song) => song.path.startsWith(folderPath));

    if (songsInFolder.length === 0) {
      return reply(`No songs found in the folder "${folderName}".`);
    }

    // Generate song list with IDs
    const songList = songsInFolder.map((song) => `${song.id}: ${song.path}`);

    // Discord embed description limit is 4096 chars; chunk if needed
    const MAX_DESC = 4096;
    const chunks = [];
    let current = '';

    for (const line of songList) {
      // +1 for newline
      if ((current.length + line.length + 1) > MAX_DESC) {
        chunks.push(current);
        current = '';
      }
      current += (current ? '\n' : '') + line;
    }
    if (current) chunks.push(current);

    const embeds = chunks.map((desc, idx) =>
      new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle(idx === 0 ? `🎵 Album: ${folderName}` : `🎵 Album: ${folderName} (cont.)`)
        .setDescription(desc)
        .setFooter({
          text:
            idx === chunks.length - 1
              ? `Total songs: ${songsInFolder.length}`
              : `Page ${idx + 1}/${chunks.length}`,
        })
    );

    return reply({ embeds });
  } catch (error) {
    console.error('Error fetching album songs:', error);
    return reply('There was an error trying to load the album.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('album')
    .setDescription('Displays the song IDs for the specified album (folder)')
    .addStringOption((option) =>
      option
        .setName('folder')
        .setDescription('The name of the folder to display songs from')
        .setRequired(true)
    ),

  // Slash command handler
  async execute(interaction) {
    const folderName = interaction.options.getString('folder');

    // Use ephemeral for errors? Keep same behavior as before (public)
    return run({
      folderName,
      reply: (payload) => interaction.reply(payload),
    });
  },

  // Prefix command handler: !album <folder name>
  async executeMessage(message, args) {
    // Allow multi-word folder names: !album Pizza Collection PizzaDAO's House Band
    const folderName = args.join(' ').trim();

    return run({
      folderName,
      reply: (payload) => message.channel.send(payload),
    });
  },
};
