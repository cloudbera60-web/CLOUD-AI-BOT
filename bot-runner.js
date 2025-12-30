const path = require('path');
const pino = require('pino');
const { makeWASocket, fetchLatestBaileysVersion, DisconnectReason, jidDecode } = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');
const database = require('./database');
const pluginLoader = require('./plugin-loader');
const { sendButtons } = require('gifted-btns');

class BotRunner {
    constructor(sessionId, authState) {
        this.sessionId = sessionId;
        this.authState = authState;
        this.socket = null;
        this.isRunning = false;
        this.startedAt = new Date();
        this.msgRetryCounterCache = new NodeCache();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 3;
        
        this.connectionState = 'disconnected';
        this.lastActivity = new Date();
        this.userStates = new Map(); // Store user-specific states for multi-step commands
    }

    async start() {
        try {
            if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
                console.log(`⏳ Bot ${this.sessionId} is already ${this.connectionState}`);
                return this.socket;
            }
            
            this.connectionState = 'connecting';
            console.log(`🤖 Starting CLOUD AI bot for session: ${this.sessionId}`);
            
            // Load session from DB if available
            if (!this.authState.creds && database.isConnected) {
                const savedSession = await database.getSession(this.sessionId);
                if (savedSession) {
                    console.log(`📂 Loaded session from DB: ${this.sessionId}`);
                    this.authState = savedSession;
                }
            }
            
            const { version } = await fetchLatestBaileysVersion();
            
            this.socket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: ["CLOUD AI", "safari", "3.3"],
                auth: this.authState,
                getMessage: async () => ({ conversation: "CLOUD AI WhatsApp User Bot" }),
                msgRetryCounterCache: this.msgRetryCounterCache,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 15000,
                emitOwnEvents: true,
                defaultQueryTimeoutMs: 0
            });

            // Store in global active bots
            global.activeBots = global.activeBots || {};
            global.activeBots[this.sessionId] = {
                socket: this.socket,
                startedAt: this.startedAt,
                sessionId: this.sessionId,
                instance: this
            };

            // Setup event handlers
            this.setupEventHandlers();
            
            this.isRunning = true;
            this.reconnectAttempts = 0;
            
            console.log(`✅ CLOUD AI bot started successfully for session: ${this.sessionId}`);
            
            // Send welcome message
            this.sendWelcomeMessage().catch(console.error);
            
            return this.socket;
            
        } catch (error) {
            this.connectionState = 'error';
            console.error(`❌ Failed to start CLOUD AI bot for ${this.sessionId}:`, error.message);
            throw error;
        }
    }

    setupEventHandlers() {
        const { socket } = this;
        
        // Save credentials to MongoDB when updated
        socket.ev.on('creds.update', async (creds) => {
            try {
                if (database.isConnected) {
                    await database.saveSession(this.sessionId, { creds, keys: this.authState.keys });
                    console.log(`💾 Saved updated credentials for ${this.sessionId}`);
                }
            } catch (error) {
                console.error('Error saving credentials:', error.message);
            }
        });

        // Connection update handler
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                this.connectionState = 'connected';
                this.lastActivity = new Date();
                console.log(`✅ CLOUD AI bot ${this.sessionId} connected successfully!`);
                this.reconnectAttempts = 0;
                
                // Save session to MongoDB on successful connection
                if (database.isConnected) {
                    await database.saveSession(this.sessionId, this.authState);
                }
            } 
            else if (connection === 'close') {
                this.connectionState = 'disconnected';
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min((parseInt(process.env.RECONNECT_DELAY_MS) || 5000) * this.reconnectAttempts, 30000);
                    
                    console.log(`♻️ Reconnecting CLOUD AI bot ${this.sessionId} in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                    
                    setTimeout(async () => {
                        if (this.isRunning) {
                            await this.reconnect();
                        }
                    }, delay);
                } else {
                    console.log(`🛑 CLOUD AI bot ${this.sessionId} disconnected permanently`);
                    await this.stop();
                }
            }
        });

        // Message handler with button support
        socket.ev.on("messages.upsert", async (chatUpdate) => {
            try {
                this.lastActivity = new Date();
                
                const m = this.serializeMessage(chatUpdate.messages[0], socket);
                if (!m.message) return;
                
                const body = this.extractMessageText(m.message);
                if (!body) return;
                
                m.body = body;
                
                // Check for user states (multi-step commands)
                const userId = m.sender;
                const userState = this.userStates.get(userId);
                
                if (userState && userState.waitingFor) {
                    await this.handleUserState(m, socket, userState);
                    return;
                }
                
                // Check for button clicks (starts with 'btn_')
                if (body.startsWith('btn_')) {
                    await this.handleButtonClick(m, socket, body);
                    return;
                }
                
                // Check if message is a command
                const prefix = process.env.BOT_PREFIX || '.';
                if (body.startsWith(prefix)) {
                    const cmd = body.slice(prefix.length).split(' ')[0].toLowerCase();
                    const args = body.slice(prefix.length + cmd.length).trim();
                    
                    m.cmd = cmd;
                    m.args = args;
                    m.text = args;
                    
                    console.log(`Command: ${prefix}${cmd} from ${m.sender.substring(0, 8)}...`);
                    
                    // Try to execute as plugin first
                    const pluginResult = await pluginLoader.executePlugin(cmd, m, socket);
                    
                    if (!pluginResult.success) {
                        // If no plugin found, use built-in commands
                        await this.handleBuiltinCommand(m, socket, cmd, args);
                    }
                }
                
                // Auto-reaction
                if (!m.key.fromMe && m.message && process.env.AUTO_REACT === 'true') {
                    this.sendAutoReaction(m, socket).catch(() => {});
                }
                
            } catch (error) {
                console.error(`Error processing message for ${this.sessionId}:`, error.message);
            }
        });
    }

    async handleUserState(m, sock, userState) {
        const userId = m.sender;
        
        switch(userState.waitingFor) {
            case 'customTagMessage':
                // Handle custom tag message from tagall plugin
                const participants = userState.data?.participants;
                if (participants) {
                    const customMessage = m.body;
                    const mentions = participants.map(p => p.id);
                    
                    const finalMessage = customMessage
                        .replace(/{count}/g, participants.length)
                        .replace(/{time}/g, new Date().toLocaleTimeString())
                        .replace(/{date}/g, new Date().toLocaleDateString()) + 
                        `\n\n🏷️ Tagged by: @${m.sender.split('@')[0]}`;
                    
                    await sock.sendMessage(m.from, {
                        text: finalMessage,
                        mentions: mentions
                    }, { quoted: m });
                }
                
                this.userStates.delete(userId);
                break;
                
            case 'privacyValue':
                // Handle privacy value selection
                const settingType = userState.data?.settingType;
                if (settingType) {
                    await this.applyPrivacySetting(m, sock, settingType, m.body);
                }
                this.userStates.delete(userId);
                break;
        }
    }

    async handleButtonClick(m, sock, buttonId) {
        console.log(`Button clicked: ${buttonId} by ${m.sender.substring(0, 8)}...`);
        
        // Core menu buttons
        const coreButtons = {
            'btn_menu': async () => {
                const menuPlugin = pluginLoader.plugins.get('menu');
                if (menuPlugin) await menuPlugin(m, sock);
            },
            'btn_ping': async () => {
                const start = Date.now();
                await m.reply(`🏓 Pong!`);
                const latency = Date.now() - start;
                await sock.sendMessage(m.from, { text: `⏱️ Latency: ${latency}ms\n🆔 ${this.sessionId}` });
            },
            'btn_owner': async () => {
                const ownerPlugin = pluginLoader.plugins.get('owner');
                if (ownerPlugin) await ownerPlugin(m, sock);
            },
            'btn_play': async () => {
                await m.reply('🎵 Use `.play song name` to play music');
            },
            'btn_status': async () => {
                const uptime = this.getUptime();
                const status = `☁️ *CLOUD AI Status*\n\n` +
                              `• Session: ${this.sessionId}\n` +
                              `• State: ${this.connectionState}\n` +
                              `• Uptime: ${uptime}\n` +
                              `• Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                              `• Last Activity: ${this.lastActivity.toLocaleTimeString()}`;
                await m.reply(status);
            },
            'btn_plugins': async () => {
                const plugins = Array.from(pluginLoader.plugins.keys());
                await m.reply(`📦 Loaded Plugins (${plugins.length}):\n${plugins.map(p => `• .${p}`).join('\n')}`);
            },
            'btn_contact_call': async () => {
                await m.reply(`📞 Call BERA TECH:\nPrimary: 254116763755\nSecondary: 254743982206`);
            },
            'btn_contact_email': async () => {
                await m.reply(`✉️ Email: beratech00@gmail.com\n\nFor support and inquiries.`);
            },
            'btn_contact_support': async () => {
                await m.reply(`💬 Support: https://t.me/beratech\nGitHub: https://github.com/beratech/cloud-ai`);
            }
        };

        // VCF Plugin buttons
        const vcfButtons = {
            'btn_vcf_all': async () => {
                const vcfPlugin = pluginLoader.plugins.get('vcf');
                if (vcfPlugin) {
                    await this.handleVCFExport(m, sock, 'all');
                }
            },
            'btn_vcf_admins': async () => {
                const vcfPlugin = pluginLoader.plugins.get('vcf');
                if (vcfPlugin) {
                    await this.handleVCFExport(m, sock, 'admins');
                }
            },
            'btn_vcf_cancel': async () => {
                await m.reply('✅ VCF export cancelled.');
            }
        };

        // View Plugin buttons
        const viewButtons = {
            'btn_view_info': async () => {
                await this.showMessageInfo(m, sock);
            },
            'btn_view_info_full': async () => {
                if (m.mediaData) {
                    await this.showFullMediaInfo(m, sock, m.mediaData);
                }
            },
            'btn_view_help': async () => {
                await m.reply(`*👁️ View Command Help*\n\nUsage:\n• Reply to any media message with .view\n• View message information\n• Download media files\n\nOwner: BERA TECH`);
            },
            'btn_view_back': async () => {
                await m.reply('Returning to main menu...');
            },
            'btn_view_cancel': async () => {
                await m.reply('✅ Operation cancelled.');
            }
        };

        // Media download buttons
        const mediaDownloadButtons = {
            'btn_view_download_image': async () => {
                if (m.mediaData) await this.downloadMedia(m, sock, m.mediaData);
            },
            'btn_view_download_video': async () => {
                if (m.mediaData) await this.downloadMedia(m, sock, m.mediaData);
            },
            'btn_view_download_audio': async () => {
                if (m.mediaData) await this.downloadMedia(m, sock, m.mediaData);
            },
            'btn_view_download_document': async () => {
                if (m.mediaData) await this.downloadMedia(m, sock, m.mediaData);
            }
        };

        // URL Plugin buttons
        const urlButtons = {
            'btn_url_help': async () => {
                await m.reply(`*🔗 URL Uploader Help*\n\nUsage:\n1. Reply to any media (image/video/audio)\n2. Use .url command\n3. Select upload service\n4. Get direct URL\n\nSupported: Images, Videos, Audio\nMax Size: 50MB\n\nPowered by CLOUD AI`);
            },
            'btn_url_example': async () => {
                await m.reply('*📋 Example:*\n1. Send or forward an image\n2. Reply to it with `.url`\n3. Select upload service\n4. Get direct link to share');
            },
            'btn_url_tmpfiles': async () => {
                if (m.uploadData) {
                    await this.uploadToService(m, sock, m.uploadData.quotedMsg, 'tmpfiles');
                }
            },
            'btn_url_catbox': async () => {
                if (m.uploadData) {
                    await this.uploadToService(m, sock, m.uploadData.quotedMsg, 'catbox');
                }
            },
            'btn_url_cancel': async () => {
                await m.reply('✅ Upload cancelled.');
            },
            'btn_url_copy': async () => {
                // URL would be in m.data or we need to store it
                await m.reply('📋 Copy the URL from the message above.');
            },
            'btn_url_new': async () => {
                await m.reply('🔄 Send .url again with a new media file.');
            },
            'btn_url_done': async () => {
                await m.reply('✅ URL operation completed.');
            }
        };

        // TagAll Plugin buttons
        const tagallButtons = {
            'btn_tag_all': async () => {
                if (m.tagData) {
                    await this.tagEveryone(m, sock, m.tagData.participants, '👥 *Everyone!*');
                }
            },
            'btn_tag_admins': async () => {
                if (m.tagData) {
                    const admins = m.tagData.participants.filter(p => p.admin);
                    await this.tagEveryone(m, sock, admins, '👑 *Admins!*');
                }
            },
            'btn_tag_custom': async () => {
                if (m.tagData) {
                    await this.requestCustomTagMessage(m, sock, m.tagData.participants);
                }
            },
            'btn_tag_cancel': async () => {
                await m.reply('✅ Tagging cancelled.');
            },
            'btn_tag_default': async () => {
                if (m.tagData) {
                    await this.tagEveryone(m, sock, m.tagData.participants, '👥 *Attention everyone!*');
                }
            }
        };

        // Privacy Plugin buttons
        const privacyButtons = {
            'btn_priv_lastseen': async () => {
                await this.showPrivacyOptions(m, sock, 'lastseen', ['all', 'contacts', 'none'], ['👁️ Everyone', '📱 Contacts', '🙈 Nobody']);
            },
            'btn_priv_profile': async () => {
                await this.showPrivacyOptions(m, sock, 'profile', ['all', 'contacts', 'none'], ['👁️ Everyone', '📱 Contacts', '🙈 Nobody']);
            },
            'btn_priv_status': async () => {
                await this.showPrivacyOptions(m, sock, 'status', ['all', 'contacts', 'none'], ['👁️ Everyone', '📱 Contacts', '🙈 Nobody']);
            },
            'btn_priv_groupadd': async () => {
                await this.showPrivacyOptions(m, sock, 'groupadd', ['all', 'contacts', 'none'], ['👁️ Everyone', '📱 Contacts', '🙈 Nobody']);
            },
            'btn_priv_disappear': async () => {
                const { WA_DEFAULT_EPHEMERAL } = require('@whiskeysockets/baileys');
                await this.showPrivacyOptions(m, sock, 'disappear', [0, WA_DEFAULT_EPHEMERAL, 86400, 604800], ['❌ Off', '⏰ 24h', '📅 7d', '♾️ 90d']);
            },
            'btn_priv_cancel': async () => {
                await m.reply('✅ Privacy settings cancelled.');
            },
            'btn_priv_back': async () => {
                const privacyPlugin = pluginLoader.plugins.get('setprivacy');
                if (privacyPlugin) await privacyPlugin(m, sock);
            },
            'btn_priv_more': async () => {
                const privacyPlugin = pluginLoader.plugins.get('setprivacy');
                if (privacyPlugin) await privacyPlugin(m, sock);
            },
            'btn_priv_done': async () => {
                await m.reply('✅ Privacy settings updated.');
            }
        };

        // Privacy setting application buttons
        const privacySettingButtons = {};
        ['lastseen', 'profile', 'status', 'groupadd', 'disappear'].forEach(setting => {
            privacySettingButtons[`btn_priv_set_${setting}_all`] = async () => {
                await this.applyPrivacySetting(m, sock, setting, 'all');
            };
            privacySettingButtons[`btn_priv_set_${setting}_contacts`] = async () => {
                await this.applyPrivacySetting(m, sock, setting, 'contacts');
            };
            privacySettingButtons[`btn_priv_set_${setting}_none`] = async () => {
                await this.applyPrivacySetting(m, sock, setting, 'none');
            };
            privacySettingButtons[`btn_priv_set_disappear_0`] = async () => {
                await this.applyPrivacySetting(m, sock, 'disappear', 0);
            };
            privacySettingButtons[`btn_priv_set_disappear_86400`] = async () => {
                await this.applyPrivacySetting(m, sock, 'disappear', 86400);
            };
            privacySettingButtons[`btn_priv_set_disappear_604800`] = async () => {
                await this.applyPrivacySetting(m, sock, 'disappear', 604800);
            };
        });

        // Combine all button handlers
        const allButtonHandlers = {
            ...coreButtons,
            ...vcfButtons,
            ...viewButtons,
            ...mediaDownloadButtons,
            ...urlButtons,
            ...tagallButtons,
            ...privacyButtons,
            ...privacySettingButtons
        };

        // Execute button handler
        if (allButtonHandlers[buttonId]) {
            await allButtonHandlers[buttonId]();
        } else {
            console.log(`Unknown button ID: ${buttonId}`);
            await m.reply(`❌ Unknown button action. Please try again.`);
        }
    }

    // VCF Export handler
    async handleVCFExport(m, sock, type) {
        try {
            if (!m.isGroup) {
                return m.reply('❌ VCF export only works in groups!');
            }

            const groupMetadata = await sock.groupMetadata(m.from);
            let participants = groupMetadata.participants;
            
            if (type === 'admins') {
                participants = participants.filter(p => p.admin);
            }
            
            if (participants.length === 0) {
                return m.reply(`❌ No ${type === 'admins' ? 'admins' : 'participants'} found.`);
            }
            
            await m.reply(`⏳ Creating VCF for ${participants.length} contacts...`);
            
            let vcfContent = '';
            participants.forEach(participant => {
                const phoneNumber = participant.id.split('@')[0];
                const name = participant.name || participant.notify || `User_${phoneNumber}`;
                
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nTEL;TYPE=CELL:${phoneNumber}\nEND:VCARD\n\n`;
            });
            
            // Save to temp file
            const fs = require('fs').promises;
            const path = require('path');
            const tempDir = path.join(__dirname, 'temp');
            await fs.mkdir(tempDir, { recursive: true });
            
            const filename = `contacts_${type}_${Date.now()}.vcf`;
            const filePath = path.join(tempDir, filename);
            await fs.writeFile(filePath, vcfContent, 'utf8');
            
            // Send file
            await sock.sendMessage(m.from, {
                document: { url: filePath },
                fileName: `${groupMetadata.subject.replace(/[^a-z0-9]/gi, '_')}_${type}.vcf`,
                mimetype: 'text/vcard',
                caption: `📇 *Contact Export*\n\nGroup: ${groupMetadata.subject}\nType: ${type}\nExported: ${participants.length} contacts\n\nPowered by CLOUD AI`
            }, { quoted: m });
            
            // Cleanup
            setTimeout(() => fs.unlink(filePath).catch(() => {}), 30000);
            
        } catch (error) {
            console.error('VCF Export Error:', error);
            m.reply('❌ Error creating contact file.');
        }
    }

    // View plugin helpers
    async showMessageInfo(m, sock) {
        const msg = m.quoted || m;
        const info = `*📊 Message Information*\n\n` +
                   `• Message ID: ${msg.key.id}\n` +
                   `• From: ${msg.key.remoteJid}\n` +
                   `• Timestamp: ${new Date(msg.messageTimestamp * 1000).toLocaleString()}\n` +
                   `• Type: ${Object.keys(msg.message || {})[0] || 'text'}\n` +
                   `• Push Name: ${msg.pushName || 'Unknown'}`;
        
        await sock.sendMessage(m.from, { text: info }, { quoted: m });
    }

    async showFullMediaInfo(m, sock, mediaData) {
        const { buffer, type, quotedMsg } = mediaData;
        const info = `*📁 Media Details*\n\n` +
                   `• Type: ${type}\n` +
                   `• Size: ${(buffer.length / 1024).toFixed(2)} KB\n` +
                   `• Dimensions: ${quotedMsg.imageMessage ? `${quotedMsg.imageMessage.width}x${quotedMsg.imageMessage.height}` : 'N/A'}\n` +
                   `• Caption: ${quotedMsg[`${type}Message`]?.caption || 'None'}\n` +
                   `• Mimetype: ${quotedMsg[`${type}Message`]?.mimetype || 'Unknown'}`;
        
        await sock.sendMessage(m.from, { text: info }, { quoted: m });
    }

    async downloadMedia(m, sock, mediaData) {
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

    // URL plugin helpers
    async uploadToService(m, sock, quotedMsg, service) {
        try {
            await m.reply(`⏳ Uploading to ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}...`);
            
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
            
            // Check file size (50MB limit)
            const fileSizeMB = mediaBuffer.length / (1024 * 1024);
            if (fileSizeMB > 50) {
                return m.reply(`❌ File too large! Max 50MB. Your file: ${fileSizeMB.toFixed(2)}MB`);
            }
            
            let uploadUrl = '';
            
            if (service === 'tmpfiles') {
                const { fileTypeFromBuffer } = require('file-type');
                const { ext } = await fileTypeFromBuffer(mediaBuffer);
                const FormData = require('form-data');
                const fetch = require('node-fetch');
                
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
                const FormData = require('form-data');
                const fetch = require('node-fetch');
                
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
            
            // Send result
            await sendButtons(sock, m.from, {
                title: '✅ Upload Successful',
                text: `Service: ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}\nURL: ${uploadUrl}`,
                footer: 'CLOUD AI Uploader',
                buttons: [
                    { id: 'btn_url_copy', text: '📋 Copy URL' },
                    { id: 'btn_url_new', text: '🔄 New Upload' },
                    { id: 'btn_url_done', text: '✅ Done' }
                ]
            });
            
        } catch (error) {
            console.error('Upload Error:', error);
            m.reply(`❌ ${service} upload failed. Try again or use another service.`);
        }
    }

    // TagAll plugin helpers
    async tagEveryone(m, sock, participants, message) {
        try {
            await m.reply(`⏳ Tagging ${participants.length} members...`);
            
            const mentions = participants.map(p => p.id);
            const tagMessage = `${message}\n\n` + 
                              participants.map(p => `@${p.id.split('@')[0]}`).join(' ') + 
                              `\n\n🏷️ Tagged by: @${m.sender.split('@')[0]}\n📅 ${new Date().toLocaleDateString()}`;
            
            await sock.sendMessage(m.from, {
                text: tagMessage,
                mentions: mentions
            }, { quoted: m });
            
        } catch (error) {
            console.error('Tag Error:', error);
            m.reply('❌ Error tagging members.');
        }
    }

    async requestCustomTagMessage(m, sock, participants) {
        // Store participants and ask for custom message
        this.userStates.set(m.sender, {
            waitingFor: 'customTagMessage',
            data: { participants }
        });
        
        await sendButtons(sock, m.from, {
            title: '✏️ Custom Tag Message',
            text: `Members: ${participants.length}\n\nPlease send your custom message now.\nUse {count} for member count, {time} for current time.`,
            footer: 'I will add mentions automatically',
            buttons: [
                { id: 'btn_tag_default', text: '🔄 Use Default' },
                { id: 'btn_tag_cancel', text: '❌ Cancel' }
            ]
        });
    }

    // Privacy plugin helpers
    async showPrivacyOptions(m, sock, setting, options, labels) {
        const buttons = options.map((option, index) => ({
            id: `btn_priv_set_${setting}_${option}`,
            text: labels[index]
        }));
        
        buttons.push({ id: 'btn_priv_back', text: '🔙 Back' });
        
        await sendButtons(sock, m.from, {
            title: `🔐 ${setting.charAt(0).toUpperCase() + setting.slice(1)} Privacy`,
            text: 'Select privacy level:',
            footer: 'CLOUD AI Privacy Manager',
            buttons: buttons
        });
    }

    async applyPrivacySetting(m, sock, settingType, value) {
        try {
            // Check if user is owner
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                return m.reply('❌ This command is owner-only.');
            }
            
            await m.reply(`⏳ Updating ${settingType} privacy...`);
            
            if (settingType === 'disappear') {
                await sock.updateDisappearingMode(parseInt(value));
            } else {
                await sock.updatePrivacySettings(settingType, value);
            }
            
            const readableValue = settingType === 'disappear' 
                ? value === 0 ? 'Off' : `${value / 3600} hours`
                : value;
            
            await sendButtons(sock, m.from, {
                title: '✅ Privacy Updated',
                text: `Setting: ${settingType}\nValue: ${readableValue}\n\nChanges applied successfully!`,
                footer: 'CLOUD AI Privacy',
                buttons: [
                    { id: 'btn_priv_more', text: '⚙️ More Settings' },
                    { id: 'btn_priv_done', text: '✅ Done' }
                ]
            });
            
        } catch (error) {
            console.error('Privacy Update Error:', error);
            m.reply(`❌ Failed to update ${settingType} privacy. Check console for details.`);
        }
    }

    async handleBuiltinCommand(m, sock, cmd, args) {
        switch(cmd) {
            case 'ping':
                const start = Date.now();
                await m.reply(`🏓 Pong!`);
                const latency = Date.now() - start;
                await sock.sendMessage(m.from, { text: `⏱️ Latency: ${latency}ms\n🆔 ${this.sessionId}` });
                break;
                
            case 'menu':
                // Will be handled by menu plugin
                break;
                
            case 'plugins':
            case 'pl':
                const plugins = Array.from(pluginLoader.plugins.keys());
                await m.reply(`📦 Loaded Plugins (${plugins.length}):\n${plugins.map(p => `• .${p}`).join('\n')}`);
                break;
                
            case 'status':
                const uptime = this.getUptime();
                const status = `☁️ *CLOUD AI Status*\n\n` +
                              `• Session: ${this.sessionId}\n` +
                              `• State: ${this.connectionState}\n` +
                              `• Uptime: ${uptime}\n` +
                              `• Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                              `• Last Activity: ${this.lastActivity.toLocaleTimeString()}`;
                await m.reply(status);
                break;
                
            default:
                await m.reply(`❓ Unknown command: .${cmd}\n\nType .menu for commands\nType .plugins to see loaded plugins`);
        }
    }

    extractMessageText(message) {
        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
        if (message.imageMessage?.caption) return message.imageMessage.caption;
        if (message.videoMessage?.caption) return message.videoMessage.caption;
        return '';
    }

    serializeMessage(message, sock) {
        const m = { ...message };
        
        if (m.key) {
            m.id = m.key.id;
            m.isSelf = m.key.fromMe;
            m.from = this.decodeJid(m.key.remoteJid);
            m.isGroup = m.from.endsWith("@g.us");
            
            // ✅ CORRECTED SENDER LOGIC for PMs
            if (m.isGroup) {
                m.sender = this.decodeJid(m.key.participant);
            } else if (m.isSelf) {
                m.sender = this.decodeJid(sock.user.id);
            } else {
                m.sender = m.from;  // ✅ PM from another user
            }
        }
        
        m.pushName = m.pushName || 'User';
        
        m.reply = (text, options = {}) => {
            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        const result = await sock.sendMessage(m.from, { text }, { quoted: m, ...options });
                        resolve(result);
                    } catch (error) {
                        console.error(`Reply failed:`, error.message);
                        resolve(null);
                    }
                }, 100);
            });
        };
        
        m.React = (emoji) => {
            return sock.sendMessage(m.from, {
                react: { text: emoji, key: m.key }
            }).catch(() => {});
        };
        
        return m;
    }

    decodeJid(jid) {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
        }
        return jid;
    }

    async sendAutoReaction(m, sock) {
        const emojis = ['❤️', '😂', '😮', '😢', '👏', '🔥', '⭐', '🎉'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        
        await sock.sendMessage(m.from, {
            react: { text: randomEmoji, key: m.key }
        }).catch(() => {});
    }

    getUptime() {
        const uptime = Date.now() - this.startedAt;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    }

    async sendWelcomeMessage() {
        try {
            const welcomeMsg = `☁️ *CLOUD AI Activated!*\n\n` +
                              `✅ Bot is ready!\n` +
                              `🆔 ${this.sessionId}\n` +
                              `🔧 Prefix: ${process.env.BOT_PREFIX || '.'}\n` +
                              `📢 Use .menu for commands\n\n` +
                              `*Powered by BERA TECH*\n` +
                              `📞 Contact: ${process.env.OWNER_NUMBER || '254116763755'}\n` +
                              `✉️ Email: beratech00@gmail.com`;
            
            await this.socket.sendMessage(this.socket.user.id, { text: welcomeMsg });
        } catch (error) {
            // Silent fail
        }
    }

    async reconnect() {
        if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log(`Attempting reconnect for ${this.sessionId}...`);
            try {
                await this.stop();
                await this.start();
            } catch (error) {
                console.error(`Reconnect failed for ${this.sessionId}:`, error.message);
            }
        }
    }

    async stop() {
        this.isRunning = false;
        this.connectionState = 'stopped';
        
        if (this.socket) {
            try {
                await this.socket.ws.close();
            } catch (error) {
                // Ignore close errors
            }
        }
        
        if (global.activeBots && global.activeBots[this.sessionId]) {
            delete global.activeBots[this.sessionId];
        }
        
        // Clear user states
        this.userStates.clear();
        
        console.log(`🛑 CLOUD AI bot stopped: ${this.sessionId}`);
    }
}

// Initialize system function
async function initializeBotSystem() {
    try {
        console.log('☁️ CLOUD AI system initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize CLOUD AI system:', error);
        return false;
    }
}

// Function to start a bot instance
async function startBotInstance(sessionId, authState) {
    const bot = new BotRunner(sessionId, authState);
    await bot.start();
    return bot;
}

function stopBotInstance(sessionId) {
    if (global.activeBots && global.activeBots[sessionId]) {
        global.activeBots[sessionId].instance.stop();
        return true;
    }
    return false;
}

function getActiveBots() {
    return global.activeBots || {};
}

// Initialize global bot storage
global.activeBots = {};

module.exports = {
    BotRunner,
    startBotInstance,
    stopBotInstance,
    getActiveBots,
    initializeBotSystem
};
