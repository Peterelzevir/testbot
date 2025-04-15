const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const crypto = require('crypto');

// Konfigurasi dasar
const BOT_TOKEN = '8068335875:AAG_9YM9tJIuHMqoEPDtK9J3RqEFctUV7_E'; // ⚠️ GANTI DENGAN TOKEN BOT KAMU
const ADMIN_ID = '5988451717';         // ⚠️ GANTI DENGAN ID TELEGRAM KAMU

// Direktori untuk penyimpanan data
const BASE_DIR = './data';
const ACCOUNTS_FILE = path.join(BASE_DIR, 'accounts.json');
const ADMINS_FILE = path.join(BASE_DIR, 'admins.json');

global.crypto = crypto;

// State Management
const userStates = new Map();
const activeConnections = new Map(); // Menyimpan koneksi aktif WhatsApp

// Inisialisasi direktori dan file
const initializeDirectories = () => {
    const dirs = [BASE_DIR, path.join(BASE_DIR, 'sessions'), path.join(BASE_DIR, 'temp')];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // Buat file accounts.json jika belum ada
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: [] }, null, 2));
    }

    // Buat file admins.json jika belum ada
    if (!fs.existsSync(ADMINS_FILE)) {
        fs.writeFileSync(ADMINS_FILE, JSON.stringify({ admins: [ADMIN_ID] }, null, 2));
    }
};

// Fungsi helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizePhoneNumber = (number) => {
    let num = number.replace(/\D/g, '');
    if (num.startsWith('0')) {
        num = '62' + num.substring(1);
    }
    return num;
};

const incrementGroupName = (pattern, currentNumber) => {
    const matches = pattern.match(/(\d+)$/);
    if (matches) {
        const lastNumber = matches[1];
        const paddedLength = lastNumber.length;
        const newNumber = (parseInt(lastNumber) + currentNumber).toString().padStart(paddedLength, '0');
        return pattern.replace(/\d+$/, newNumber);
    }
    return `${pattern} ${currentNumber}`;
};

// Fungsi account management
const getAccounts = () => {
    try {
        return JSON.parse(fs.readFileSync(ACCOUNTS_FILE)).accounts;
    } catch (error) {
        console.error('Error reading accounts file:', error);
        return [];
    }
};

const saveAccounts = (accounts) => {
    try {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving accounts file:', error);
        return false;
    }
};

const addAccount = (name) => {
    const accounts = getAccounts();
    const id = Date.now().toString();
    accounts.push({ id, name, createdAt: new Date().toISOString() });
    return saveAccounts(accounts) ? id : null;
};

const removeAccount = (accountId) => {
    const accounts = getAccounts();
    const newAccounts = accounts.filter(acc => acc.id !== accountId);
    if (newAccounts.length === accounts.length) return false;

    // Hapus folder sesi jika ada
    const sessionDir = path.join(BASE_DIR, 'sessions', accountId);
    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
            console.error('Error removing session directory:', error);
        }
    }

    return saveAccounts(newAccounts);
};

const getAccountById = (accountId) => {
    return getAccounts().find(acc => acc.id === accountId);
};

// Fungsi admin management
const getAdmins = () => {
    try {
        return JSON.parse(fs.readFileSync(ADMINS_FILE)).admins;
    } catch (error) {
        console.error('Error reading admins file:', error);
        return [ADMIN_ID];
    }
};

