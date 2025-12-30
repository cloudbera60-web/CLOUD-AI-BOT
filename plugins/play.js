const axios = require("axios");
const yts = require("yt-search");
const { sendButtons } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");
  
  if (cmd === "play") {
    try {
      if (args.length === 0 || !args.join(" ")) {
        // Show music center
        await sendButtons(sock, m.from, {
          title: '🎵 CLOUD AI Music Center',
          text: `*Professional Audio Processing*\n\n` +
                `🎧 **Supported Services:**\n` +
                `• YouTube Music\n` +
                `• SoundCloud (Coming Soon)\n` +
                `• Spotify (Coming Soon)\n\n` +
                `⚡ **Features:**\n` +
                `• High Quality Audio\n` +
                `• Fast Download\n` +
                `• Metadata Preserved\n\n` +
                `*Search for music or browse categories:*`,
          footer: 'Professional Audio Streaming | CLOUD AI',
          buttons: [
            { id: 'btn_music_search', text: '🔍 Search Music' },
            { id: 'btn_music_pop', text: '🎤 Pop Hits' },
            { id: 'btn_music_hiphop', text: '🎧 Hip Hop' },
            { id: 'btn_music_afro', text: '🌍 Afro Beats' },
            { id: 'btn_music_help', text: '❓ How to Use' }
          ]
        });
        return;
      }
      
      const searchQuery = args.join(" ");
      const searchMsg = await m.reply(`🔍 *Searching Music Library*\n\n` +
        `🎵 **Query:** ${searchQuery}\n` +
        `⏱️ **Status:** Searching...\n\n` +
        `_Please wait while we find your music..._`);
      
      const searchResults = await yts(searchQuery);
      
      if (!searchResults.videos || searchResults.videos.length === 0) {
        return m.reply(`❌ *No Results Found*\n\n` +
          `🔍 **Search:** ${searchQuery}\n` +
          `📊 **Results:** 0 matches\n\n` +
          `_Try a different search term._`);
      }
      
      const firstResult = searchResults.videos[0];
      const videoUrl = firstResult.url;
      
      // Download audio
      await m.reply(`⬇️ *Downloading Audio*\n\n` +
        `🎵 **Title:** ${firstResult.title}\n` +
        `⏱️ **Duration:** ${firstResult.timestamp}\n` +
        `👤 **Artist:** ${firstResult.author.name}\n` +
        `📊 **Status:** Processing...`);
      
      const apiUrl = `https://api.davidcyriltech.my.id/download/ytmp3?url=${videoUrl}`;
      const response = await axios.get(apiUrl);
      
      if (!response.data.success) {
        return m.reply(`❌ *Download Failed*\n\n` +
          `🎵 **Title:** ${firstResult.title}\n` +
          `⚠️ **Error:** Service unavailable\n\n` +
          `_Please try again later._`);
      }
      
      const { title, download_url } = response.data.result;
      
      // Send audio with premium interface
      await sock.sendMessage(m.from, {
        audio: { url: download_url },
        mimetype: "audio/mp4",
        ptt: false,
        contextInfo: {
          externalAdReply: {
            title: "🎵 CLOUD AI Music Player",
            body: title.substring(0, 30) + "...",
            mediaType: 2,
            thumbnailUrl: firstResult.thumbnail,
            mediaUrl: videoUrl,
            sourceUrl: videoUrl
          }
        }
      }, { quoted: m });
      
      // Success message
      await sendButtons(sock, m.from, {
        title: '✅ Download Complete',
        text: `*AUDIO DOWNLOAD SUCCESSFUL*\n\n` +
              `✅ **Status:** Downloaded\n` +
              `🎵 **Title:** ${title}\n` +
              `⏱️ **Duration:** ${firstResult.timestamp}\n` +
              `👤 **Artist:** ${firstResult.author.name}\n\n` +
              `*Audio has been sent to your chat.*`,
        footer: 'CLOUD AI Music Center | Professional Quality',
        buttons: [
          { id: 'btn_music_play_again', text: '🔄 Play Another' },
          { id: 'btn
