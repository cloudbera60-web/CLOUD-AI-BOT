const fs = require('fs').promises;
const path = require('path');
const { sendButtons } = require('gifted-btns');

const vcfCompiler = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'vcf' || cmd === 'export') {
    try {
      // Check if it's a group
      if (!m.isGroup) {
        return m.reply('❌ This command only works in groups!');
      }
      
      // Get group metadata
      const groupMetadata = await sock.groupMetadata(m.from);
      const participants = groupMetadata.participants;
      
      if (!participants || participants.length === 0) {
        return m.reply('❌ No participants found in this group.');
      }
      
      // Show options with buttons
      await sendButtons(sock, m.from, {
        title: '📇 VCF Contact Export',
        text: `Group: ${groupMetadata.subject}\nMembers: ${participants.length}\n\nSelect export format:`,
        footer: 'CLOUD AI Contact Exporter',
        buttons: [
          { id: 'btn_vcf_all', text: '📋 All Contacts' },
          { id: 'btn_vcf_admins', text: '👑 Admins Only' },
          { id: 'btn_vcf_cancel', text: '❌ Cancel' }
        ]
      });
      
      // Store group data temporarily for button handling
      m.groupData = { metadata: groupMetadata, participants };
      
    } catch (error) {
      console.error('VCF Error:', error);
      m.reply('❌ Error fetching group information.');
    }
  }
};

// Button handler for VCF
const handleVCFButton = async (m, sock, buttonId, groupData) => {
  if (!groupData) return m.reply('❌ Session expired. Please run .vcf again.');
  
  const { metadata, participants } = groupData;
  
  switch(buttonId) {
    case 'btn_vcf_all':
      await exportAllContacts(m, sock, participants, metadata.subject);
      break;
    case 'btn_vcf_admins':
      const admins = participants.filter(p => p.admin);
      await exportAllContacts(m, sock, admins, `${metadata.subject} - Admins`);
      break;
    case 'btn_vcf_cancel':
      await m.reply('✅ Export cancelled.');
      break;
  }
};

async function exportAllContacts(m, sock, participants, title) {
  try {
    await m.reply(`⏳ Creating VCF for ${participants.length} contacts...`);
    
    let vcfContent = '';
    participants.forEach(participant => {
      const phoneNumber = participant.id.split('@')[0];
      const name = participant.name || participant.notify || `User_${phoneNumber}`;
      
      vcfContent += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nTEL;TYPE=CELL:${phoneNumber}\nEND:VCARD\n\n`;
    });
    
    // Create temp directory if not exists
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Save VCF file
    const filename = `contacts_${Date.now()}.vcf`;
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, vcfContent, 'utf8');
    
    // Send the file
    await sock.sendMessage(m.from, {
      document: { url: filePath },
      fileName: `${title.replace(/[^a-z0-9]/gi, '_')}.vcf`,
      mimetype: 'text/vcard',
      caption: `📇 *Contact Export*\n\nGroup: ${title}\nExported: ${participants.length} contacts\n\nPowered by CLOUD AI`
    }, { quoted: m });
    
    // Cleanup
    setTimeout(() => fs.unlink(filePath).catch(() => {}), 30000);
    
  } catch (error) {
    console.error('Export Error:', error);
    m.reply('❌ Error creating contact file.');
  }
}

module.exports = vcfCompiler;