const saveAdmins = (admins) => {
    try {
        fs.writeFileSync(ADMINS_FILE, JSON.stringify({ admins }, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving admins file:', error);
        return false;
    }
};

const addAdmin = (adminId) => {
    const admins = getAdmins();
    if (admins.includes(adminId)) return false;
    admins.push(adminId);
    return saveAdmins(admins);
};

const removeAdmin = (adminId) => {
    // Jangan izinkan menghapus admin utama
    if (adminId === ADMIN_ID) return false;
    
    const admins = getAdmins();
    const newAdmins = admins.filter(id => id !== adminId);
    if (newAdmins.length === admins.length) return false;
    return saveAdmins(newAdmins);
};

const isAdmin = (userId) => {
    return getAdmins().includes(userId.toString());
};

// Koneksi ke WhatsApp
const connectToWhatsApp = async (ctx, accountId) => {
    try {
        const sessionDir = path.join(BASE_DIR, 'sessions', accountId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            // Tambahkan opsi tambahan untuk mengatasi masalah koneksi
            browser: ['WhatsApp Manager', 'Chrome', '10.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            defaultQueryTimeoutMs: 60000,
            retryRequestDelayMs: 1000
        });
        
        let messageId = null;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    const qrPath = path.join(BASE_DIR, 'temp', `qr_${accountId}.png`);
                    await qrcode.toFile(qrPath, qr, { scale: 8 });
                    
                    // Jika sudah ada pesan sebelumnya, edit pesan tersebut
                    if (messageId) {
                        try {
                            await ctx.telegram.editMessageMedia(
                                ctx.chat.id,
                                messageId,
                                null,
                                {
                                    type: 'photo',
                                    media: { source: qrPath },
                                    caption: '📱 *SCAN QR CODE INI*\n\n' +
                                            '1. Buka WhatsApp di HP\n' +
                                            '2. Ketuk Menu > WhatsApp Web\n' +
                                            '3. Scan QR code ini\n' +
                                            '4. Tunggu sampai terhubung'
                                },
                                {
                                    parse_mode: 'Markdown'
                                }
                            );
                        } catch (error) {
                            console.error('Gagal mengedit pesan QR:', error);
                            // Jika edit gagal, kirim pesan baru
                            const sentMsg = await ctx.replyWithPhoto(
                                { source: qrPath }, 
                                {
                                    caption: '📱 *SCAN QR CODE INI (Baru)*\n\n' +
                                            '1. Buka WhatsApp di HP\n' +
                                            '2. Ketuk Menu > WhatsApp Web\n' +
                                            '3. Scan QR code ini\n' +
                                            '4. Tunggu sampai terhubung',
                                    parse_mode: 'Markdown'
                                }
                            );
                            messageId = sentMsg.message_id;
                        }
                    } else {
                        // Kirim pesan QR code baru
                        const sentMsg = await ctx.replyWithPhoto(
                            { source: qrPath }, 
                            {
                                caption: '📱 *SCAN QR CODE INI*\n\n' +
                                        '1. Buka WhatsApp di HP\n' +
                                        '2. Ketuk Menu > WhatsApp Web\n' +
                                        '3. Scan QR code ini\n' +
                                        '4. Tunggu sampai terhubung',
                                parse_mode: 'Markdown'
                            }
                        );
                        messageId = sentMsg.message_id;
                    }
                } catch (err) {
                    console.error('Gagal mengirim QR:', err);
                    await ctx.reply('❌ Gagal menghasilkan QR code. Mencoba lagi...');
                }
            }
            
            if (connection === 'close') {
                // Deteksi alasan penutupan yang lebih detail
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`Koneksi terputus dengan status: ${statusCode}`);
                
                if (shouldReconnect) {
                    console.log('Mencoba reconnect WhatsApp...');
                    await ctx.reply(`⚠️ Koneksi WhatsApp terputus (kode: ${statusCode}). Mencoba menghubungkan kembali...`);
                    
                    // Hubungkan kembali dengan jeda
                    await delay(3000);
                    const newSock = await connectToWhatsApp(ctx, accountId);
                    activeConnections.set(accountId, newSock);
                } else {
                    console.log('Sesi logout atau expired');
                    await ctx.reply('❌ Sesi WhatsApp telah logout atau expired. Silakan hubungkan kembali.');
                    activeConnections.delete(accountId);
                }
            } else if (connection === 'open') {
                console.log('Terhubung ke WhatsApp');
                // Simpan info akun yang terhubung
                const accounts = getAccounts();
                const accountIndex = accounts.findIndex(acc => acc.id === accountId);
                if (accountIndex !== -1) {
                    accounts[accountIndex].connectedNumber = sock.user.id.split('@')[0];
                    accounts[accountIndex].connectedName = sock.user.name;
                    accounts[accountIndex].lastConnected = new Date().toISOString();
                    saveAccounts(accounts);
                }
                
                await ctx.reply(
                    `✅ WhatsApp berhasil terhubung\n` +
                    `Nama: ${sock.user.name}\n` +
                    `Nomor: ${sock.user.id.split('@')[0]}`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [Markup.button.callback('📋 Menu Utama', `menu_${accountId}`)]
                            ]
                        }
                    }
                );
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        return sock;
    } catch (error) {
        console.error('Koneksi WhatsApp gagal:', error);
        await ctx.reply(`❌ Koneksi gagal: ${error.message}`);
        return null;
    }
};

// Fungsi untuk mendapatkan daftar grup
const fetchGroups = async (waSocket) => {
    try {
        const groups = await waSocket.groupFetchAllParticipating();
        return Object.values(groups).sort((a, b) => {
            const numA = (a.subject.match(/\d+/) || [0])[0];
            const numB = (b.subject.match(/\d+/) || [0])[0];
            return parseInt(numA) - parseInt(numB);
        });
    } catch (error) {
        console.error('Gagal mengambil daftar grup:', error);
        return [];
    }
};

