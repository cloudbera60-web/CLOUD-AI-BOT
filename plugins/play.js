const axios = require("axios");
const yts = require("yt-search");
const { sendButtons } = require('gifted-btns');

const play = async (m, gss) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");

  if (cmd === "play") {
    if (args.length === 0 || !args.join(" ")) {
      // Show music categories with buttons
      await sendButtons(gss, m.from, {
        title: '🎵 Music Player',
        text: 'Select a music category or use `.play song name`',
        footer: 'CLOUD AI Music System',
        buttons: [
          { id: 'btn_music_pop', text: '🎤 Pop Music' },
          { id: 'btn_music_hiphop', text: '🎧 Hip Hop' },
          { id: 'btn_music_rock', text: '🎸 Rock' },
          { id: 'btn_music_jazz', text: '🎷 Jazz' }
        ]
      });
      return;
    }

    const searchQuery = args.join(" ");
    m.reply("*☁️ Searching for the song...*");

    try {
      const searchResults = await yts(searchQuery);
      if (!searchResults.videos || searchResults.videos.length === 0) {
        return m.reply(`❌ No results found for "${searchQuery}".`);
      }

      const firstResult = searchResults.videos[0];
      const videoUrl = firstResult.url;

      // Your exact API endpoint
      const apiUrl = `https://api.davidcyriltech.my.id/download/ytmp3?url=${videoUrl}`;
      const response = await axios.get(apiUrl);

      if (!response.data.success) {
        return m.reply(`❌ Failed to fetch audio for "${searchQuery}".`);
      }

      const { title, download_url } = response.data.result;

      // Send the audio file
      await gss.sendMessage(
        m.from,
        {
          audio: { url: download_url },
          mimetype: "audio/mp4",
          ptt: false,
        },
        { quoted: m }
      );

      m.reply(`✅ *${title}* has been downloaded successfully!`);
    } catch (error) {
      console.error(error);
      m.reply("❌ An error occurred while processing your request.");
    }
  }
};

module.exports = play;
