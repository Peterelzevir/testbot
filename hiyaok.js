// Bot Telegram untuk kelola WhatsApp (Versi Lengkap)
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

// State Management
const userStates = new Map();

// Buat direktori yang diperlukan
const createDirectories = () => {
    const dirs = ['./session', './temp'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
    });
};

// Simple delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Normalisasi nomor telepon
const normalizePhoneNumber = (number) => {
    let num = number.replace(/\D/g, '');
    if (num.startsWith('0')) {
        num = '62' + num.substring(1);
    }
    return num;
};

// Increment nama/angka grup
const incrementGroupName = (pattern, currentNumber) => {
    // Cari dan increment angka di akhir string
    const matches = pattern.match(/(\d+)$/);
    if (matches) {
        const lastNumber = matches[1];
        const paddedLength = lastNumber.length;
        const newNumber = (parseInt(lastNumber) + currentNumber).toString().padStart(paddedLength, '0');
        return pattern.replace(/\d+$/, newNumber);
    }
    
    // Jika tidak ada angka, tambahkan angka di akhir
    return `${pattern} ${currentNumber}`;
};

// Koneksi ke WhatsApp
const connectToWhatsApp = async (ctx) => {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' })
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    const qrPath = './temp/qr.png';
                    await qrcode.toFile(qrPath, qr, { scale: 8 });
                    
                    await ctx.replyWithPhoto(
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
                } catch (err) {
                    console.error('Gagal mengirim QR:', err);
                    await ctx.reply('❌ Gagal menghasilkan QR code');
                }
            }
            
            if (connection === 'close') {
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('Koneksi terputus, mencoba reconnect...');
                    await connectToWhatsApp(ctx);
                } else {
                    console.log('Logout');
                    await ctx.reply('❌ Sesi WhatsApp telah logout');
                }
            } else if (connection === 'open') {
                console.log('Terhubung ke WhatsApp');
                await ctx.reply(
                    `✅ WhatsApp terhubung\n` +
                    `Nama: ${sock.user.name}\n` +
                    `Nomor: ${sock.user.id.split('@')[0]}`
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

// Rename Grup
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

// Ambil Link Grup
const getGroupLinks = async (ctx, waSocket) => {
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
        
        const resultText = results.join('\n\n');
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Link Grup*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⏭️ Lanjut', 'do_all_next_step')]
                ])
            }
        );
        
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

// Tambah Admin Grup
const addGroupAdmins = async (ctx, waSocket, numbers) => {
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
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Tambah Admin Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⏭️ Lanjut', 'do_all_next_step')]
                ])
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

// Pengaturan Grup
const applyGroupSettings = async (ctx, waSocket) => {
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
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `✅ *Pengaturan Grup Selesai*\n\n${resultText}`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Selesai', 'show_menu')]
                ])
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

