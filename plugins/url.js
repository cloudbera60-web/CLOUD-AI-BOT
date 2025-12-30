const fetch = require('node-fetch');
const FormData = require('form-data');
const { fileTypeFromBuffer } = require('file-type');
const { sendButtons } = require('gifted-btns');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'url' || cmd === 'upload') {
    try {
      if (!m.quoted) {
        await sendButtons(sock, m.from, {
          title: '🌐 Media Processing Center',
          text: `*CLOUD AI Media Processor*\n\n` +
                `📊 **Supported Formats:**\n` +
                `• Images (JPG, PNG, GIF)\n` +
                `• Videos (MP4, MOV)\n` +
                `• Audio (MP3, M4A)\n` +
                `• Documents (PDF, DOC)\n\n` +
                `📁 **Max Size:** 50MB\n` +
                `⚡ **Processing:** Instant\n\n` +
                `*How to use:* Reply to any media with .url`,
          footer: 'Professional Media Hosting | Secure & Fast',
          buttons: [
            { id: 'btn_url_tutorial', text: '📚 How to Use' },
            { id: 'btn_url_formats', text: '📋 Supported Formats' },
            { id: 'btn_url_cancel', text: '❌ Close' }
          ]
        });
        return;
      }
      
      const quotedMsg = m.quoted;
      
      // Check for media
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      const hasMedia = mediaTypes.some(type => quotedMsg[type]);
      
      if (!hasMedia) {
        return m.reply('❌ *No Media Detected*\nPlease reply to an image, video, audio, or document.');
      }
      
      await sendButtons(sock, m.from, {
        title: '⬆️ Media Upload Selection',
        text: `*MEDIA DETECTED*\n\n` +
              `✅ **Status:** Ready for Processing\n` +
              `📁 **Type:** ${Object.keys(quotedMsg).find(key => mediaTypes.includes(key))?.replace('Message', '') || 'Unknown'}\n` +
              `⚡ **Service:** Select hosting provider\n\n` +
              `*Choose upload service:*`,
        footer: 'CLOUD AI Professional Hosting',
        buttons: [
          { id: 'btn_url_tmpfiles', text: '🌐 TmpFiles (1 Hour)' },
          { id: 'btn_url_catbox', text: '📦 Catbox (Permanent)' },
          { id: 'btn_url_analysis', text: '📊 File Analysis' },
          { id: 'btn_url_cancel', text: '❌ Cancel' }
        ]
      });
      
      m.uploadData = { quotedMsg };
      
    } catch (error) {
      console.error('❌ URL Processor Error:', error);
      m.reply('❌ Media processing failed. Please try again.');
    }
  }
};

// Upload handler
async function handleMediaUpload(service, data, m, sock) {
  try {
    const processingMsg = await m.reply(`⚙️ *Processing Media Upload*\n\n` +
      `🌐 **Service:** ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}\n` +
      `📁 **Status:** Downloading media...\n` +
      `⏱️ **Time:** ${new Date().toLocaleTimeString()}\n\n` +
      `_Please wait while we process your file..._`);
    
    // Download media
    const mediaBuffer = await downloadMediaMessage(data.quotedMsg, 'buffer', {});
    const fileSizeMB = (mediaBuffer.length / (1024 * 1024)).toFixed(2);
    
    if (fileSizeMB > 50) {
      return m.reply(`❌ *File Too Large*\n\n` +
        `📊 **Size:** ${fileSizeMB}MB\n` +
        `📏 **Limit:** 50MB\n\n` +
        `_Please use a smaller file._`);
    }
    
    let uploadUrl = '';
    let serviceName = '';
    
    if (service === 'tmpfiles') {
      serviceName = 'TmpFiles.org';
      const { ext } = await fileTypeFromBuffer(mediaBuffer);
      const form = new FormData();
      form.append('file', mediaBuffer, `cloudai_${Date.now()}.${ext}`);
      
      const response = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('TmpFiles upload failed');
      
      const responseData = await response.json();
      uploadUrl = responseData.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      
    } else if (service === 'catbox') {
      serviceName = 'Catbox.moe';
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', mediaBuffer, 'file');
      
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('Catbox upload failed');
      
      uploadUrl = await response.text();
    }
    
    // Success response with clickable button
    await sendButtons(sock, m.from, {
      title: '✅ Upload Successful',
      text: `*MEDIA HOSTING COMPLETE*\n\n` +
            `✅ **Status:** Uploaded Successfully\n` +
            `🌐 **Service:** ${serviceName}\n` +
            `📁 **Size:** ${fileSizeMB}MB\n` +
            `🔗 **URL:** ${uploadUrl}\n\n` +
            `*Click the button below to open the URL:*`,
      footer: 'CLOUD AI Professional Hosting | Secure Link',
      buttons: [
        {
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: '🌐 Open Media URL',
            url: uploadUrl
          })
        },
        { id: 'btn_url_copy', text: '📋 Copy URL' },
        { id: 'btn_url_new', text: '🔄 New Upload' }
      ]
    });
    
  } catch (error) {
    console.error('❌ Upload Process Error:', error);
    m.reply(`❌ ${service} upload failed. Please try another service.`);
  }
}