// Grup Operations
const renameGroups = async (ctx, waSocket, pattern) => {
    const loadingMsg = await ctx.reply('⏳ Memproses rename grup...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const results = [];
        
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const newName = incrementGroupName(pattern, i + 1);
            
            try {
                await waSocket.groupUpdateSubject(group.id, newName);
                results.push(`✅ ${group.subject} → ${newName}`);
                
                // Delay untuk menghindari rate limit
                await delay(2000);
            } catch (error) {
                results.push(`❌ ${group.subject}: ${error.message}`);
            }
        }
        
        const resultText = results.join('\n');
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Rename Grup Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⏭️ Lanjut', 'do_all_next_step')]
                ])
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error rename groups:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

const getGroupLinks = async (ctx, waSocket, accountId) => {
    const loadingMsg = await ctx.reply('⏳ Mengambil link grup...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const results = [];
        
        for (const group of groups) {
            try {
                const code = await waSocket.groupInviteCode(group.id);
                const link = `https://chat.whatsapp.com/${code}`;
                results.push(`*${group.subject}*\n${link}`);
                
                // Delay untuk menghindari rate limit
                await delay(1000);
            } catch (error) {
                results.push(`❌ *${group.subject}*: ${error.message}`);
            }
        }
        
        // Simpan link ke file untuk referensi
        const linkFile = path.join(BASE_DIR, 'temp', `links_${accountId}.txt`);
        fs.writeFileSync(linkFile, results.join('\n\n'));
        
        const resultText = results.join('\n\n');
        
        const buttonRow = userStates.get(ctx.from.id.toString())?.action === 'do_all' 
            ? [Markup.button.callback('⏭️ Lanjut', 'do_all_next_step')] 
            : [Markup.button.callback('📋 Menu', `menu_${accountId}`)];
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Link Grup*\n\n${resultText.substring(0, 4000)}${resultText.length > 4000 ? '\n\n(Terpotong, lihat file lengkap)' : ''}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([buttonRow])
            }
        );
        
        // Jika teks terlalu panjang, kirim sebagai file
        if (resultText.length > 4000) {
            await ctx.replyWithDocument({ 
                source: linkFile,
                filename: 'group_links.txt'
            });
        }
        
        return true;
    } catch (error) {
        console.error('Error get group links:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

const addGroupAdmins = async (ctx, waSocket, numbers, accountId) => {
    const loadingMsg = await ctx.reply('⏳ Menambahkan admin...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const formattedNumbers = numbers.map(normalizePhoneNumber);
        const results = [];
        
        for (const group of groups) {
            const groupResults = [];
            
            for (const num of formattedNumbers) {
                const whatsappId = `${num}@s.whatsapp.net`;
                
                try {
                    await waSocket.groupParticipantsUpdate(
                        group.id,
                        [whatsappId],
                        'promote'
                    );
                    
                    groupResults.push(`✅ ${num}`);
                    
                    // Delay untuk menghindari rate limit
                    await delay(2000);
                } catch (error) {
                    groupResults.push(`❌ ${num}: ${error.message}`);
                }
            }
            
            results.push(`*${group.subject}*:\n${groupResults.join('\n')}`);
        }
        
        const resultText = results.join('\n\n');
        
        const buttonRow = userStates.get(ctx.from.id.toString())?.action === 'do_all' 
            ? [Markup.button.callback('⏭️ Lanjut', 'do_all_next_step')] 
            : [Markup.button.callback('📋 Menu', `menu_${accountId}`)];
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Tambah Admin Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([buttonRow])
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error add admins:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

const applyGroupSettings = async (ctx, waSocket, accountId) => {
    const loadingMsg = await ctx.reply('⏳ Mengubah pengaturan grup...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const results = [];
        
        for (const group of groups) {
            try {
                // Matikan edit info
                await waSocket.groupSettingUpdate(group.id, 'locked');
                
                // Matikan pengumuman
                await waSocket.groupSettingUpdate(group.id, 'announcement');
                
                results.push(`✅ ${group.subject}`);
                
                // Delay untuk menghindari rate limit
                await delay(2000);
            } catch (error) {
                results.push(`❌ ${group.subject}: ${error.message}`);
            }
        }
        
        const resultText = results.join('\n');
        
        const buttonRow = userStates.get(ctx.from.id.toString())?.action === 'do_all' 
            ? [Markup.button.callback('✅ Selesai', `menu_${accountId}`)] 
            : [Markup.button.callback('📋 Menu', `menu_${accountId}`)];
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Pengaturan Grup Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([buttonRow])
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error apply group settings:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

// Fungsi untuk mengupdate deskripsi grup
const updateGroupDescription = async (ctx, waSocket, accountId, description) => {
    const loadingMsg = await ctx.reply('⏳ Mengupdate deskripsi grup...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const results = [];
        
        for (const group of groups) {
            try {
                await waSocket.groupUpdateDescription(group.id, description);
                results.push(`✅ ${group.subject}`);
                
                // Delay untuk menghindari rate limit
                await delay(2000);
            } catch (error) {
                results.push(`❌ ${group.subject}: ${error.message}`);
            }
        }
        
        const resultText = results.join('\n');
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Update Deskripsi Grup Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📋 Menu', `menu_${accountId}`)]
                ])
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error update group description:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

// Fungsi untuk mengirim pesan ke semua grup
const sendMessageToAllGroups = async (ctx, waSocket, accountId, message) => {
    const loadingMsg = await ctx.reply('⏳ Mengirim pesan ke semua grup...');
    
    try {
        const groups = await fetchGroups(waSocket);
        
        if (groups.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return false;
        }
        
        const results = [];
        
        for (const group of groups) {
            try {
                await waSocket.sendMessage(group.id, { text: message });
                results.push(`✅ ${group.subject}`);
                
                // Delay untuk menghindari rate limit
                await delay(3000);
            } catch (error) {
                results.push(`❌ ${group.subject}: ${error.message}`);
            }
        }
        
        const resultText = results.join('\n');
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Pesan Terkirim ke Semua Grup*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📋 Menu', `menu_${accountId}`)]
                ])
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error sending message to groups:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
        return false;
    }
};

// Setup Bot
const setupBot = () => {
    // Inisialisasi direktori dan file
    initializeDirectories();
    
    const bot = new Telegraf(BOT_TOKEN);
    
    // Middleware admin
    const adminOnly = (ctx, next) => {
        if (isAdmin(ctx.from.id)) {
            return next();
        }
        return ctx.reply('⛔ Kamu tidak diizinkan menggunakan bot ini.');
    };
    
    // Command start
    bot.start(adminOnly, async (ctx) => {
        await ctx.reply(
            '👋 *WhatsApp Manager Bot*\n\n' +
            'Versi Multi-Akun\n\n' +
            'Pilih aksi:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📱 Kelola Akun WhatsApp', 'manage_accounts')],
                    [Markup.button.callback('👮‍♂️ Kelola Admin Bot', 'manage_admins')]
                ])
            }
        );
    });
    
    // Menu kelola akun WhatsApp
    bot.action('manage_accounts', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accounts = getAccounts();
        const buttons = [];
        
        // Tampilkan daftar akun jika ada
        if (accounts.length > 0) {
            accounts.forEach(acc => {
                const status = activeConnections.has(acc.id) ? '🟢' : '🔴';
                buttons.push([Markup.button.callback(
                    `${status} ${acc.name} ${acc.connectedNumber ? `(${acc.connectedNumber})` : ''}`, 
                    `select_account_${acc.id}`
                )]);
            });
        }
        
        // Tombol untuk menambah dan hapus akun
        buttons.push([Markup.button.callback('➕ Tambah Akun Baru', 'add_account')]);
        if (accounts.length > 0) {
            buttons.push([Markup.button.callback('🗑️ Hapus Akun', 'remove_account')]);
        }
        
        await ctx.editMessageText(
            '📱 *Kelola Akun WhatsApp*\n\n' +
            (accounts.length > 0 ? 'Pilih akun yang ingin dikelola:' : 'Belum ada akun terdaftar.'),
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });
    
    // Proses tambah akun baru
    bot.action('add_account', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        userStates.set(ctx.from.id.toString(), { action: 'add_account' });
        
        await ctx.editMessageText(
            '➕ *Tambah Akun WhatsApp Baru*\n\n' +
            'Masukkan nama untuk akun baru:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'manage_accounts')]
                ])
            }
        );
    });
    
    // Proses hapus akun
    bot.action('remove_account', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accounts = getAccounts();
        const buttons = accounts.map(acc => {
            const status = activeConnections.has(acc.id) ? '🟢' : '🔴';
            return [Markup.button.callback(
                `${status} ${acc.name} ${acc.connectedNumber ? `(${acc.connectedNumber})` : ''}`, 
                `delete_account_${acc.id}`
            )];
        });
        
        buttons.push([Markup.button.callback('❌ Batal', 'manage_accounts')]);
        
        await ctx.editMessageText(
            '🗑️ *Hapus Akun WhatsApp*\n\n' +
            'Pilih akun yang ingin dihapus:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });
    
    // Konfirmasi hapus akun
    bot.action(/delete_account_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        await ctx.editMessageText(
            `🗑️ *Hapus Akun WhatsApp*\n\n` +
            `Anda yakin ingin menghapus akun "${account.name}"?\n\n` +
            `⚠️ Semua data sesi akan dihapus dan tidak dapat dikembalikan.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Ya, Hapus', `confirm_delete_${accountId}`)],
                    [Markup.button.callback('❌ Batal', 'manage_accounts')]
                ])
            }
        );
    });
    
    // Proses hapus akun setelah konfirmasi
    bot.action(/confirm_delete_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        // Hapus koneksi aktif jika ada
        if (activeConnections.has(accountId)) {
            activeConnections.delete(accountId);
        }
        
        const success = removeAccount(accountId);
        
        if (success) {
            await ctx.editMessageText(
                `✅ Akun "${account.name}" berhasil dihapus.`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                    ])
                }
            );
        } else {
            await ctx.editMessageText(
                `❌ Gagal menghapus akun "${account.name}".`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                    ])
                }
            );
        }
    });
    
    // Pilih akun untuk dikelola
    bot.action(/select_account_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        const isConnected = activeConnections.has(accountId);
        const buttons = [];
        
        if (isConnected) {
            buttons.push([Markup.button.callback('📋 Menu Utama', `menu_${accountId}`)]);
            buttons.push([Markup.button.callback('🔄 Reconnect', `connect_${accountId}`)]);
            buttons.push([Markup.button.callback('❌ Disconnect', `disconnect_${accountId}`)]);
        } else {
            buttons.push([Markup.button.callback('🔗 Hubungkan WhatsApp', `connect_${accountId}`)]);
        }
        
        buttons.push([Markup.button.callback('⬅️ Kembali', 'manage_accounts')]);
        
        await ctx.editMessageText(
            `📱 *Akun: ${account.name}*\n\n` +
            `Status: ${isConnected ? '🟢 Terhubung' : '🔴 Tidak terhubung'}\n` +
            (account.connectedNumber ? `Nomor: ${account.connectedNumber}\n` : '') +
            (account.connectedName ? `Nama: ${account.connectedName}\n` : '') +
            (account.lastConnected ? `Terakhir terhubung: ${new Date(account.lastConnected).toLocaleString('id-ID')}\n` : ''),
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });
    
    // Hubungkan WhatsApp
    bot.action(/connect_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        await ctx.editMessageText(
            `🔄 Menghubungkan ke WhatsApp untuk akun "${account.name}"...\n\n` +
            `Harap tunggu...`,
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Tutup koneksi sebelumnya jika ada
            if (activeConnections.has(accountId)) {
                activeConnections.delete(accountId);
            }
            
            const sock = await connectToWhatsApp(ctx, accountId);
            
            if (sock) {
                activeConnections.set(accountId, sock);
            }
        } catch (error) {
            console.error('Gagal menghubungkan WhatsApp:', error);
            await ctx.reply(`❌ Koneksi gagal: ${error.message}`);
        }
    });
    
    // Putuskan WhatsApp
    bot.action(/disconnect_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (activeConnections.has(accountId)) {
            activeConnections.delete(accountId);
            
            await ctx.editMessageText(
                `✅ Berhasil memutuskan koneksi WhatsApp untuk akun "${account.name}"`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                    ])
                }
            );
        } else {
            await ctx.editMessageText(
                `❌ Akun "${account.name}" tidak terhubung`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                    ])
                }
            );
        }
    });
    
    // Menu Utama
    bot.action(/menu_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.editMessageText(
                `❌ WhatsApp belum terhubung untuk akun "${account.name}"\n\n` +
                `Silakan hubungkan WhatsApp terlebih dahulu:`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔗 Hubungkan WhatsApp', `connect_${accountId}`)],
                        [Markup.button.callback('⬅️ Kembali ke Daftar Akun', 'manage_accounts')]
                    ])
                }
            );
            return;
        }
        
        await ctx.editMessageText(
            `📋 *Menu Utama - ${account.name}*\n\n` +
            `Pilih tindakan:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🚀 Lakukan Semua', `do_all_${accountId}`)],
                    [Markup.button.callback('📝 Rename Grup', `start_rename_${accountId}`)],
                    [Markup.button.callback('🔗 Ambil Link Grup', `start_get_links_${accountId}`)],
                    [Markup.button.callback('👮 Tambah Admin', `start_add_admins_${accountId}`)],
                    [Markup.button.callback('⚙️ Pengaturan Grup', `start_settings_${accountId}`)],
                    [Markup.button.callback('📱 Kembali ke Daftar Akun', 'manage_accounts')]
                ])
            }
        );
    });
    
    // Mulai Rename Grup
    bot.action(/start_rename_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        // Set state untuk rename
        userStates.set(ctx.from.id.toString(), { 
            action: 'rename_groups',
            accountId: accountId
        });
        
        await ctx.editMessageText(
            '📝 *Rename Grup*\n\n' +
            'Masukkan pola nama untuk grup:\n\n' +
            'Contoh:\n' +
            '• `DATA 1` → DATA 1, DATA 2, ...\n' +
            '• `DATA 001` → DATA 001, DATA 002, ...\n' +
            '• `Grup (1)` → Grup (1), Grup (2), ...',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                ])
            }
        );
    });
    
    // Mulai Ambil Link Grup
    bot.action(/start_get_links_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        await getGroupLinks(ctx, activeConnections.get(accountId), accountId);
    });
    
    // Mulai Tambah Admin
    bot.action(/start_add_admins_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        // Set state untuk tambah admin
        userStates.set(ctx.from.id.toString(), { 
            action: 'add_admins',
            accountId: accountId 
        });
        
        await ctx.editMessageText(
            '👮 *Tambah Admin Grup*\n\n' +
            'Kirim nomor telepon yang akan dijadikan admin:\n\n' +
            'Format:\n' +
            '• 08xxxxxxxxxx\n' +
            '• 628xxxxxxxxxx\n' +
            'Pisahkan dengan baris baru jika lebih dari satu.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                ])
            }
        );
    });
    
    // Mulai Update Deskripsi Grup
    bot.action(/start_update_desc_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        // Set state untuk update deskripsi
        userStates.set(ctx.from.id.toString(), { 
            action: 'update_description',
            accountId: accountId 
        });
        
        await ctx.editMessageText(
            '✏️ *Update Deskripsi Grup*\n\n' +
            'Masukkan deskripsi baru untuk semua grup:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                ])
            }
        );
    });
    
    // Mulai Kirim Pesan ke Semua Grup
    bot.action(/start_send_msg_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        // Set state untuk kirim pesan
        userStates.set(ctx.from.id.toString(), { 
            action: 'send_message',
            accountId: accountId 
        });
        
        await ctx.editMessageText(
            '💬 *Kirim Pesan ke Semua Grup*\n\n' +
            'Masukkan pesan yang akan dikirim ke semua grup:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                ])
            }
        );
    });
    
    // Mulai Pengaturan Grup
    bot.action(/start_settings_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        await applyGroupSettings(ctx, activeConnections.get(accountId), accountId);
    });
    
    // Lakukan Semua
    bot.action(/do_all_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const accountId = ctx.match[1];
        const account = getAccountById(accountId);
        
        if (!account) {
            await ctx.reply('❌ Akun tidak ditemukan');
            return;
        }
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply(`❌ WhatsApp belum terhubung untuk akun "${account.name}". Hubungkan terlebih dahulu.`);
            return;
        }
        
        // Set state untuk do_all
        userStates.set(ctx.from.id.toString(), { 
            action: 'do_all',
            step: 'rename',
            accountId: accountId
        });
        
        await ctx.editMessageText(
            `🚀 *Lakukan Semua Tindakan - ${account.name}*\n\n` +
            'Masukkan pola nama untuk rename grup:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                ])
            }
        );
    });
    
    // Menu Kelola Admin Bot
    bot.action('manage_admins', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        // Periksa apakah pengirimnya adalah admin utama
        if (ctx.from.id.toString() !== ADMIN_ID) {
            await ctx.editMessageText(
                '⛔ Hanya admin utama yang dapat mengelola admin bot.',
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⬅️ Kembali', 'start')]
                    ])
                }
            );
            return;
        }
        
        const admins = getAdmins();
        const buttons = [];
        
        buttons.push([Markup.button.callback('➕ Tambah Admin', 'add_bot_admin')]);
        
        if (admins.length > 1) {
            buttons.push([Markup.button.callback('🗑️ Hapus Admin', 'remove_bot_admin')]);
        }
        
        buttons.push([Markup.button.callback('⬅️ Kembali', 'start')]);
        
        await ctx.editMessageText(
            '👮‍♂️ *Kelola Admin Bot*\n\n' +
            'Admin saat ini:\n' +
            admins.map(id => `• ${id}${id === ADMIN_ID ? ' (Admin Utama)' : ''}`).join('\n') + '\n\n' +
            'Pilih tindakan:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });
    
    // Proses tambah admin bot
    bot.action('add_bot_admin', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        // Periksa apakah pengirimnya adalah admin utama
        if (ctx.from.id.toString() !== ADMIN_ID) {
            await ctx.reply('⛔ Hanya admin utama yang dapat menambahkan admin.');
            return;
        }
        
        userStates.set(ctx.from.id.toString(), { action: 'add_bot_admin' });
        
        await ctx.editMessageText(
            '➕ *Tambah Admin Bot*\n\n' +
            'Kirim ID Telegram pengguna yang ingin dijadikan admin:\n\n' +
            'Catatan: Pengguna harus memulai chat dengan bot terlebih dahulu.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'manage_admins')]
                ])
            }
        );
    });
    
    // Proses hapus admin bot
    bot.action('remove_bot_admin', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        // Periksa apakah pengirimnya adalah admin utama
        if (ctx.from.id.toString() !== ADMIN_ID) {
            await ctx.reply('⛔ Hanya admin utama yang dapat menghapus admin.');
            return;
        }
        
        const admins = getAdmins();
        const buttons = [];
        
        // Jangan tampilkan admin utama
        admins.forEach(id => {
            if (id !== ADMIN_ID) {
                buttons.push([Markup.button.callback(`🗑️ ${id}`, `remove_admin_${id}`)]);
            }
        });
        
        buttons.push([Markup.button.callback('❌ Batal', 'manage_admins')]);
        
        await ctx.editMessageText(
            '🗑️ *Hapus Admin Bot*\n\n' +
            'Pilih admin yang ingin dihapus:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });
    
    // Konfirmasi hapus admin bot
    bot.action(/remove_admin_(.+)/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        // Periksa apakah pengirimnya adalah admin utama
        if (ctx.from.id.toString() !== ADMIN_ID) {
            await ctx.reply('⛔ Hanya admin utama yang dapat menghapus admin.');
            return;
        }
        
        const adminId = ctx.match[1];
        
        const success = removeAdmin(adminId);
        
        if (success) {
            await ctx.editMessageText(
                `✅ Admin dengan ID "${adminId}" berhasil dihapus.`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('👮‍♂️ Kembali ke Kelola Admin', 'manage_admins')]
                    ])
                }
            );
        } else {
            await ctx.editMessageText(
                `❌ Gagal menghapus admin dengan ID "${adminId}".`,
                {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('👮‍♂️ Kembali ke Kelola Admin', 'manage_admins')]
                    ])
                }
            );
        }
    });
    
    // Handler tombol lanjut di do_all
    bot.action('do_all_next_step', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        const userId = ctx.from.id.toString();
        const userState = userStates.get(userId);
        
        if (!userState || userState.action !== 'do_all') {
            await ctx.reply('❌ Sesi telah berakhir atau tidak valid');
            return;
        }
        
        const accountId = userState.accountId;
        
        if (!activeConnections.has(accountId)) {
            await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
            userStates.delete(userId);
            return;
        }
        
        switch (userState.step) {
            case 'links':
                userState.step = 'admins';
                await ctx.editMessageText(
                    '👮 Selanjutnya: Tambah Admin\n\n' +
                    'Kirim nomor telepon yang akan dijadikan admin:',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('❌ Batal', `menu_${accountId}`)]
                        ])
                    }
                );
                break;
            
            case 'admins':
                userState.step = 'settings';
                await applyGroupSettings(ctx, activeConnections.get(accountId), accountId);
                userStates.delete(userId);
                break;
        }
    });
    
    // Handler untuk input teks
    bot.on('text', adminOnly, async (ctx) => {
        const userId = ctx.from.id.toString();
        const userState = userStates.get(userId);
        
        if (!userState) return;
        
        const input = ctx.message.text.trim();
        
        switch (userState.action) {
            case 'add_account': {
                // Proses tambah akun baru
                if (input.length < 3) {
                    await ctx.reply('❌ Nama akun terlalu pendek (minimal 3 karakter)');
                    return;
                }
                
                const newAccountId = addAccount(input);
                
                if (newAccountId) {
                    await ctx.reply(
                        `✅ Akun "${input}" berhasil ditambahkan!`,
                        {
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('🔗 Hubungkan WhatsApp', `connect_${newAccountId}`)],
                                [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                            ])
                        }
                    );
                    userStates.delete(userId);
                } else {
                    await ctx.reply(
                        '❌ Gagal menambahkan akun. Silakan coba lagi.',
                        {
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('📱 Kembali ke Kelola Akun', 'manage_accounts')]
                            ])
                        }
                    );
                }
                break;
            }
            
            case 'add_bot_admin': {
                // Proses tambah admin bot
                if (!/^\d+$/.test(input)) {
                    await ctx.reply('❌ ID Telegram harus berupa angka');
                    return;
                }
                
                const success = addAdmin(input);
                
                if (success) {
                    await ctx.reply(
                        `✅ Admin dengan ID "${input}" berhasil ditambahkan!`,
                        {
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('👮‍♂️ Kembali ke Kelola Admin', 'manage_admins')]
                            ])
                        }
                    );
                    userStates.delete(userId);
                } else {
                    await ctx.reply(
                        '❌ Gagal menambahkan admin. ID mungkin sudah terdaftar.',
                        {
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('👮‍♂️ Kembali ke Kelola Admin', 'manage_admins')]
                            ])
                        }
                    );
                }
                break;
            }
            
            case 'rename_groups': {
                // Proses rename
                const renameAccountId = userState.accountId;
                
                if (!activeConnections.has(renameAccountId)) {
                    await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                    userStates.delete(userId);
                    return;
                }
                
                const waSocket = activeConnections.get(renameAccountId);
                const renameSuccess = await renameGroups(ctx, waSocket, input);
                
                if (renameSuccess) {
                    userStates.delete(userId);
                }
                break;
            }
            
            case 'add_admins': {
                // Proses tambah admin
                const adminAccountId = userState.accountId;
                
                if (!activeConnections.has(adminAccountId)) {
                    await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                    userStates.delete(userId);
                    return;
                }
                
                const numbers = input.split(/[\s,\n]+/).filter(n => n.length > 0);
                
                if (numbers.length === 0) {
                    await ctx.reply('❌ Nomor telepon tidak valid');
                    return;
                }
                
                const adminSuccess = await addGroupAdmins(ctx, activeConnections.get(adminAccountId), numbers, adminAccountId);
                
                if (adminSuccess) {
                    userStates.delete(userId);
                }
                break;
            }
            
            case 'update_description': {
                // Proses update deskripsi
                const descAccountId = userState.accountId;
                
                if (!activeConnections.has(descAccountId)) {
                    await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                    userStates.delete(userId);
                    return;
                }
                
                const descSuccess = await updateGroupDescription(ctx, activeConnections.get(descAccountId), descAccountId, input);
                
                if (descSuccess) {
                    userStates.delete(userId);
                }
                break;
            }
            
            case 'send_message': {
                // Proses kirim pesan
                const msgAccountId = userState.accountId;
                
                if (!activeConnections.has(msgAccountId)) {
                    await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                    userStates.delete(userId);
                    return;
                }
                
                if (input.length === 0) {
                    await ctx.reply('❌ Pesan tidak boleh kosong');
                    return;
                }
                
                const msgSuccess = await sendMessageToAllGroups(ctx, activeConnections.get(msgAccountId), msgAccountId, input);
                
                if (msgSuccess) {
                    userStates.delete(userId);
                }
                break;
            }
            
            case 'do_all': {
                // Declare accountId once at the beginning of the case block
                const doAllAccountId = userState.accountId;
                
                if (userState.step === 'rename') {
                    // Proses rename di do_all
                    if (!activeConnections.has(doAllAccountId)) {
                        await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                        userStates.delete(userId);
                        return;
                    }
                    
                    const renameSuccess = await renameGroups(ctx, activeConnections.get(doAllAccountId), input);
                    
                    if (renameSuccess) {
                        // Update state ke step berikutnya
                        userState.step = 'links';
                        await ctx.reply(
                            '⏭️ Selanjutnya: Ambil Link Grup\n' +
                            'Proses otomatis akan dilanjutkan...'
                        );
                        await getGroupLinks(ctx, activeConnections.get(doAllAccountId), doAllAccountId);
                    }
                } else if (userState.step === 'admins') {
                    // Proses tambah admin di do_all
                    if (!activeConnections.has(doAllAccountId)) {
                        await ctx.reply('❌ WhatsApp telah terputus. Silakan hubungkan kembali.');
                        userStates.delete(userId);
                        return;
                    }
                    
                    const numbers = input.split(/[\s,\n]+/).filter(n => n.length > 0);
                    
                    if (numbers.length === 0) {
                        await ctx.reply('❌ Nomor telepon tidak valid');
                        return;
                    }
                    
                    const adminSuccess = await addGroupAdmins(ctx, activeConnections.get(doAllAccountId), numbers, doAllAccountId);
                    
                    if (adminSuccess) {
                        // Update state ke step berikutnya
                        userState.step = 'settings';
                        await ctx.reply(
                            '⏭️ Selanjutnya: Pengaturan Grup\n' +
                            'Proses otomatis akan dilanjutkan...'
                        );
                        await applyGroupSettings(ctx, activeConnections.get(doAllAccountId), doAllAccountId);
                        userStates.delete(userId);
                    }
                }
                break;
            }
        }
    });
    
    // Error handler
    bot.catch((err, ctx) => {
        console.error(`Error:`, err);
        ctx.reply(`❌ Terjadi kesalahan: ${err.message}`).catch(() => {});
    });
    
    // Jalankan bot
    bot.launch()
        .then(() => console.log('Bot WhatsApp Manager berhasil dimulai!'))
        .catch(err => console.error('Gagal memulai bot:', err));
    
    // Shutdown gracefully
    process.once('SIGINT', () => {
        console.log('Bot dihentikan (SIGINT)');
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        console.log('Bot dihentikan (SIGTERM)');
        bot.stop('SIGTERM');
    });
    
    return bot;
};

// Inisialisasi bot
const bot = setupBot();
