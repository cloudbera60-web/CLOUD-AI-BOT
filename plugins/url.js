const fetch = require('node-fetch');
const FormData = require('form-data');
const { fileTypeFromBuffer } = require('file-type');
const { writeFile, unlink } = require('fs/promises');
const { sendButtons } = require('gifted-btns');

const MAX_FILE_SIZE_MB = 50;

async function uploadMedia(buffer) {
  try {
    const { ext } = await fileTypeFromBuffer(buffer);
    const form = new FormData();
    
    form.append('file', buffer, `upload_${Date.now()}.${ext}`);
    form.append('expires', '1h');
    
    const response = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: form
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    
  } catch (error) {
    console.error('Upload Error:', error);
    throw new Error('Media upload failed');
  }
}

const tourl = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'url' || cmd === 'upload') {
    try {
      if (!m.quoted) {
        // Show URL options with buttons
        await sendButtons(sock, m.from, {
          title: '🔗 URL Uploader',
          text: 'Reply to a media message or select an option:',
          footer: 'Upload media to get a direct URL',
          buttons: [
            { id: 'btn_url_help', text: '❓ How to Use' },
            { id: 'btn_url_example', text: '📋 Example' },
            { id: 'btn_url_cancel', text: '❌ Cancel' }
          ]
        });
        return;
      }
      
      const quotedMsg = m.quoted;
      
      // Check for media in quoted message
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage'];
      const hasMedia = mediaTypes.some(type => quotedMsg[type]);
      
      if (!hasMedia) {
        return m.reply('❌ Please reply to an image, video, or audio message.');
      }
      
      // Show upload options
      await sendButtons(sock, m.from, {
        title: '⬆️ Upload Media',
        text: 'Media detected! Select upload service:',
        footer: 'Max file size: 50MB',
        buttons: [
          { id: 'btn_url_tmpfiles', text: '🌐 TmpFiles (1 hour)' },
          { id: 'btn_url_catbox', text: '📦 Catbox (permanent)' },
          { id: 'btn_url_cancel', text: '❌ Cancel' }
        ]
      });
      
      // Store message for button handling
      m.uploadData = { quotedMsg };
      
    } catch (error) {
      console.error('URL Error:', error);
      m.reply('❌ Error processing upload request.');
    }
  }
};

// Button handler for URL
const handleURLButton = async (m, sock, buttonId, uploadData) => {
  switch(buttonId) {
    case 'btn_url_help':
      await m.reply(`*🔗 URL Uploader Help*\n\nUsage:\n1. Reply to any media (image/video/audio)\n2. Use .url command\n3. Select upload service\n4. Get direct URL\n\nSupported: Images, Videos, Audio\nMax Size: 50MB\n\nPowered by CLOUD AI`);
      break;
      
    case 'btn_url_example':
      await m.reply('*📋 Example:*\n1. Send or forward an image\n2. Reply to it with `.url`\n3. Select upload service\n4. Get direct link to share');
      break;
      
    case 'btn_url_tmpfiles':
      if (uploadData) {
        await uploadToService(m, sock, uploadData.quotedMsg, 'tmpfiles');
      }
      break;
      
    case 'btn_url_catbox':
      if (uploadData) {
        await uploadToService(m, sock, uploadData.quotedMsg, 'catbox');
      }
      break;
      
    case 'btn_url_cancel':
      await m.reply('✅ Upload cancelled.');
      break;
  }
};

async function uploadToService(m, sock, quotedMsg, service) {
  try {
    await m.reply(`⏳ Uploading to ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}...`);
    
    // Download media
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
    
    // Check file size
    const fileSizeMB = mediaBuffer.length / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      return m.reply(`❌ File too large! Max ${MAX_FILE_SIZE_MB}MB. Your file: ${fileSizeMB.toFixed(2)}MB`);
    }
    
    let uploadUrl = '';
    
    if (service === 'tmpfiles') {
      // Upload to tmpfiles.org
      const { ext } = await fileTypeFromBuffer(mediaBuffer);
      const form = new FormData();
      form.append('file', mediaBuffer, `cloudai_${Date.now()}.${ext}`);
      
      const response = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('TmpFiles upload failed');
      
      const data = await response.json();
      uploadUrl = data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      
    } else if (service === 'catbox') {
      // Upload to catbox.moe
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
    
    // Send result with buttons
    await sendButtons(sock, m.from, {
      title: '✅ Upload Successful',
      text: `Service: ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}\nURL: ${uploadUrl}`,
      footer: 'CLOUD AI Uploader',
      buttons: [
        { id: 'btn_url_copy', text: '📋 Copy URL', data: uploadUrl },
        { id: 'btn_url_new', text: '🔄 New Upload' },
        { id: 'btn_url_done', text: '✅ Done' }
      ]
    });
    
  } catch (error) {
    console.error('Upload Error:', error);
    m.reply(`❌ ${service} upload failed. Try again or use another service.`);
  }
}

module.exports = tourl;