const path = require('path');
const pino = require('pino');
const { makeWASocket, fetchLatestBaileysVersion, DisconnectReason, jidDecode, downloadMediaMessage } = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');
const database = require('./database');
const pluginLoader = require('./plugin-loader');
const { sendButtons, sendInteractiveMessage } = require('gifted-btns');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const FormData = require('form-data');
const { fileTypeFromBuffer } = require('file-type');
const axios = require('axios');
const yts = require('yt-search');

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
        this.userStates = new Map();
    }

    async start() {
        try {
            if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
                console.log(`⏳ Bot ${this.sessionId} is already ${this.connectionState}`);
                return this.socket;
            }
            
            this.connectionState = 'connecting';
            console.log(`🤖 Starting CLOUD AI bot for session: ${this.sessionId}`);
            
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
                getMessage: async () => undefined,
                msgRetryCounterCache: this.msgRetryCounterCache,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 15000,
                emitOwnEvents: true,
                defaultQueryTimeoutMs: 0
            });

            global.activeBots = global.activeBots || {};
            global.activeBots[this.sessionId] = {
                socket: this.socket,
                startedAt: this.startedAt,
                sessionId: this.sessionId,
                instance: this
            };

            this.setupEventHandlers();
            
            this.isRunning = true;
            this.reconnectAttempts = 0;
            
            console.log(`✅ CLOUD AI bot started successfully for session: ${this.sessionId}`);
            
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

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                this.connectionState = 'connected';
                this.lastActivity = new Date();
                console.log(`✅ CLOUD AI bot ${this.sessionId} connected successfully!`);
                this.reconnectAttempts = 0;
                
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

        socket.ev.on("messages.upsert", async (chatUpdate) => {
            try {
                this.lastActivity = new Date();
                
                const m = this.serializeMessage(chatUpdate.messages[0], socket);
                if (!m.message) return;
                
                const body = this.extractMessageText(m.message);
                
                // DEBUG: Log message structure
                console.log('📥 Message received from:', m.sender.substring(0, 8));
                console.log('📦 Message type:', Object.keys(m.message || {})[0]);
                
                // Check for button responses FIRST (this is the key fix)
                if (m.message.buttonsResponseMessage) {
                    const buttonId = m.message.buttonsResponseMessage.selectedButtonId;
                    console.log(`🎯 Button clicked detected: ${buttonId}`);
                    if (buttonId) {
                        await this.handleButtonClick(m, socket, buttonId);
                        return;
                    }
                }
                
                // Check for list responses
                if (m.message.listResponseMessage) {
                    const buttonId = m.message.listResponseMessage.selectedRowId;
                    console.log(`📋 List button clicked: ${buttonId}`);
                    if (buttonId) {
                        await this.handleButtonClick(m, socket, buttonId);
                        return;
                    }
                }
                
                // Check for template button responses
                if (m.message.templateButtonReplyMessage) {
                    const buttonId = m.message.templateButtonReplyMessage.selectedId;
                    console.log(`🔘 Template button clicked: ${buttonId}`);
                    if (buttonId) {
                        await this.handleButtonClick(m, socket, buttonId);
                        return;
                    }
                }
                
                // Only process text messages after checking for buttons
                if (!body) return;
                
                m.body = body;
                
                // Check for user states (multi-step commands)
                const userId = m.sender;
                const userState = this.userStates.get(userId);
                
                if (userState && userState.waitingFor) {
                    await this.handleUserState(m, socket, userState);
                    return;
                }
                
                // Check for legacy button clicks (text format)
                if (body.startsWith('btn_')) {
                    console.log(`🔤 Legacy button text: ${body}`);
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
                    
                    // Execute plugin
                    const pluginResult = await pluginLoader.executePlugin(cmd, m, socket);
                    
                    if (!pluginResult.success) {
                        await this.handleBuiltinCommand(m, socket, cmd, args);
                    }
                }
                
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
        }
    }

    async handleButtonClick(m, sock, buttonId) {
        console.log(`🎯 Processing button click: ${buttonId} by ${m.sender.substring(0, 8)}...`);
        
        // Normalize button ID (remove prefixes if needed)
        let normalizedId = buttonId;
        if (!buttonId.startsWith('btn_')) {
            normalizedId = `btn_${buttonId}`;
        }
        
        console.log(`🆔 Normalized button ID: ${normalizedId}`);
        
        // Send acknowledgement reaction
        await m.React('✅').catch(() => {});
        
        // ==================== CORE BUTTONS ====================
        if (normalizedId === 'btn_ping' || buttonId === 'ping') {
            const start = Date.now();
            const pingMsg = await m.reply(`🏓 Testing latency...`);
            const latency = Date.now() - start;
            
            // Get bot ping from WebSocket
            const wsPing = sock.ws?.ping || 'N/A';
            
            const status = `⚡ *CLOUD AI Performance Report*\n\n` +
                          `⏱️ Response Time: ${latency}ms\n` +
                          `📡 WebSocket Ping: ${wsPing}ms\n` +
                          `🆔 Session: ${this.sessionId}\n` +
                          `📊 Status: ${latency < 500 ? 'Optimal ⚡' : 'Normal 📈'}\n` +
                          `🌐 Connection: ${this.connectionState}\n\n` +
                          `_${new Date().toLocaleTimeString()}_`;
            
            await sock.sendMessage(m.from, { text: status }, { quoted: m });
            return;
        }
        
        if (normalizedId === 'btn_status' || buttonId === 'status') {
            const uptime = this.getUptime();
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const status = `📊 *CLOUD AI System Status*\n\n` +
                          `• Session: ${this.sessionId}\n` +
                          `• State: ${this.connectionState}\n` +
                          `• Uptime: ${uptime}\n` +
                          `• Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                          `• Last Activity: ${this.lastActivity.toLocaleTimeString()}\n` +
                          `• Memory: ${memoryUsage} MB\n` +
                          `• Plugins: ${pluginLoader.plugins.size} loaded`;
            await m.reply(status);
            return;
        }
        
        if (normalizedId === 'btn_plugins' || buttonId === 'plugins') {
            const plugins = Array.from(pluginLoader.plugins.keys());
            const pluginList = plugins.length > 0 
                ? plugins.map(p => `• .${p}`).join('\n')
                : 'No plugins loaded';
            await m.reply(`📦 *Loaded Plugins (${plugins.length})*\n\n${pluginList}`);
            return;
        }
        
        if (normalizedId === 'btn_menu' || buttonId === 'menu') {
            // Trigger the menu command
            const menuPlugin = pluginLoader.plugins.get('menu');
            if (menuPlugin) {
                m.body = '.menu';
                await menuPlugin(m, sock);
            } else {
                await m.reply('❌ Menu plugin not found.');
            }
            return;
        }
        
        // ==================== OWNER BUTTONS ====================
        if (normalizedId === 'btn_owner' || normalizedId === 'btn_core_owner' || buttonId === 'owner') {
            await sendInteractiveMessage(sock, m.from, {
                title: '👑 BERA TECH Contact Suite',
                text: 'Select contact method:',
                footer: 'CLOUD AI Professional Contact',
                interactiveButtons: [
                    {
                        name: 'cta_call',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📞 Call Primary (+254116763755)',
                            phone_number: '+254116763755'
                        })
                    },
                    {
                        name: 'cta_call',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📞 Call Secondary (+254743982206)',
                            phone_number: '+254743982206'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '✉️ Send Email',
                            url: 'mailto:beratech00@gmail.com'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '💬 WhatsApp Chat',
                            url: 'https://wa.me/254116763755'
                        })
                    }
                ]
            });
            return;
        }
        
        // ==================== VCF BUTTONS ====================
        if (normalizedId === 'btn_vcf' || normalizedId === 'btn_tools_vcf' || buttonId === 'vcf') {
            if (!m.isGroup) {
                await m.reply('❌ VCF export only works in groups. Please use this command in a group.');
                return;
            }
            
            try {
                const groupMetadata = await sock.groupMetadata(m.from);
                await sendButtons(sock, m.from, {
                    title: '📇 Contact Export',
                    text: `Group: ${groupMetadata.subject}\nMembers: ${groupMetadata.participants.length}`,
                    footer: 'Select export option',
                    buttons: [
                        { id: 'btn_vcf_all', text: '📋 Export All' },
                        { id: 'btn_vcf_admins', text: '👑 Export Admins' },
                        { id: 'btn_vcf_cancel', text: '❌ Cancel' }
                    ]
                });
                m.vcfData = { metadata: groupMetadata };
            } catch (error) {
                await m.reply('❌ Failed to fetch group info.');
            }
            return;
        }
        
        if (normalizedId === 'btn_vcf_all') {
            if (!m.vcfData) {
                await m.reply('❌ Please run .vcf command first.');
                return;
            }
            await this.exportVCF(m, sock, 'all');
            return;
        }
        
        if (normalizedId === 'btn_vcf_admins') {
            if (!m.vcfData) {
                await m.reply('❌ Please run .vcf command first.');
                return;
            }
            await this.exportVCF(m, sock, 'admins');
            return;
        }
        
        // ==================== TAGALL BUTTONS ====================
        if (normalizedId === 'btn_tagall' || normalizedId === 'btn_group_tagall' || buttonId === 'tagall') {
            if (!m.isGroup) {
                await m.reply('❌ Tagall only works in groups.');
                return;
            }
            
            try {
                const groupMetadata = await sock.groupMetadata(m.from);
                const participant = groupMetadata.participants.find(p => p.id === m.sender);
                
                if (!participant?.admin) {
                    await m.reply('❌ Only admins can use tagall.');
                    return;
                }
                
                await sendButtons(sock, m.from, {
                    title: '🏷️ Tag All Members',
                    text: `Group: ${groupMetadata.subject}`,
                    footer: 'Select tagging option',
                    buttons: [
                        { id: 'btn_tag_all', text: '👥 Tag Everyone' },
                        { id: 'btn_tag_admins', text: '👑 Tag Admins' },
                        { id: 'btn_tag_custom', text: '✏️ Custom Message' }
                    ]
                });
                m.tagallData = { metadata: groupMetadata };
            } catch (error) {
                await m.reply('❌ Failed to fetch group info.');
            }
            return;
        }
        
        if (normalizedId === 'btn_tag_all') {
            if (!m.tagallData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            await this.tagMembers(m, sock, 'all');
            return;
        }
        
        if (normalizedId === 'btn_tag_admins') {
            if (!m.tagallData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            await this.tagMembers(m, sock, 'admins');
            return;
        }
        
        if (normalizedId === 'btn_tag_custom') {
            if (!m.tagallData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            await m.reply('✏️ Please type your custom message for tagging:');
            this.userStates.set(m.sender, {
                waitingFor: 'customTagMessage',
                data: { participants: m.tagallData.metadata.participants }
            });
            return;
        }
        
        // ==================== MUSIC BUTTONS ====================
        if (normalizedId === 'btn_play' || normalizedId === 'btn_music_play' || buttonId === 'play') {
            await sendButtons(sock, m.from, {
                title: '🎵 Music Center',
                text: 'Search for music or browse categories:',
                footer: 'CLOUD AI Music Player',
                buttons: [
                    { id: 'btn_music_search', text: '🔍 Search Music' },
                    { id: 'btn_music_pop', text: '🎤 Pop Hits' },
                    { id: 'btn_music_hiphop', text: '🎧 Hip Hop' },
                    { id: 'btn_music_afro', text: '🌍 Afro Beats' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_music_search') {
            await m.reply('🎵 Please type: `.play song name` to search for music');
            return;
        }
        
        // ==================== URL/UPLOAD BUTTONS ====================
        if (normalizedId === 'btn_url' || buttonId === 'url') {
            await m.reply('📁 Reply to any media (image/video/audio) with `.url` to upload it');
            return;
        }
        
        // ==================== PRIVACY BUTTONS ====================
        if (normalizedId.startsWith('btn_priv_')) {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 This feature is owner-only.');
                return;
            }
            
            if (normalizedId === 'btn_priv_lastseen') {
                await this.showPrivacyOptions(m, sock, 'lastseen');
            } else if (normalizedId === 'btn_priv_profile') {
                await this.showPrivacyOptions(m, sock, 'profile');
            } else if (normalizedId === 'btn_priv_status') {
                await this.showPrivacyOptions(m, sock, 'status');
            } else if (normalizedId === 'btn_priv_groupadd') {
                await this.showPrivacyOptions(m, sock, 'groupadd');
            } else if (normalizedId === 'btn_priv_disappear') {
                await this.showPrivacyOptions(m, sock, 'disappear');
            }
            return;
        }
        
        // ==================== PRIVACY SETTING BUTTONS ====================
        if (normalizedId.startsWith('btn_priv_set_')) {
            const parts = normalizedId.split('_');
            const settingType = parts[3];
            const value = parts[4];
            
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 This feature is owner-only.');
                return;
            }
            
            await this.applyPrivacySetting(m, sock, settingType, value);
            return;
        }
        
        // ==================== CANCEL BUTTONS ====================
        if (normalizedId.includes('cancel') || normalizedId.includes('done')) {
            await m.reply('✅ Operation completed.');
            return;
        }
        
        // ==================== DEFAULT ====================
        await m.reply(`❌ Button action "${buttonId}" not implemented yet.\n\nTry using commands instead:\n• .ping\n• .menu\n• .owner`);
    }

    // ==================== VCF EXPORT FUNCTION ====================
    async exportVCF(m, sock, type) {
        try {
            const { metadata } = m.vcfData;
            let participants = metadata.participants;
            
            if (type === 'admins') {
                participants = participants.filter(p => p.admin);
            }
            
            await m.reply(`⏳ Creating VCF for ${participants.length} contacts...`);
            
            let vcfContent = '';
            participants.forEach(participant => {
                const phoneNumber = participant.id.split('@')[0];
                const name = participant.name || participant.notify || `User_${phoneNumber}`;
                const isAdmin = participant.admin ? ' (Admin)' : '';
                
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}${isAdmin}\nTEL;TYPE=CELL:+${phoneNumber}\nEND:VCARD\n\n`;
            });
            
            const tempDir = path.join(__dirname, 'temp');
            await fs.mkdir(tempDir, { recursive: true });
            
            const filename = `contacts_${metadata.subject.replace(/[^a-z0-9]/gi, '_')}_${type}_${Date.now()}.vcf`;
            const filePath = path.join(tempDir, filename);
            await fs.writeFile(filePath, vcfContent, 'utf8');
            
            await sock.sendMessage(m.from, {
                document: { url: filePath },
                fileName: filename,
                mimetype: 'text/vcard',
                caption: `✅ *Contact Export Complete*\n\nGroup: ${metadata.subject}\nType: ${type}\nExported: ${participants.length} contacts\n\nPowered by CLOUD AI`
            }, { quoted: m });
            
            setTimeout(() => {
                fs.unlink(filePath).catch(() => {});
            }, 30000);
            
        } catch (error) {
            console.error('VCF Export Error:', error);
            await m.reply('❌ Error creating VCF file.');
        }
    }

    // ==================== TAG MEMBERS FUNCTION ====================
    async tagMembers(m, sock, type) {
        try {
            const { metadata } = m.tagallData;
            let participants = metadata.participants;
            
            if (type === 'admins') {
                participants = participants.filter(p => p.admin);
            }
            
            await m.reply(`⏳ Tagging ${participants.length} members...`);
            
            const mentions = participants.map(p => p.id);
            const tagMessage = `🔔 *Attention ${type === 'admins' ? 'Admins' : 'Everyone'}!*\n\n` +
                              `Message from: @${m.sender.split('@')[0]}\n` +
                              `Group: ${metadata.subject}\n\n` +
                              mentions.map(p => `@${p.split('@')[0]}`).join(' ') +
                              `\n\n🏷️ Powered by CLOUD AI`;
            
            await sock.sendMessage(m.from, {
                text: tagMessage,
                mentions: mentions
            }, { quoted: m });
            
        } catch (error) {
            console.error('Tag Error:', error);
            await m.reply('❌ Error tagging members.');
        }
    }

    // ==================== PRIVACY FUNCTIONS ====================
    async showPrivacyOptions(m, sock, settingType) {
        const options = {
            lastseen: ['all', 'contacts', 'none'],
            profile: ['all', 'contacts', 'none'],
            status: ['all', 'contacts', 'none'],
            groupadd: ['all', 'contacts', 'none'],
            disappear: ['0', '86400', '604800']
        };
        
        const labels = {
            all: '👁️ Everyone',
            contacts: '📱 Contacts',
            none: '🙈 Nobody',
            '0': '❌ Off',
            '86400': '⏰ 24 Hours',
            '604800': '📅 7 Days'
        };
        
        const settingLabels = {
            lastseen: 'Last Seen',
            profile: 'Profile Photo',
            status: 'Status',
            groupadd: 'Group Add',
            disappear: 'Disappearing Messages'
        };
        
        const buttons = options[settingType].map(value => ({
            id: `btn_priv_set_${settingType}_${value}`,
            text: labels[value] || value
        }));
        
        buttons.push({ id: 'btn_priv_cancel', text: '❌ Cancel' });
        
        await sendButtons(sock, m.from, {
            title: `🔐 ${settingLabels[settingType]} Privacy`,
            text: 'Select privacy level:',
            footer: 'CLOUD AI Privacy Manager',
            buttons: buttons
        });
    }

    async applyPrivacySetting(m, sock, settingType, value) {
        try {
            await m.reply(`⚙️ Updating ${settingType} privacy...`);
            
            // Note: Actual privacy API might need adjustment based on Baileys version
            if (settingType === 'disappear') {
                await sock.updateDisappearingMode(parseInt(value));
            } else {
                await sock.updatePrivacySettings(settingType, value);
            }
            
            const readableValue = {
                'all': 'Everyone',
                'contacts': 'Contacts',
                'none': 'Nobody',
                '0': 'Off',
                '86400': '24 Hours',
                '604800': '7 Days'
            }[value] || value;
            
            await sendButtons(sock, m.from, {
                title: '✅ Privacy Updated',
                text: `Setting: ${settingType}\nValue: ${readableValue}`,
                footer: 'Changes applied successfully',
                buttons: [
                    { id: 'btn_priv_more', text: '⚙️ More Settings' },
                    { id: 'btn_priv_done', text: '✅ Done' }
                ]
            });
            
        } catch (error) {
            console.error('Privacy Update Error:', error);
            await m.reply(`❌ Failed to update ${settingType} privacy.`);
        }
    }

    // ==================== HELPER FUNCTIONS ====================
    async handleBuiltinCommand(m, sock, cmd, args) {
        switch(cmd) {
            case 'ping':
                const start = Date.now();
                await m.reply(`🏓 Pong!`);
                const latency = Date.now() - start;
                await sock.sendMessage(m.from, { text: `⏱️ Latency: ${latency}ms` });
                break;
                
            case 'menu':
                // Handled by menu plugin
                break;
                
            case 'plugins':
            case 'pl':
                const plugins = Array.from(pluginLoader.plugins.keys());
                await m.reply(`📦 Loaded Plugins (${plugins.length}):\n${plugins.map(p => `• .${p}`).join('\n')}`);
                break;
                
            case 'status':
                const uptime = this.getUptime();
                const status = `📊 *CLOUD AI Status*\n\n` +
                              `• Session: ${this.sessionId}\n` +
                              `• State: ${this.connectionState}\n` +
                              `• Uptime: ${uptime}\n` +
                              `• Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                              `• Last Activity: ${this.lastActivity.toLocaleTimeString()}`;
                await m.reply(status);
                break;
                
            default:
                await m.reply(`❓ Unknown command: .${cmd}\n\nType .menu for commands`);
        }
    }

    extractMessageText(message) {
        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
        if (message.imageMessage?.caption) return message.imageMessage.caption;
        if (message.videoMessage?.caption) return message.videoMessage.caption;
        if (message.buttonsResponseMessage?.selectedButtonId) return null; // Don't extract text from buttons
        if (message.listResponseMessage?.selectedRowId) return null; // Don't extract text from list buttons
        return '';
    }

    serializeMessage(message, sock) {
        const m = { ...message };
        
        if (m.key) {
            m.id = m.key.id;
            m.isSelf = m.key.fromMe;
            m.from = this.decodeJid(m.key.remoteJid);
            m.isGroup = m.from.endsWith("@g.us");
            
            if (m.isGroup) {
                m.sender = this.decodeJid(m.key.participant);
            } else if (m.isSelf) {
                m.sender = this.decodeJid(sock.user.id);
            } else {
                m.sender = m.from;
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
                              `*Powered by BERA TECH*`;
            
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
        
        this.userStates.clear();
        
        console.log(`🛑 CLOUD AI bot stopped: ${this.sessionId}`);
    }
}

// ==================== EXPORT FUNCTIONS ====================
async function initializeBotSystem() {
    try {
        console.log('☁️ CLOUD AI system initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize CLOUD AI system:', error);
        return false;
    }
}

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

global.activeBots = {};

module.exports = {
    BotRunner,
    startBotInstance,
    stopBotInstance,
    getActiveBots,
    initializeBotSystem
};