// Setup Bot
const setupBot = () => {
    createDirectories();
    
    const bot = new Telegraf(BOT_TOKEN);
    
    // Middleware admin
    const adminOnly = (ctx, next) => {
        if (ctx.from.id.toString() === ADMIN_ID) {
            return next();
        }
        return ctx.reply('⛔ Kamu tidak diizinkan menggunakan bot ini.');
    };
    
    // Variabel global
    let waSocket = null;
    
    // Command start
    bot.start(adminOnly, async (ctx) => {
        await ctx.reply(
            '👋 *WhatsApp Manager Bot*\n\n' +
            'Pilih aksi:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔗 Hubungkan WhatsApp', 'connect_whatsapp')],
                    [Markup.button.callback('📋 Menu Utama', 'show_menu')]
                ])
            }
        );
    });

    // Koneksi WhatsApp
    bot.action('connect_whatsapp', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        try {
            waSocket = await connectToWhatsApp(ctx);
            
            if (waSocket) {
                await ctx.editMessageText(
                    '✅ WhatsApp berhasil terhubung!\n\n' +
                    'Pilih tindakan selanjutnya:',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('🚀 Lakukan Semua', 'do_all')],
                            [Markup.button.callback('📝 Rename Grup', 'start_rename')],
                            [Markup.button.callback('🔗 Ambil Link Grup', 'start_get_links')],
                            [Markup.button.callback('👮 Tambah Admin', 'start_add_admins')],
                            [Markup.button.callback('⚙️ Pengaturan Grup', 'start_settings')]
                        ])
                    }
                );
            }
        } catch (error) {
            console.error('Gagal menghubungkan WhatsApp:', error);
            await ctx.reply(`❌ Koneksi gagal: ${error.message}`);
        }
    });

    // Menu Utama
    bot.action('show_menu', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.editMessageText(
                '❌ WhatsApp belum terhubung\n\n' +
                'Silakan hubungkan WhatsApp terlebih dahulu:',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔗 Hubungkan WhatsApp', 'connect_whatsapp')]
                    ])
                }
            );
            return;
        }
        
        await ctx.editMessageText(
            '📋 *Menu Utama*\n\n' +
            'Pilih tindakan:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🚀 Lakukan Semua', 'do_all')],
                    [Markup.button.callback('📝 Rename Grup', 'start_rename')],
                    [Markup.button.callback('🔗 Ambil Link Grup', 'start_get_links')],
                    [Markup.button.callback('👮 Tambah Admin', 'start_add_admins')],
                    [Markup.button.callback('⚙️ Pengaturan Grup', 'start_settings')]
                ])
            }
        );
    });

    // Mulai Rename Grup
    bot.action('start_rename', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.reply('❌ WhatsApp belum terhubung. Hubungkan terlebih dahulu.');
            return;
        }
        
        // Set state untuk rename
        userStates.set(ctx.from.id.toString(), { 
            action: 'rename_groups' 
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
                    [Markup.button.callback('❌ Batal', 'show_menu')]
                ])
            }
        );
    });

    // Mulai Ambil Link Grup
    bot.action('start_get_links', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.reply('❌ WhatsApp belum terhubung. Hubungkan terlebih dahulu.');
            return;
        }
        
        await getGroupLinks(ctx, waSocket);
    });

    // Mulai Tambah Admin
    bot.action('start_add_admins', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.reply('❌ WhatsApp belum terhubung. Hubungkan terlebih dahulu.');
            return;
        }
        
        // Set state untuk tambah admin
        userStates.set(ctx.from.id.toString(), { 
            action: 'add_admins' 
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
                    [Markup.button.callback('❌ Batal', 'show_menu')]
                ])
            }
        );
    });

    // Mulai Pengaturan Grup
    bot.action('start_settings', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.reply('❌ WhatsApp belum terhubung. Hubungkan terlebih dahulu.');
            return;
        }
        
        await applyGroupSettings(ctx, waSocket);
    });

    // Lakukan Semua
    bot.action('do_all', adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        
        if (!waSocket) {
            await ctx.reply('❌ WhatsApp belum terhubung. Hubungkan terlebih dahulu.');
            return;
        }
        
        // Set state untuk do_all
        userStates.set(ctx.from.id.toString(), { 
            action: 'do_all',
            step: 'rename'
        });
        
        await ctx.editMessageText(
            '🚀 *Lakukan Semua Tindakan*\n\n' +
            'Masukkan pola nama untuk rename grup:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'show_menu')]
                ])
            }
        );
    });

    // Handler untuk input teks
    bot.on('text', adminOnly, async (ctx) => {
        const userId = ctx.from.id.toString();
        const userState = userStates.get(userId);
        
        if (!userState) return;
        
        const input = ctx.message.text.trim();
        
        switch (userState.action) {
            case 'rename_groups':
                // Proses rename
                const renameSuccess = await renameGroups(ctx, waSocket, input);
                if (renameSuccess) {
                    userStates.delete(userId);
                }
                break;
            
            case 'add_admins':
                // Proses tambah admin
                const numbers = input.split(/[\s,\n]+/).filter(n => n.length > 0);
                const adminSuccess = await addGroupAdmins(ctx, waSocket, numbers);
                if (adminSuccess) {
                    userStates.delete(userId);
                }
                break;
            
            case 'do_all':
                if (userState.step === 'rename') {
                    // Proses rename di do_all
                    const renameSuccess = await renameGroups(ctx, waSocket, input);
                    if (renameSuccess) {
                        // Update state ke step berikutnya
                        userState.step = 'links';
                        await ctx.reply(
                            '⏭️ Selanjutnya: Ambil Link Grup\n' +
                            'Proses otomatis akan dilanjutkan...'
                        );
                        await getGroupLinks(ctx, waSocket);
                    }
                }
                break;
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
        
        switch (userState.step) {
            case 'links':
                userState.step = 'admins';
                await ctx.editMessageText(
                    '👮 Selanjutnya: Tambah Admin\n\n' +
                    'Kirim nomor telepon yang akan dijadikan admin:',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('❌ Batal', 'show_menu')]
                        ])
                    }
                );
                break;
            
            case 'admins':
                userState.step = 'settings';
                await applyGroupSettings(ctx, waSocket);
                break;
            
            case 'settings':
                await ctx.reply('✅ Semua proses selesai!');
                userStates.delete(userId);
                break;
        }
    });

    // Error handler
    bot.catch((err, ctx) => {
        console.error(`Error:`, err);
        ctx.reply(`❌ Terjadi kesalahan: ${err.message}`).catch(() => {});
    });

    // Jalankan bot
    bot.launch()
        .then(() => console.log('Bot berhasil dimulai!'))
        .catch(err => console.error('Gagal memulai bot:', err));

    // Shutdown grace
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    return bot;
};

// Inisialisasi bot
const bot = setupBot();
