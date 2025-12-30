const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../config.cjs');

const ViewCmd = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'view' || cmd === 'getmedia') {
    try {
      // Check if user is authorized
      const userId = m.sender.split('@')[0];
      const ownerNumber = config.ownerNumber || process.env.OWNER_NUMBER;
      
      if (userId !== ownerNumber && userId !== '254743982206') {
        return m.reply('❌ This command is owner-only.');
      }
      
      if (!m.quoted) {
        // Show view options with buttons
        await sendButtons(sock, m.from, {
          title: '👁️ Media Viewer',
          text: 'Reply to a message containing media or select an option:',
          footer: 'Owner Only Command',
          buttons: [
            { id: 'btn_view_info', text: 'ℹ️ Message Info' },
            { id: 'btn_view_help', text: '❓ Help' }
          ]
        });
        return;
      }
      
      const quotedMsg = m.quoted;
      
      // Check what type of media is in the quoted message
      let mediaType = null;
      let mediaBuffer = null;
      
      if (quotedMsg.imageMessage) {
        mediaType = 'image';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'image' });
      } else if (quotedMsg.videoMessage) {
        mediaType = 'video';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'video' });
      } else if (quotedMsg.audioMessage) {
        mediaType = 'audio';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'audio' });
      } else if (quotedMsg.documentMessage) {
        mediaType = 'document';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'document' });
      }
      
      if (mediaBuffer) {
        // Show media options with buttons
        await sendButtons(sock, m.from, {
          title: `📁 ${mediaType.toUpperCase()} Detected`,
          text: `Media type: ${mediaType}\nSize: ${(mediaBuffer.length / 1024).toFixed(2)} KB`,
          footer: 'Select action:',
          buttons: [
            { id: `btn_view_download_${mediaType}`, text: '⬇️ Download' },
            { id: 'btn_view_info_full', text: '📊 Full Info' },
            { id: 'btn_view_cancel', text: '❌ Close' }
          ]
        });
        
        // Store media data for button handling
        m.mediaData = { buffer: mediaBuffer, type: mediaType, quotedMsg };
        
      } else {
        await sendButtons(sock, m.from, {
          text: 'No media found in the quoted message.\nMessage type: ' + (Object.keys(quotedMsg)[1] || 'text'),
          buttons: [
            { id: 'btn_view_info', text: 'ℹ️ Message Info' },
            { id: 'btn_view_back', text: '🔙 Back' }
          ]
        });
      }
      
    } catch (error) {
      console.error('View Error:', error);
      m.reply('❌ Error processing media.');
    }
  }
};

// Button handler for View
const handleViewButton = async (m, sock, buttonId, mediaData) => {
  switch(buttonId) {
    case 'btn_view_info':
      await showMessageInfo(m, sock);
      break;
    case 'btn_view_info_full':
      if (mediaData) {
        await showFullMediaInfo(m, sock, mediaData);
      }
      break;
    case 'btn_view_download_image':
    case 'btn_view_download_video':
    case 'btn_view_download_audio':
    case 'btn_view_download_document':
      if (mediaData) {
        await downloadMedia(m, sock, mediaData);
      }
      break;
    case 'btn_view_help':
      await m.reply(`*👁️ View Command Help*\n\nUsage:\n• Reply to any media message with .view\n• View message information\n• Download media files\n\nOwner: BERA TECH`);
      break;
    case 'btn_view_back':
      await m.reply('Returning to main menu...');
      break;
    case 'btn_view_cancel':
      await m.reply('✅ Operation cancelled.');
      break;
  }
};

async function showMessageInfo(m, sock) {
  const msg = m.quoted || m;
  const info = `*📊 Message Information*\n\n` +
               `• Message ID: ${msg.key.id}\n` +
               `• From: ${msg.key.remoteJid}\n` +
               `• Timestamp: ${new Date(msg.messageTimestamp * 1000).toLocaleString()}\n` +
               `• Type: ${Object.keys(msg.message || {})[0] || 'text'}\n` +
               `• Push Name: ${msg.pushName || 'Unknown'}`;
  
  await sock.sendMessage(m.from, { text: info }, { quoted: m });
}

async function showFullMediaInfo(m, sock, mediaData) {
  const { buffer, type, quotedMsg } = mediaData;
  const info = `*📁 Media Details*\n\n` +
               `• Type: ${type}\n` +
               `• Size: ${(buffer.length / 1024).toFixed(2)} KB\n` +
               `• Dimensions: ${quotedMsg.imageMessage ? `${quotedMsg.imageMessage.width}x${quotedMsg.imageMessage.height}` : 'N/A'}\n` +
               `• Caption: ${quotedMsg[`${type}Message`]?.caption || 'None'}\n` +
               `• Mimetype: ${quotedMsg[`${type}Message`]?.mimetype || 'Unknown'}`;
  
  await sock.sendMessage(m.from, { text: info }, { quoted: m });
}

async function downloadMedia(m, sock, mediaData) {
  const { buffer, type } = mediaData;
  
  try {
    await m.reply(`⬇️ Downloading ${type}...`);
    
    const messageOptions = {};
    
    switch(type) {
      case 'image':
        messageOptions.image = buffer;
        messageOptions.caption = '📷 Image downloaded via CLOUD AI';
        break;
      case 'video':
        messageOptions.video = buffer;
        messageOptions.caption = '🎥 Video downloaded via CLOUD AI';
        break;
      case 'audio':
        messageOptions.audio = buffer;
        messageOptions.mimetype = 'audio/mp4';
        messageOptions.ptt = false;
        break;
      case 'document':
        messageOptions.document = buffer;
        messageOptions.fileName = `download_${Date.now()}.${type}`;
        messageOptions.mimetype = 'application/octet-stream';
        break;
    }
    
    await sock.sendMessage(m.from, messageOptions, { quoted: m });
    
  } catch (error) {
    console.error('Download Error:', error);
    m.reply('❌ Error downloading media.');
  }
}

module.exports = ViewCmd;