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
                
                console.log('📥 Message received from:', m.sender.substring(0, 8));
                console.log('📦 Message type:', Object.keys(m.message || {})[0]);
                
                // ==================== BUTTON DETECTION ====================
                // Check for interactive template buttons
                if (m.message?.templateButtonReplyMessage) {
                    const buttonId = m.message.templateButtonReplyMessage.selectedId;
                    console.log(`🔘 Template button clicked: ${buttonId}`);
                    if (buttonId) {
                        await this.handleButtonClick(m, socket, buttonId);
                        return;
                    }
                }
                
                // Check for interactive list buttons
                if (m.message?.interactiveResponseMessage?.listReply) {
                    const buttonId = m.message.interactiveResponseMessage.listReply.singleSelectReply.selectedRowId;
                    console.log(`📋 Interactive list button: ${buttonId}`);
                    if (buttonId) {
                        await this.handleButtonClick(m, socket, buttonId);
                        return;
                    }
                }
                
                // Check for button responses
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
        
        // Normalize button ID
        let normalizedId = buttonId;
        if (!buttonId.startsWith('btn_')) {
            normalizedId = `btn_${buttonId}`;
        }
        
        console.log(`🆔 Normalized button ID: ${normalizedId}`);
        
        // Send acknowledgement reaction
        await m.React('✅').catch(() => {});
        
        // ==================== CORE BUTTONS ====================
        if (normalizedId === 'btn_ping' || buttonId === 'ping' || normalizedId === 'btn_core_ping') {
            const start = Date.now();
            await m.reply(`🏓 Testing latency...`);
            const latency = Date.now() - start;
            
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
        
        if (normalizedId === 'btn_status' || buttonId === 'status' || normalizedId === 'btn_core_status' || normalizedId === 'btn_system_status') {
            const uptime = this.getUptime();
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            
            // Get system information
            const os = require('os');
            const totalMemory = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
            const freeMemory = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
            const platform = os.platform();
            const arch = os.arch();
            
            const status = `📊 *CLOUD AI System Status*\n\n` +
                          `🆔 Session: ${this.sessionId}\n` +
                          `🔌 State: ${this.connectionState}\n` +
                          `⏱️ Uptime: ${uptime}\n` +
                          `🔄 Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                          `📅 Last Activity: ${this.lastActivity.toLocaleTimeString()}\n` +
                          `💾 Memory: ${memoryUsage} MB\n` +
                          `💿 Total RAM: ${totalMemory} GB\n` +
                          `📦 Free RAM: ${freeMemory} GB\n` +
                          `🖥️ Platform: ${platform} ${arch}\n` +
                          `🔌 Plugins: ${pluginLoader.plugins.size} loaded\n` +
                          `🌐 Node.js: ${process.version}`;
            
            await sendButtons(sock, m.from, {
                title: '📊 System Status',
                text: status,
                footer: 'Real-time system metrics',
                buttons: [
                    { id: 'btn_ping', text: '🏓 Ping Test' },
                    { id: 'btn_plugins', text: '📦 Plugins' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_plugins' || buttonId === 'plugins' || normalizedId === 'btn_core_plugins') {
            const plugins = Array.from(pluginLoader.plugins.keys());
            const pluginList = plugins.length > 0 
                ? plugins.map(p => `• .${p}`).join('\n')
                : 'No plugins loaded';
            await m.reply(`📦 *Loaded Plugins (${plugins.length})*\n\n${pluginList}`);
            return;
        }
        
        if (normalizedId === 'btn_menu' || buttonId === 'menu' || normalizedId === 'btn_core_menu') {
            const menuPlugin = pluginLoader.plugins.get('menu');
            if (menuPlugin) {
                m.body = '.menu';
                await menuPlugin(m, sock);
            } else {
                await m.reply('❌ Menu plugin not found.');
            }
            return;
        }
        
        // ==================== MENU CATEGORY BUTTONS ====================
        if (normalizedId === 'btn_menu_tools' || normalizedId === 'btn_menu') {
            await sendButtons(sock, m.from, {
                title: '🛠️ Tools Menu',
                text: `*Available Tools:*\n\n• .ping - Check bot speed\n• .vcf - Export group contacts\n• .url - Upload media to cloud\n• .logo - Generate logos\n• .play - Download music\n• .view - Media viewer`,
                footer: 'Select a tool or use command',
                buttons: [
                    { id: 'btn_ping', text: '🏓 Ping' },
                    { id: 'btn_vcf', text: '📇 VCF Export' },
                    { id: 'btn_url', text: '🌐 URL Upload' },
                    { id: 'btn_logo_menu', text: '🎨 Logo Maker' },
                    { id: 'btn_play', text: '🎵 Music' },
                    { id: 'btn_view', text: '👁️ View Media' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_menu_media') {
            await sendButtons(sock, m.from, {
                title: '📁 Media Menu',
                text: `*Media Tools:*\n\n• .url - Upload files\n• .view - View/download media\n• .play - Music downloader\n• Image editing tools\n• Video tools\n• Audio tools`,
                footer: 'Media processing tools',
                buttons: [
                    { id: 'btn_url', text: '🌐 Upload' },
                    { id: 'btn_view', text: '👁️ View Media' },
                    { id: 'btn_play', text: '🎵 Music' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_menu_group' || normalizedId === 'btn_group_tagall') {
            if (!m.isGroup) {
                await m.reply('❌ Group features only work in groups.');
                return;
            }
            
            await sendButtons(sock, m.from, {
                title: '👥 Group Menu',
                text: `*Group Management:*\n\n• .tagall - Tag all members\n• .vcf - Export contacts\n• Group info\n• Admin tools\n• Member management\n• Settings`,
                footer: 'Group administration tools',
                buttons: [
                    { id: 'btn_tagall', text: '🏷️ Tag All' },
                    { id: 'btn_vcf', text: '📇 Export Contacts' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_menu_fun') {
            await sendButtons(sock, m.from, {
                title: '🎮 Fun Menu',
                text: `*Fun & Games:*\n\n• .logo - Logo generator\n• Sticker maker\n• Games\n• AI chat\n• Entertainment\n• Random tools`,
                footer: 'Entertainment features',
                buttons: [
                    { id: 'btn_logo_menu', text: '🎨 Logo Maker' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_menu_owner') {
            // Owner verification
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 *Owner Access Required*\nThis menu is restricted to BERA TECH.');
                return;
            }
            
            await sendButtons(sock, m.from, {
                title: '👑 Owner Menu',
                text: `*Owner Tools:*\n\n• .mode - Change bot mode\n• .autoreact - Auto reactions\n• .autotyping - Fake typing\n• .autorecording - Recording status\n• .privacy - Privacy settings\n• Bot controls`,
                footer: 'Owner-only commands',
                buttons: [
                    { id: 'btn_mode_info', text: '⚙️ Bot Mode' },
                    { id: 'btn_priv_visibility', text: '🔐 Privacy' },
                    { id: 'btn_autoreact', text: '💬 Auto React' },
                    { id: 'btn_autotyping', text: '⌨️ Auto Typing' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_menu_back') {
            // Go back to main menu
            const menuPlugin = pluginLoader.plugins.get('menu');
            if (menuPlugin) {
                m.body = '.menu';
                await menuPlugin(m, sock);
            } else {
                // Fallback to main menu buttons
                await sendButtons(sock, m.from, {
                    title: '☁️ CLOUD AI Menu',
                    text: 'Main Menu - Select a category:',
                    footer: 'Powered by BERA TECH',
                    buttons: [
                        { id: 'btn_menu_tools', text: '🛠️ Tools' },
                        { id: 'btn_menu_media', text: '📁 Media' },
                        { id: 'btn_menu_group', text: '👥 Group' },
                        { id: 'btn_menu_fun', text: '🎮 Fun' },
                        { id: 'btn_menu_owner', text: '👑 Owner' },
                        { id: 'btn_system_status', text: '📊 Status' }
                    ]
                });
            }
            return;
        }
        
        // ==================== LOGO MENU SYSTEM ====================
        if (normalizedId === 'btn_logo_menu') {
            // Logo category menu
            await sendButtons(sock, m.from, {
                title: '🎨 Logo Generator',
                text: `*Select logo category:*\n\nOr type directly:\n.logo [style] [text]\nExample: .logo glow CLOUD AI`,
                footer: 'Choose a category or type manually',
                buttons: [
                    { id: 'btn_logo_popular', text: '🎨 Popular' },
                    { id: 'btn_logo_water', text: '🌊 Water' },
                    { id: 'btn_logo_glow', text: '✨ Glow' },
                    { id: 'btn_logo_creative', text: '🎭 Creative' },
                    { id: 'btn_logo_backgrounds', text: '🌌 Backgrounds' },
                    { id: 'btn_logo_special', text: '🎉 Special' },
                    { id: 'btn_menu_back', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        // Logo sub-categories
        const logoCategories = {
            'btn_logo_popular': ['blackpink', 'glow', 'naruto', 'hacker', 'luxury', 'avatar'],
            'btn_logo_water': ['water', 'water3d', 'underwater', 'wetglass', 'bulb'],
            'btn_logo_glow': ['glossysilver', 'gold', 'textlight', 'bokeh', 'neon'],
            'btn_logo_creative': ['graffiti', 'paint', 'typography', 'rotation', 'digitalglitch'],
            'btn_logo_backgrounds': ['galaxy', 'blood', 'snow', 'thunder', 'sand', 'wall'],
            'btn_logo_special': ['birthdaycake', 'halloween', 'valentine', 'pubg', 'zodiac', 'team']
        };
        
        if (Object.keys(logoCategories).includes(normalizedId)) {
            const styles = logoCategories[normalizedId];
            const categoryName = {
                'btn_logo_popular': 'Popular',
                'btn_logo_water': 'Water Effects',
                'btn_logo_glow': 'Glow Effects',
                'btn_logo_creative': 'Creative',
                'btn_logo_backgrounds': 'Backgrounds',
                'btn_logo_special': 'Special'
            }[normalizedId];
            
            let buttons = styles.map(style => ({
                id: `btn_logo_select_${style}`,
                text: style.charAt(0).toUpperCase() + style.slice(1)
            }));
            buttons.push({ id: 'btn_logo_menu', text: '🔙 Back' });
            
            await sendButtons(sock, m.from, {
                title: `🎨 ${categoryName} Logos`,
                text: `*Select a style:*\n\nThen type:\n\`\`\`.logo [style] [your text]\`\`\`\n\nExample:\n.logo ${styles[0]} CLOUD AI`,
                footer: 'Click style, then type command',
                buttons: buttons.slice(0, 6) // WhatsApp limit
            });
            return;
        }
        
        if (normalizedId.startsWith('btn_logo_select_')) {
            const style = normalizedId.replace('btn_logo_select_', '');
            await m.reply(`🎨 *Logo Style Selected:* ${style}\n\nNow type:\n\`\`\`.logo ${style} YOUR TEXT HERE\`\`\`\n\nExample:\n\`\`\`.logo ${style} CLOUD AI BOT\`\`\`\n\nTip: You can add emojis too!`);
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
        
        // Owner feature buttons
        if (normalizedId === 'btn_autoreact') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            await sendButtons(sock, m.from, {
                title: '💬 Auto-Reaction',
                text: `*Auto-Reaction Settings*\n\nBot will automatically react to messages.\n\nCurrent: ${process.env.AUTO_REACT === 'true' ? 'ON ✅' : 'OFF ❌'}`,
                footer: 'Owner only feature',
                buttons: [
                    { id: 'btn_autoreact_on', text: '✅ Turn ON' },
                    { id: 'btn_autoreact_off', text: '❌ Turn OFF' },
                    { id: 'btn_menu_owner', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_autotyping') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            await sendButtons(sock, m.from, {
                title: '⌨️ Auto-Typing',
                text: `*Auto-Typing Settings*\n\nBot will show fake typing indicators.\n\nCurrent: ${config.AUTO_TYPING ? 'ON ✅' : 'OFF ❌'}`,
                footer: 'Owner only feature',
                buttons: [
                    { id: 'btn_autotyping_on', text: '✅ Turn ON' },
                    { id: 'btn_autotyping_off', text: '❌ Turn OFF' },
                    { id: 'btn_menu_owner', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_autoreact_on') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            process.env.AUTO_REACT = 'true';
            await m.reply('✅ Auto-reaction turned ON\nBot will now react to messages automatically.');
            return;
        }
        
        if (normalizedId === 'btn_autoreact_off') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            process.env.AUTO_REACT = 'false';
            await m.reply('❌ Auto-reaction turned OFF');
            return;
        }
        
        if (normalizedId === 'btn_autotyping_on') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            config.AUTO_TYPING = true;
            await m.reply('⌨️ Auto-typing turned ON\nBot will show random typing indicators.');
            return;
        }
        
        if (normalizedId === 'btn_autotyping_off') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            config.AUTO_TYPING = false;
            await m.reply('🚫 Auto-typing turned OFF');
            return;
        }
        
        if (normalizedId === 'btn_mode_info') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            const currentMode = config.BOT_MODE || 'private';
            const info = `⚙️ *Bot Mode Information*\n\n` +
                        `Current: ${currentMode.toUpperCase()}\n\n` +
                        `🌐 *Public Mode:*\n• Everyone can use commands\n• All features available\n\n` +
                        `🔒 *Private Mode:*\n• Only owner can use commands\n• Restricted access`;
            
            await sendButtons(sock, m.from, {
                title: '⚙️ Bot Mode',
                text: info,
                footer: 'Owner only configuration',
                buttons: [
                    { id: 'btn_mode_public', text: '🌐 Set Public' },
                    { id: 'btn_mode_private', text: '🔒 Set Private' },
                    { id: 'btn_menu_owner', text: '🔙 Back' }
                ]
            });
            return;
        }
        
        if (normalizedId === 'btn_mode_public') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            config.BOT_MODE = 'public';
            process.env.BOT_MODE = 'public';
            await m.reply(`🌐 *Public Mode ACTIVATED*\n\nEveryone can now use bot commands.`);
            return;
        }
        
        if (normalizedId === 'btn_mode_private') {
            const userId = m.sender.split('@')[0];
            const ownerNumbers = ['254116763755', '254743982206'];
            
            if (!ownerNumbers.includes(userId)) {
                await m.reply('🔒 Owner access required.');
                return;
            }
            
            const config = require('../config.cjs');
            config.BOT_MODE = 'private';
            process.env.BOT_MODE = 'private';
            await m.reply(`🔒 *Private Mode ACTIVATED*\n\nOnly owner can use bot commands.`);
            return;
        }
        
        // ==================== VCF BUTTONS ====================
        if (normalizedId === 'btn_vcf' || normalizedId === 'btn_tools_vcf') {
            if (!m.isGroup) {
                await m.reply('❌ VCF export only works in groups.');
                return;
            }
            
            // Trigger the vcf command
            const vcfPlugin = pluginLoader.plugins.get('vcf');
            if (vcfPlugin) {
                m.body = '.vcf';
                await vcfPlugin(m, sock);
            } else {
                await m.reply('❌ VCF plugin not found.');
            }
            return;
        }
        
        if (normalizedId === 'btn_vcf_all_pro' || normalizedId === 'btn_vcf_all') {
            if (!m.vcfData && !m.exportData) {
                await m.reply('❌ Please run .vcf command first.');
                return;
            }
            
            const data = m.vcfData || m.exportData;
            await this.exportVCF(m, sock, 'all', data);
            return;
        }
        
        if (normalizedId === 'btn_vcf_admins_pro' || normalizedId === 'btn_vcf_admins') {
            if (!m.vcfData && !m.exportData) {
                await m.reply('❌ Please run .vcf command first.');
                return;
            }
            
            const data = m.vcfData || m.exportData;
            await this.exportVCF(m, sock, 'admins', data);
            return;
        }
        
        if (normalizedId === 'btn_vcf_custom') {
            await m.reply('⚙️ Custom selection feature coming soon!\n\nUse: .vcf for group contact export');
            return;
        }
        
        if (normalizedId === 'btn_vcf_cancel' || normalizedId === 'btn_core_cancel') {
            await m.reply('✅ VCF export cancelled.');
            delete m.vcfData;
            delete m.exportData;
            return;
        }
        
        // ==================== TAGALL BUTTONS ====================
        if (normalizedId === 'btn_tagall') {
            if (!m.isGroup) {
                await m.reply('❌ Tagall only works in groups.');
                return;
            }
            
            // Trigger the tagall command
            const tagallPlugin = pluginLoader.plugins.get('tagall');
            if (tagallPlugin) {
                m.body = '.tagall';
                await tagallPlugin(m, sock);
            } else {
                await m.reply('❌ Tagall plugin not found.');
            }
            return;
        }
        
        if (normalizedId === 'btn_tag_all_pro' || normalizedId === 'btn_tag_all') {
            if (!m.tagallData && !m.groupManagerData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            
            const data = m.tagallData || m.groupManagerData;
            await this.tagMembers(m, sock, 'all', data);
            return;
        }
        
        if (normalizedId === 'btn_tag_admins_pro' || normalizedId === 'btn_tag_admins') {
            if (!m.tagallData && !m.groupManagerData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            
            const data = m.tagallData || m.groupManagerData;
            await this.tagMembers(m, sock, 'admins', data);
            return;
        }
        
        if (normalizedId === 'btn_tag_regular') {
            if (!m.groupManagerData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            await this.tagMembers(m, sock, 'regular', m.groupManagerData);
            return;
        }
        
        if (normalizedId === 'btn_tag_custom_msg' || normalizedId === 'btn_tag_custom') {
            if (!m.tagallData && !m.groupManagerData) {
                await m.reply('❌ Please run .tagall command first.');
                return;
            }
            
            const data = m.tagallData || m.groupManagerData;
            await m.reply('✏️ Please type your custom message for tagging:');
            this.userStates.set(m.sender, {
                waitingFor: 'customTagMessage',
                data: { participants: data.metadata.participants }
            });
            return;
        }
        
        if (normalizedId === 'btn_tag_cancel') {
            await m.reply('✅ Tag operation cancelled.');
            delete m.tagallData;
            delete m.groupManagerData;
            return;
        }
        
        // ==================== URL/UPLOAD BUTTONS ====================
        if (normalizedId === 'btn_url' || buttonId === 'url') {
            if (!m.quoted) {
                await sendButtons(sock, m.from, {
                    title: '🌐 Media Upload',
                    text: `*How to use:*\n1. Reply to any media\n2. Click "Upload" button\n3. Select service\n\nOr type: .url`,
                    footer: 'Media hosting service',
                    buttons: [
                        { id: 'btn_url_tutorial', text: '📚 Tutorial' },
                        { id: 'btn_url_formats', text: '📋 Formats' },
                        { id: 'btn_menu_back', text: '🔙 Back' }
                    ]
                });
                return;
            }
            
            // Trigger the url command
            const urlPlugin = pluginLoader.plugins.get('url');
            if (urlPlugin) {
                m.body = '.url';
                await urlPlugin(m, sock);
            } else {
                await m.reply('❌ URL plugin not found.');
            }
            return;
        }
        
        if (normalizedId === 'btn_url_tutorial') {
            const tutorial = `📚 *Media Upload Tutorial*\n\n` +
                            `1. *Reply* to any media (image/video/audio/document)\n` +
                            `2. Type *${process.env.BOT_PREFIX || '.'}url*\n` +
                            `3. Select upload service\n` +
                            `4. Get shareable link\n\n` +
                            `📁 *Max Size:* 50MB\n` +
                            `🌐 *Supported:* Images, Videos, Audio, Documents`;
            await m.reply(tutorial);
            return;
        }
        
        if (normalizedId === 'btn_url_formats') {
            const formats = `📋 *Supported Formats*\n\n` +
                           `🖼️ *Images:* JPG, PNG, GIF, WebP\n` +
                           `🎥 *Videos:* MP4, MOV, AVI, MKV\n` +
                           `🎵 *Audio:* MP3, M4A, OGG, WAV\n` +
                           `📄 *Documents:* PDF, DOC, TXT, ZIP\n` +
                           `📁 *Max Size:* 50MB\n` +
                           `⚡ *Fast Upload:* Instant processing`;
            await m.reply(formats);
            return;
        }
        
        if (normalizedId === 'btn_url_tmpfiles') {
            if (!m.uploadData) {
                await m.reply('❌ Please reply to media first with .url');
                return;
            }
            await this.handleMediaUpload(m, sock, 'tmpfiles');
            return;
        }
        
        if (normalizedId === 'btn_url_catbox') {
            if (!m.uploadData) {
                await m.reply('❌ Please reply to media first with .url');
                return;
            }
            await this.handleMediaUpload(m, sock, 'catbox');
            return;
        }
        
        if (normalizedId === 'btn_url_analysis') {
            if (!m.uploadData) {
                await m.reply('❌ Please reply to media first with .url');
                return;
            }
            await this.analyzeMedia(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_url_copy') {
            await m.reply('📋 Copy URL feature - coming soon!\n\nFor now, long-press the URL link to copy.');
            return;
        }
        
        if (normalizedId === 'btn_url_new') {
            await m.reply('🔄 For new upload, reply to another media with .url');
            return;
        }
        
        if (normalizedId === 'btn_url_cancel') {
            await m.reply('✅ Upload cancelled.');
            delete m.uploadData;
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
        
        if (normalizedId === 'btn_music_help') {
            const help = `🎵 *Music Player Help*\n\n` +
                        `• .play [song name] - Search and download music\n` +
                        `• Click buttons for quick access\n` +
                        `• Supported: YouTube music\n` +
                        `• High quality audio`;
            await m.reply(help);
            return;
        }
        
        // ==================== VIEW BUTTONS ====================
        if (normalizedId === 'btn_view' || buttonId === 'view') {
            // Trigger the view command
            const viewPlugin = pluginLoader.plugins.get('view');
            if (viewPlugin) {
                m.body = '.view';
                await viewPlugin(m, sock);
            } else {
                await m.reply('❌ View plugin not found.');
            }
            return;
        }
        
        if (normalizedId === 'btn_view_download') {
            if (!m.viewData) {
                await m.reply('❌ No media data found.');
                return;
            }
            
            const { buffer, type, quotedMsg, fileSize } = m.viewData;
            
            try {
                if (type === 'image') {
                    await sock.sendMessage(m.from, {
                        image: buffer,
                        caption: `📷 Downloaded via CLOUD AI\nSize: ${fileSize} MB`
                    }, { quoted: m });
                } else if (type === 'video') {
                    await sock.sendMessage(m.from, {
                        video: buffer,
                        caption: `🎥 Downloaded via CLOUD AI\nSize: ${fileSize} MB`,
                        mimetype: 'video/mp4'
                    }, { quoted: m });
                } else if (type === 'audio') {
                    const mimetype = quotedMsg.audioMessage?.mimetype || 'audio/mp4';
                    await sock.sendMessage(m.from, {
                        audio: buffer,
                        mimetype: mimetype,
                        ptt: false
                    }, { quoted: m });
                } else if (type === 'document') {
                    const filename = quotedMsg.documentMessage?.fileName || `download_${Date.now()}.${type}`;
                    await sock.sendMessage(m.from, {
                        document: buffer,
                        fileName: filename,
                        mimetype: quotedMsg.documentMessage?.mimetype || 'application/octet-stream'
                    }, { quoted: m });
                }
                await m.React('✅');
            } catch (error) {
                console.error('Download Error:', error);
                await m.reply('❌ Failed to download media.');
            }
            return;
        }
        
        if (normalizedId === 'btn_view_info_full') {
            if (!m.viewData) {
                await m.reply('❌ No media data found.');
                return;
            }
            
            const { type, quotedMsg, fileSize } = m.viewData;
            let info = `📊 *Media Information*\n\n` +
                       `Type: ${type}\n` +
                       `Size: ${fileSize} MB\n`;
            
            if (type === 'image' && quotedMsg.imageMessage) {
                info += `Dimensions: ${quotedMsg.imageMessage.width}x${quotedMsg.imageMessage.height}\n`;
                info += `Caption: ${quotedMsg.imageMessage.caption || 'None'}\n`;
            } else if (type === 'video' && quotedMsg.videoMessage) {
                info += `Duration: ${quotedMsg.videoMessage.seconds}s\n`;
                info += `Dimensions: ${quotedMsg.videoMessage.width}x${quotedMsg.videoMessage.height}\n`;
                info += `Caption: ${quotedMsg.videoMessage.caption || 'None'}\n`;
            } else if (type === 'audio' && quotedMsg.audioMessage) {
                info += `Duration: ${quotedMsg.audioMessage.seconds}s\n`;
                info += `PTT: ${quotedMsg.audioMessage.ptt ? 'Yes' : 'No'}\n`;
            }
            
            info += `\nClick "Download" to save the media.`;
            
            await m.reply(info);
            return;
        }
        
        if (normalizedId === 'btn_view_help') {
            const help = `👁️ *Media Viewer Help*\n\n` +
                        `Usage:\n1. Reply to any media message\n2. Type .view\n3. Select an option\n\n` +
                        `Features:\n• Download media\n• View media info\n• Extract media files`;
            await m.reply(help);
            return;
        }
        
        if (normalizedId === 'btn_view_cancel') {
            await m.reply('✅ Media viewer closed.');
            delete m.viewData;
            return;
        }
        
        // ==================== PRIVACY BUTTONS ====================
        if (normalizedId === 'btn_priv_visibility') {
            await this.showPrivacyOptions(m, sock, 'lastseen');
            return;
        }
        
        if (normalizedId === 'btn_priv_messaging') {
            await this.showPrivacyOptions(m, sock, 'disappear');
            return;
        }
        
        if (normalizedId === 'btn_priv_account') {
            await this.showPrivacyOptions(m, sock, 'profile');
            return;
        }
        
        if (normalizedId === 'btn_priv_bot') {
            await m.reply('🤖 Bot controls - Owner only');
            return;
        }
        
        if (normalizedId === 'btn_priv_advanced') {
            await this.showPrivacyOptions(m, sock, 'status');
            return;
        }
        
        if (normalizedId === 'btn_priv_cancel' || normalizedId === 'btn_priv_done') {
            await m.reply('✅ Privacy settings closed.');
            return;
        }
        
        // ==================== DEFAULT ====================
        await m.reply(`❌ Button action "${buttonId}" not implemented yet.\n\nTry using commands instead:\n• .ping\n• .menu\n• .owner`);
    }

    // ==================== HELPER FUNCTIONS ====================
    async exportVCF(m, sock, type, data) {
        try {
            const { metadata, participants, admins } = data;
            let exportParticipants = [];
            let exportType = '';
            
            switch(type) {
                case 'all':
                    exportParticipants = participants || metadata.participants;
                    exportType = 'All Contacts';
                    break;
                case 'admins':
                    exportParticipants = admins || (participants ? participants.filter(p => p.admin) : metadata.participants.filter(p => p.admin));
                    exportType = 'Administrators Only';
                    break;
                default:
                    return m.reply('❌ Invalid export type.');
            }
            
            if (exportParticipants.length === 0) {
                return m.reply(`❌ No ${type === 'admins' ? 'administrators' : 'contacts'} found to export.`);
            }
            
            await m.reply(`⏳ Creating VCF for ${exportParticipants.length} contacts...`);
            
            let vcfContent = '';
            exportParticipants.forEach(participant => {
                const phoneNumber = participant.id.split('@')[0];
                const name = participant.name || participant.notify || `User_${phoneNumber}`;
                const isAdmin = participant.admin ? ';ADMIN' : '';
                
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
                caption: `✅ *Contact Export Complete*\n\nGroup: ${metadata.subject}\nType: ${type}\nExported: ${exportParticipants.length} contacts\n\nPowered by CLOUD AI`
            }, { quoted: m });
            
            setTimeout(() => {
                fs.unlink(filePath).catch(() => {});
            }, 30000);
            
        } catch (error) {
            console.error('VCF Export Error:', error);
            await m.reply('❌ Error creating VCF file.');
        }
    }

    async tagMembers(m, sock, type, data) {
        try {
            const { metadata, participants, admins, regularMembers } = data;
            let targetParticipants = [];
            let tagType = '';
            
            switch(type) {
                case 'all':
                    targetParticipants = participants || metadata.participants;
                    tagType = 'All Members';
                    break;
                case 'admins':
                    targetParticipants = admins || (participants ? participants.filter(p => p.admin) : metadata.participants.filter(p => p.admin));
                    tagType = 'Administrators';
                    break;
                case 'regular':
                    targetParticipants = regularMembers || (participants ? participants.filter(p => !p.admin) : metadata.participants.filter(p => !p.admin));
                    tagType = 'Regular Members';
                    break;
                default:
                    return m.reply('❌ Invalid tag type.');
            }
            
            if (targetParticipants.length === 0) {
                return m.reply(`❌ No ${tagType.toLowerCase()} found to tag.`);
            }
            
            await m.reply(`⏳ Tagging ${targetParticipants.length} members...`);
            
            const mentions = targetParticipants.map(p => p.id);
            const tagMessage = `🔔 *${tagType.toUpperCase()} NOTIFICATION*\n\n` +
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

    async handleMediaUpload(m, sock, service) {
        try {
            const { quotedMsg } = m.uploadData;
            await m.reply(`⚙️ Uploading to ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}...`);
            
            const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
            const fileSizeMB = (mediaBuffer.length / (1024 * 1024)).toFixed(2);
            
            if (fileSizeMB > 50) {
                return m.reply(`❌ *File Too Large*\n\nSize: ${fileSizeMB}MB\nLimit: 50MB\n\nPlease use a smaller file.`);
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
            
            const result = `✅ *Upload Successful*\n\n` +
                          `🌐 Service: ${serviceName}\n` +
                          `📁 Size: ${fileSizeMB}MB\n` +
                          `🔗 URL: ${uploadUrl}\n\n` +
                          `Link expires: ${service === 'tmpfiles' ? '1 hour' : 'Permanent'}`;
            
            await sock.sendMessage(m.from, { text: result }, { quoted: m });
            
        } catch (error) {
            console.error('Upload Error:', error);
            await m.reply(`❌ ${service} upload failed: ${error.message}`);
        }
    }

    async analyzeMedia(m, sock) {
        try {
            const { quotedMsg } = m.uploadData;
            await m.reply('📊 Analyzing media...');
            
            const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
            const fileSizeMB = (mediaBuffer.length / (1024 * 1024)).toFixed(2);
            
            let mediaType = 'Unknown';
            let dimensions = 'N/A';
            
            if (quotedMsg.imageMessage) {
                mediaType = 'Image';
                dimensions = `${quotedMsg.imageMessage.width}x${quotedMsg.imageMessage.height}`;
            } else if (quotedMsg.videoMessage) {
                mediaType = 'Video';
                dimensions = `${quotedMsg.videoMessage.width}x${quotedMsg.videoMessage.height}`;
            } else if (quotedMsg.audioMessage) {
                mediaType = 'Audio';
                dimensions = `${quotedMsg.audioMessage.seconds}s`;
            } else if (quotedMsg.documentMessage) {
                mediaType = 'Document';
                dimensions = quotedMsg.documentMessage.fileName || 'Unknown';
            }
            
            const analysis = `📊 *Media Analysis*\n\n` +
                            `📁 Type: ${mediaType}\n` +
                            `📏 Size: ${fileSizeMB} MB\n` +
                            `📐 Dimensions: ${dimensions}\n` +
                            `🎯 Format: ${quotedMsg[`${mediaType.toLowerCase()}Message`]?.mimetype || 'Unknown'}\n` +
                            `📝 Caption: ${quotedMsg[`${mediaType.toLowerCase()}Message`]?.caption || 'None'}\n\n` +
                            `Ready for upload!`;
            
            await sock.sendMessage(m.from, { text: analysis }, { quoted: m });
            
        } catch (error) {
            console.error('Analysis Error:', error);
            await m.reply('❌ Failed to analyze media.');
        }
    }

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
        if (message.buttonsResponseMessage?.selectedButtonId) return null;
        if (message.listResponseMessage?.selectedRowId) return null;
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
