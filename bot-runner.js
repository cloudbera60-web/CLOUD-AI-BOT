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
        this.activeUploads = new Map();
    }

    async start() {
        try {
            if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
                console.log(`⏳ Bot ${this.sessionId} is already ${this.connectionState}`);
                return this.socket;
            }
            
            this.connectionState = 'connecting';
            console.log(`🤖 Starting CLOUD AI bot for session: ${this.sessionId}`);
            
            // Load session from DB if exists
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

            // Initialize global active bots registry
            global.activeBots = global.activeBots || {};
            global.activeBots[this.sessionId] = {
                socket: this.socket,
                startedAt: this.startedAt,
                sessionId: this.sessionId,
                instance: this
            };

            this.setupEventHandlers();
            
            // Initialize plugins
            await this.initializePlugins();
            
            this.isRunning = true;
            this.reconnectAttempts = 0;
            
            console.log(`✅ CLOUD AI bot started successfully for session: ${this.sessionId}`);
            
            // Send welcome message to owner
            await this.sendWelcomeMessage().catch(console.error);
            
            return this.socket;
            
        } catch (error) {
            this.connectionState = 'error';
            console.error(`❌ Failed to start CLOUD AI bot for ${this.sessionId}:`, error.message);
            throw error;
        }
    }

    async initializePlugins() {
        try {
            await pluginLoader.loadPlugins();
            
            // Check essential plugins
            const essentialPlugins = ['menu', 'ping', 'owner'];
            const loadedPlugins = Array.from(pluginLoader.plugins.keys());
            
            console.log(`📦 Plugins loaded: ${loadedPlugins.length}`);
            console.log(`📋 Available plugins: ${loadedPlugins.join(', ')}`);
            
            // Verify essential plugins
            const missingPlugins = essentialPlugins.filter(p => !loadedPlugins.includes(p));
            if (missingPlugins.length > 0) {
                console.warn(`⚠️ Missing essential plugins: ${missingPlugins.join(', ')}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize plugins:', error);
        }
    }

    setupEventHandlers() {
        const { socket } = this;
        
        // Save credentials when updated
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

        // Handle connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                this.connectionState = 'connected';
                this.lastActivity = new Date();
                console.log(`✅ CLOUD AI bot ${this.sessionId} connected successfully!`);
                this.reconnectAttempts = 0;
                
                // Save session on successful connection
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

        // Handle incoming messages
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
                
                // Auto-reaction if enabled
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
                
            case 'musicSelection':
                const musicResults = userState.data?.results;
                const selection = parseInt(m.body.trim());
                
                if (musicResults && !isNaN(selection) && selection >= 1 && selection <= musicResults.length) {
                    const selectedVideo = musicResults[selection - 1];
                    
                    await m.reply(`🎵 Selected: ${selectedVideo.title}\n\nDownloading...`);
                    
                    const playPlugin = pluginLoader.plugins.get('play');
                    if (playPlugin && playPlugin.downloadAndSendAudio) {
                        await playPlugin.downloadAndSendAudio(m, sock, selectedVideo.videoId, 'high');
                    }
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
        if (normalizedId === 'btn_ping' || normalizedId === 'btn_core_ping') {
            await this.handlePingButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_status' || normalizedId === 'btn_system_status') {
            await this.handleStatusButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_plugins' || normalizedId === 'btn_core_plugins') {
            await this.handlePluginsButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu' || normalizedId === 'btn_core_menu') {
            await this.handleMenuButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_owner' || normalizedId === 'btn_core_owner') {
            await this.handleOwnerButton(m, sock);
            return;
        }
        
        // ==================== MENU CATEGORY BUTTONS ====================
        if (normalizedId === 'btn_menu_tools') {
            await this.handleToolsMenu(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu_media') {
            await this.handleMediaMenu(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu_group') {
            await this.handleGroupMenu(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu_fun') {
            await this.handleFunMenu(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu_owner') {
            await this.handleOwnerMenu(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_menu_back') {
            await this.handleBackButton(m, sock);
            return;
        }
        
        // ==================== LOGO BUTTONS ====================
        if (normalizedId === 'btn_logo_menu') {
            await this.handleLogoMenu(m, sock);
            return;
        }
        
        if (normalizedId.startsWith('btn_logo_select_')) {
            const style = normalizedId.replace('btn_logo_select_', '');
            await m.reply(`🎨 *Logo Style Selected:* ${style}\n\nNow type:\n\`\`\`.logo ${style} YOUR TEXT HERE\`\`\`\n\nExample:\n\`\`\`.logo ${style} CLOUD AI BOT\`\`\``);
            return;
        }
        
        // Logo category buttons
        const logoCategories = {
            'btn_logo_popular': ['blackpink', 'glow', 'naruto', 'hacker', 'luxury', 'avatar'],
            'btn_logo_water': ['water', 'water3d', 'underwater', 'wetglass', 'bulb'],
            'btn_logo_glow': ['glossysilver', 'gold', 'textlight', 'bokeh'],
            'btn_logo_creative': ['graffiti', 'paint', 'typography', 'rotation', 'digitalglitch'],
            'btn_logo_backgrounds': ['galaxy', 'blood', 'snow', 'thunder', 'sand', 'wall'],
            'btn_logo_special': ['birthdaycake', 'halloween', 'valentine', 'pubg', 'zodiac', 'team']
        };
        
        if (logoCategories[normalizedId]) {
            await this.handleLogoCategory(m, sock, normalizedId, logoCategories[normalizedId]);
            return;
        }
        
        // ==================== VCF BUTTONS ====================
        if (normalizedId === 'btn_vcf') {
            await this.handleVcfButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_vcf_all') {
            await this.handleVcfExport(m, sock, 'all');
            return;
        }
        
        if (normalizedId === 'btn_vcf_admins') {
            await this.handleVcfExport(m, sock, 'admins');
            return;
        }
        
        if (normalizedId === 'btn_vcf_custom') {
            await m.reply('⚙️ Custom VCF selection - Coming soon!\n\nUse: .vcf for group contact export');
            return;
        }
        
        if (normalizedId === 'btn_vcf_cancel') {
            await m.reply('✅ VCF export cancelled.');
            delete m.vcfData;
            return;
        }
        
        // ==================== TAGALL BUTTONS ====================
        if (normalizedId === 'btn_tagall') {
            await this.handleTagallButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_tag_all') {
            await this.handleTagMembers(m, sock, 'all');
            return;
        }
        
        if (normalizedId === 'btn_tag_admins') {
            await this.handleTagMembers(m, sock, 'admins');
            return;
        }
        
        if (normalizedId === 'btn_tag_regular') {
            await this.handleTagMembers(m, sock, 'regular');
            return;
        }
        
        if (normalizedId === 'btn_tag_custom') {
            await this.handleTagCustom(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_tag_cancel') {
            await m.reply('✅ Tag operation cancelled.');
            delete m.tagallData;
            return;
        }
        
        // ==================== URL/UPLOAD BUTTONS ====================
        if (normalizedId === 'btn_url') {
            await this.handleUrlButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_url_tmpfiles') {
            await this.handleMediaUpload(m, sock, 'tmpfiles');
            return;
        }
        
        if (normalizedId === 'btn_url_catbox') {
            await this.handleMediaUpload(m, sock, 'catbox');
            return;
        }
        
        if (normalizedId === 'btn_url_analysis') {
            await this.analyzeMedia(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_url_tutorial') {
            await m.reply(`📚 *Media Upload Tutorial*\n\n1. Reply to any media\n2. Type .url\n3. Select service\n4. Get shareable link\n\n📁 Max Size: 50MB\n🌐 Supported: Images, Videos, Audio, Documents`);
            return;
        }
        
        if (normalizedId === 'btn_url_cancel') {
            await m.reply('✅ Upload cancelled.');
            delete m.uploadData;
            return;
        }
        
        // ==================== MUSIC BUTTONS ====================
        if (normalizedId === 'btn_play') {
            await this.handlePlayButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_music_search') {
            await m.reply('🎵 *Music Search*\n\nType: `.play [song name or artist]`\n\nExamples:\n• .play drake\n• .play shape of you\n• .play afrobeat mix');
            return;
        }
        
        if (normalizedId === 'btn_music_pop') {
            await m.reply('🎤 *Popular Music*\n\nTry these searches:\n• .play taylor swift\n• .play ed sheeran\n• .play ariana grande\n• .play weekend\n• .play drake latest');
            return;
        }
        
        if (normalizedId === 'btn_music_hiphop') {
            await m.reply('🎧 *Hip Hop/Rap*\n\nTry these searches:\n• .play kendrick lamar\n• .play travis scott\n• .play kanye west\n• .play j cole\n• .play eminem');
            return;
        }
        
        if (normalizedId === 'btn_music_afro') {
            await m.reply('🌍 *Afro Beats*\n\nTry these searches:\n• .play burna boy\n• .play wizkid\n• .play davido\n• .play tems\n• .play afrobeats mix');
            return;
        }
        
        if (normalizedId === 'btn_music_help') {
            await m.reply(`🎵 *Music Player Help*\n\n🔍 How to use:\n• .play [song name] - Search and download\n• Click buttons for quick searches\n• Select quality when prompted\n\n⚡ Features:\n• YouTube music download\n• High quality audio\n• Fast processing`);
            return;
        }
        
        // Handle play download buttons
        if (normalizedId.startsWith('btn_play_download_')) {
            const parts = normalizedId.split('_');
            if (parts.length >= 5) {
                const videoId = parts[3];
                const quality = parts[4];
                await this.handleMusicDownload(m, sock, videoId, quality);
            }
            return;
        }
        
        // Handle play info buttons
        if (normalizedId.startsWith('btn_play_info_')) {
            const videoId = normalizedId.replace('btn_play_info_', '');
            await this.handleMusicInfo(m, sock, videoId);
            return;
        }
        
        if (normalizedId === 'btn_play_cancel') {
            await m.reply('✅ Music search cancelled.');
            delete m.playData;
            return;
        }
        
        // ==================== VIEW BUTTONS ====================
        if (normalizedId === 'btn_view') {
            await this.handleViewButton(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_view_download') {
            await this.handleViewDownload(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_view_info_full') {
            await this.handleViewInfo(m, sock);
            return;
        }
        
        if (normalizedId === 'btn_view_cancel') {
            await m.reply('✅ Media viewer closed.');
            delete m.mediaData;
            return;
        }
        
        // ==================== PRIVACY BUTTONS ====================
        if (normalizedId === 'btn_priv_visibility') {
            await this.showPrivacyOptions(m, sock, 'lastseen');
            return;
        }
        
        // ==================== OWNER BUTTONS ====================
        if (normalizedId === 'btn_autoreact_on') {
            await this.handleAutoReact(m, sock, true);
            return;
        }
        
        if (normalizedId === 'btn_autoreact_off') {
            await this.handleAutoReact(m, sock, false);
            return;
        }
        
        if (normalizedId === 'btn_mode_public') {
            await this.handleBotMode(m, sock, 'public');
            return;
        }
        
        if (normalizedId === 'btn_mode_private') {
            await this.handleBotMode(m, sock, 'private');
            return;
        }
        
        // ==================== DEFAULT ====================
        await m.reply(`❌ Button action "${buttonId}" not implemented yet.\n\nTry using commands instead:\n• .ping\n• .menu\n• .owner`);
    }

    // ==================== BUTTON HANDLER METHODS ====================
    
    async handlePingButton(m, sock) {
        const start = Date.now();
        await m.reply(`🏓 Pong!`);
        const latency = Date.now() - start;
        const wsPing = sock.ws?.ping || 'N/A';
        
        const status = `⚡ *CLOUD AI Performance Report*\n\n` +
                      `⏱️ Response Time: ${latency}ms\n` +
                      `📡 WebSocket Ping: ${wsPing}ms\n` +
                      `🆔 Session: ${this.sessionId}\n` +
                      `📊 Status: ${latency < 500 ? 'Optimal ⚡' : 'Normal 📈'}`;
        
        await sock.sendMessage(m.from, { text: status }, { quoted: m });
    }
    
    async handleStatusButton(m, sock) {
        const uptime = this.getUptime();
        const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const os = require('os');
        const totalMemory = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
        const freeMemory = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        
        const status = `📊 *CLOUD AI System Status*\n\n` +
                      `🆔 Session: ${this.sessionId}\n` +
                      `🔌 State: ${this.connectionState}\n` +
                      `⏱️ Uptime: ${uptime}\n` +
                      `🔄 Reconnects: ${this.reconnectAttempts}/${this.maxReconnectAttempts}\n` +
                      `📅 Last Activity: ${this.lastActivity.toLocaleTimeString()}\n` +
                      `💾 Memory: ${memoryUsage} MB\n` +
                      `💿 Total RAM: ${totalMemory} GB\n` +
                      `📦 Free RAM: ${freeMemory} GB\n` +
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
    }
    
    async handlePluginsButton(m, sock) {
        const plugins = Array.from(pluginLoader.plugins.keys());
        const pluginList = plugins.length > 0 
            ? plugins.map(p => `• .${p}`).join('\n')
            : 'No plugins loaded';
        await m.reply(`📦 *Loaded Plugins (${plugins.length})*\n\n${pluginList}`);
    }
    
    async handleMenuButton(m, sock) {
        const menuPlugin = pluginLoader.plugins.get('menu');
        if (menuPlugin) {
            m.body = '.menu';
            await menuPlugin(m, sock);
        } else {
            await m.reply('❌ Menu plugin not found.');
        }
    }
    
    async handleOwnerButton(m, sock) {
        const ownerPlugin = pluginLoader.plugins.get('owner');
        if (ownerPlugin) {
            m.body = '.owner';
            await ownerPlugin(m, sock);
        } else {
            await m.reply('❌ Owner plugin not found.');
        }
    }
    
    async handleToolsMenu(m, sock) {
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
    }
    
    async handleMediaMenu(m, sock) {
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
    }
    
    async handleGroupMenu(m, sock) {
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
    }
    
    async handleFunMenu(m, sock) {
        await sendButtons(sock, m.from, {
            title: '🎮 Fun Menu',
            text: `*Fun & Games:*\n\n• .logo - Logo generator\n• Sticker maker\n• Games\n• AI chat\n• Entertainment\n• Random tools`,
            footer: 'Entertainment features',
            buttons: [
                { id: 'btn_logo_menu', text: '🎨 Logo Maker' },
                { id: 'btn_menu_back', text: '🔙 Back' }
            ]
        });
    }
    
    async handleOwnerMenu(m, sock) {
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
    }
    
    async handleBackButton(m, sock) {
        const menuPlugin = pluginLoader.plugins.get('menu');
        if (menuPlugin) {
            m.body = '.menu';
            await menuPlugin(m, sock);
        } else {
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
    }
    
    async handleLogoMenu(m, sock) {
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
    }
    
    async handleLogoCategory(m, sock, categoryId, styles) {
        const categoryName = {
            'btn_logo_popular': 'Popular',
            'btn_logo_water': 'Water Effects',
            'btn_logo_glow': 'Glow Effects',
            'btn_logo_creative': 'Creative',
            'btn_logo_backgrounds': 'Backgrounds',
            'btn_logo_special': 'Special'
        }[categoryId];
        
        let buttons = styles.map(style => ({
            id: `btn_logo_select_${style}`,
            text: style.charAt(0).toUpperCase() + style.slice(1)
        }));
        
        // Add back button
        buttons.push({ id: 'btn_logo_menu', text: '🔙 Back' });
        
        // Limit to 6 buttons (WhatsApp limit)
        await sendButtons(sock, m.from, {
            title: `🎨 ${categoryName} Logos`,
            text: `*Select a style:*\n\nThen type:\n\`\`\`.logo [style] [your text]\`\`\`\n\nExample:\n.logo ${styles[0]} CLOUD AI`,
            footer: 'Click style, then type command',
            buttons: buttons.slice(0, 6)
        });
    }
    
    async handleVcfButton(m, sock) {
        if (!m.isGroup) {
            await m.reply('❌ VCF export only works in groups.');
            return;
        }
        
        const vcfPlugin = pluginLoader.plugins.get('vcf');
        if (vcfPlugin) {
            m.body = '.vcf';
            await vcfPlugin(m, sock);
        } else {
            await m.reply('❌ VCF plugin not found.');
        }
    }
    
    async handleVcfExport(m, sock, type) {
        if (!m.vcfData) {
            await m.reply('❌ Please run .vcf command first.');
            return;
        }
        
        const vcfPlugin = pluginLoader.plugins.get('vcf');
        if (vcfPlugin && vcfPlugin.exportVCF) {
            await vcfPlugin.exportVCF(m, sock, type, m.vcfData);
        } else {
            await m.reply('❌ VCF export function not available.');
        }
    }
    
    async handleTagallButton(m, sock) {
        if (!m.isGroup) {
            await m.reply('❌ Tagall only works in groups.');
            return;
        }
        
        const tagallPlugin = pluginLoader.plugins.get('tagall');
        if (tagallPlugin) {
            m.body = '.tagall';
            await tagallPlugin(m, sock);
        } else {
            await m.reply('❌ Tagall plugin not found.');
        }
    }
    
    async handleTagMembers(m, sock, type) {
        if (!m.tagallData) {
            await m.reply('❌ Please run .tagall command first.');
            return;
        }
        
        const tagallPlugin = pluginLoader.plugins.get('tagall');
        if (tagallPlugin && tagallPlugin.tagMembers) {
            await tagallPlugin.tagMembers(m, sock, type, m.tagallData);
        } else {
            await m.reply('❌ Tag function not available.');
        }
    }
    
    async handleTagCustom(m, sock) {
        if (!m.tagallData) {
            await m.reply('❌ Please run .tagall command first.');
            return;
        }
        
        await m.reply('✏️ Please type your custom message for tagging:');
        this.userStates.set(m.sender, {
            waitingFor: 'customTagMessage',
            data: { participants: m.tagallData.participants }
        });
    }
    
    async handleUrlButton(m, sock) {
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
        
        const urlPlugin = pluginLoader.plugins.get('url');
        if (urlPlugin) {
            m.body = '.url';
            await urlPlugin(m, sock);
        } else {
            await m.reply('❌ URL plugin not found.');
        }
    }
    
    async handleMediaUpload(m, sock, service) {
        if (!m.uploadData) {
            await m.reply('❌ Please reply to media first with .url');
            return;
        }
        
        const { quotedMsg } = m.uploadData;
        
        try {
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
        if (!m.uploadData) {
            await m.reply('❌ Please reply to media first with .url');
            return;
        }
        
        const { quotedMsg } = m.uploadData;
        
        try {
            await m.reply('📊 Analyzing media...');
            
            const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
            const fileSizeMB = (mediaBuffer.length / (1024 * 1024)).toFixed(2);
            
            let mediaType = 'Unknown';
            let dimensions = 'N/A';
            
            if (quotedMsg.message?.imageMessage) {
                mediaType = 'Image';
                dimensions = `${quotedMsg.message.imageMessage.width}x${quotedMsg.message.imageMessage.height}`;
            } else if (quotedMsg.message?.videoMessage) {
                mediaType = 'Video';
                dimensions = `${quotedMsg.message.videoMessage.width}x${quotedMsg.message.videoMessage.height}`;
            } else if (quotedMsg.message?.audioMessage) {
                mediaType = 'Audio';
                dimensions = `${quotedMsg.message.audioMessage.seconds}s`;
            } else if (quotedMsg.message?.documentMessage) {
                mediaType = 'Document';
                dimensions = quotedMsg.message.documentMessage.fileName || 'Unknown';
            }
            
            const analysis = `📊 *Media Analysis*\n\n` +
                            `📁 Type: ${mediaType}\n` +
                            `📏 Size: ${fileSizeMB} MB\n` +
                            `📐 Dimensions: ${dimensions}\n` +
                            `🎯 Format: ${quotedMsg.message?.[`${mediaType.toLowerCase()}Message`]?.mimetype || 'Unknown'}\n` +
                            `📝 Caption: ${quotedMsg.message?.[`${mediaType.toLowerCase()}Message`]?.caption || 'None'}\n\n` +
                            `Ready for upload!`;
            
            await sock.sendMessage(m.from, { text: analysis }, { quoted: m });
            
        } catch (error) {
            console.error('Analysis Error:', error);
            await m.reply('❌ Failed to analyze media.');
        }
    }
    
    async handlePlayButton(m, sock) {
        const playPlugin = pluginLoader.plugins.get('play');
        if (playPlugin) {
            m.body = '.play';
            await playPlugin(m, sock);
        } else {
            await m.reply('❌ Music player plugin not found.');
        }
    }
    
    async handleMusicDownload(m, sock, videoId, quality) {
        const playPlugin = pluginLoader.plugins.get('play');
        if (playPlugin && playPlugin.downloadAndSendAudio) {
            await playPlugin.downloadAndSendAudio(m, sock, videoId, quality);
        } else {
            await m.reply('❌ Music download function not available.');
        }
    }
    
    async handleMusicInfo(m, sock, videoId) {
        const playPlugin = pluginLoader.plugins.get('play');
        if (playPlugin && playPlugin.getVideoInfo) {
            await playPlugin.getVideoInfo(m, sock, videoId);
        } else {
            await m.reply('❌ Video info function not available.');
        }
    }
    
    async handleViewButton(m, sock) {
        const viewPlugin = pluginLoader.plugins.get('view');
        if (viewPlugin) {
            m.body = '.view';
            await viewPlugin(m, sock);
        } else {
            await m.reply('❌ View plugin not found.');
        }
    }
    
    async handleViewDownload(m, sock) {
        if (!m.mediaData) {
            await m.reply('❌ No media data found.');
            return;
        }
        
        const { buffer, type, fileSize } = m.mediaData;
        
        try {
            if (type === 'image') {
                await sock.sendMessage(m.from, {
                    image: buffer,
                    caption: `📷 Downloaded via CLOUD AI\nSize: ${fileSize} MB`
                }, { quoted: m });
            } else if (type === 'video') {
                await sock.sendMessage(m.from, {
                    video: buffer,
                    caption: `🎥 Downloaded via CLOUD AI\nSize: ${fileSize} MB`
                }, { quoted: m });
            } else if (type === 'audio') {
                await sock.sendMessage(m.from, {
                    audio: buffer,
                    mimetype: 'audio/mp4',
                    ptt: false
                }, { quoted: m });
            }
            await m.React('✅');
        } catch (error) {
            console.error('Download Error:', error);
            await m.reply('❌ Failed to download media.');
        }
    }
    
    async handleViewInfo(m, sock) {
        if (!m.mediaData) {
            await m.reply('❌ No media data found.');
            return;
        }
        
        const { type, quotedMsg, fileSize } = m.mediaData;
        let info = `📊 *Media Information*\n\n` +
                   `Type: ${type}\n` +
                   `Size: ${fileSize} MB\n`;
        
        if (type === 'image' && quotedMsg.message?.imageMessage) {
            info += `Dimensions: ${quotedMsg.message.imageMessage.width}x${quotedMsg.message.imageMessage.height}\n`;
            info += `Caption: ${quotedMsg.message.imageMessage.caption || 'None'}\n`;
        } else if (type === 'video' && quotedMsg.message?.videoMessage) {
            info += `Duration: ${quotedMsg.message.videoMessage.seconds}s\n`;
            info += `Dimensions: ${quotedMsg.message.videoMessage.width}x${quotedMsg.message.videoMessage.height}\n`;
            info += `Caption: ${quotedMsg.message.videoMessage.caption || 'None'}\n`;
        }
        
        await m.reply(info);
    }
    
    async showPrivacyOptions(m, sock, settingType) {
        const userId = m.sender.split('@')[0];
        const ownerNumbers = ['254116763755', '254743982206'];
        
        if (!ownerNumbers.includes(userId)) {
            await m.reply('🔒 Owner access required.');
            return;
        }
        
        const options = {
            lastseen: ['all', 'contacts', 'none'],
            profile: ['all', 'contacts', 'none'],
            status: ['all', 'contacts', 'none']
        };
        
        const labels = {
            all: '👁️ Everyone',
            contacts: '📱 Contacts',
            none: '🙈 Nobody'
        };
        
        const buttons = options[settingType].map(value => ({
            id: `btn_priv_set_${settingType}_${value}`,
            text: labels[value] || value
        }));
        
        buttons.push({ id: 'btn_menu_owner', text: '🔙 Back' });
        
        await sendButtons(sock, m.from, {
            title: `🔐 ${settingType.charAt(0).toUpperCase() + settingType.slice(1)} Privacy`,
            text: 'Select privacy level:',
            footer: 'CLOUD AI Privacy Manager',
            buttons: buttons
        });
    }
    
    async handleAutoReact(m, sock, enabled) {
        const userId = m.sender.split('@')[0];
        const ownerNumbers = ['254116763755', '254743982206'];
        
        if (!ownerNumbers.includes(userId)) {
            await m.reply('🔒 Owner access required.');
            return;
        }
        
        process.env.AUTO_REACT = enabled ? 'true' : 'false';
        await m.reply(`✅ Auto-reaction ${enabled ? 'turned ON' : 'turned OFF'}`);
    }
    
    async handleBotMode(m, sock, mode) {
        const userId = m.sender.split('@')[0];
        const ownerNumbers = ['254116763755', '254743982206'];
        
        if (!ownerNumbers.includes(userId)) {
            await m.reply('🔒 Owner access required.');
            return;
        }
        
        process.env.BOT_MODE = mode;
        await m.reply(`✅ Bot mode set to: ${mode.toUpperCase()}`);
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
        
        // ========== VIEW-ONCE MESSAGE HANDLING ==========
        if (m.message?.viewOnceMessageV2?.message) {
            m.message = m.message.viewOnceMessageV2.message;
            m.isViewOnce = true;
        } else if (m.message?.viewOnceMessage?.message) {
            m.message = m.message.viewOnceMessage.message;
            m.isViewOnce = true;
        }
        // ========== END VIEW-ONCE HANDLING ==========
        
        // Add reply method
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
        
        // Add react method
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
        this.activeUploads.clear();
        
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

// Initialize global active bots registry
global.activeBots = {};

module.exports = {
    BotRunner,
    startBotInstance,
    stopBotInstance,
    getActiveBots,
    initializeBotSystem
};
