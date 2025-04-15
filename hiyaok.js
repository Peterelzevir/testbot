// Bot Telegram untuk kelola WhatsApp (Versi Sederhana)
const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const crypto = require('crypto');

// Konfigurasi dasar
const BOT_TOKEN = '8068335875:AAG_9YM9tJIuHMqoEPDtK9J3RqEFctUV7_E'; // ⚠️ GANTI DENGAN TOKEN BOT KAMU
const ADMIN_ID = '5988451717';         // ⚠️ GANTI DENGAN ID TELEGRAM KAMU

global.crypto = crypto;

// Buat direktori yang diperlukan
if (!fs.existsSync('./session')) fs.mkdirSync('./session');
if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

// Buat bot Telegram
const bot = new Telegraf(BOT_TOKEN);

// Variable untuk menyimpan instance WhatsApp
let waSocket = null;
let qrSent = false;

// Koneksi ke WhatsApp
async function connectToWhatsApp(ctx) {
    try {
        // Buat auth state
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        
        // Buat socket WhatsApp
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' })
        });
        
        // Handle koneksi
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Jika dapat QR code
            if (qr && !qrSent) {
                qrSent = true;
                try {
                    // Buat gambar QR code
                    const qrPath = './temp/qr.png';
                    await qrcode.toFile(qrPath, qr, { scale: 8 });
                    
                    // Kirim QR code ke Telegram
                    await ctx.replyWithPhoto({ source: qrPath }, {
                        caption: '📱 *SCAN QR CODE INI*\n\n' +
                                '1. Buka WhatsApp di HP\n' +
                                '2. Ketuk Menu > WhatsApp Web\n' +
                                '3. Scan QR code ini\n' +
                                '4. Tunggu sampai terhubung',
                        parse_mode: 'Markdown'
                    });
                    
                    console.log('QR code dikirim ke Telegram');
                } catch (err) {
                    console.error('Gagal mengirim QR:', err);
                    await ctx.reply('❌ Gagal menghasilkan QR code, coba restart bot');
                }
            }
            
            // Jika koneksi berubah
            if (connection === 'close') {
                qrSent = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('Koneksi ditutup, mencoba menghubungkan ulang...');
                    await ctx.reply('🔄 Koneksi WhatsApp terputus, mencoba menghubungkan ulang...');
                    connectToWhatsApp(ctx);
                } else {
                    console.log('Koneksi ditutup (logout)');
                    await ctx.reply('❌ Sesi WhatsApp telah logout. Gunakan /start untuk menghubungkan kembali.');
                    waSocket = null;
                }
            } else if (connection === 'open') {
                console.log('Terhubung ke WhatsApp!');
                waSocket = sock;
                qrSent = false;
                
                // Kirim konfirmasi terhubung
                await ctx.reply(
                    '✅ *WhatsApp berhasil terhubung!*\n\n' +
                    `Nama: ${sock.user.name}\n` +
                    `Nomor: ${sock.user.id.split('@')[0]}\n\n` +
                    'Gunakan tombol di bawah untuk mengelola grup:',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('📝 Rename Grup', 'rename_groups')],
                            [Markup.button.callback('🔗 Ambil Link Grup', 'get_links')],
                            [Markup.button.callback('👮 Tambah Admin Grup', 'add_admins')],
                            [Markup.button.callback('⚙️ Pengaturan Grup', 'settings')],
                            [Markup.button.callback('🚀 Lakukan Semua', 'do_all')]
                        ])
                    }
                );
            }
        });
        
        // Save credentials
        sock.ev.on('creds.update', saveCreds);
        
        return sock;
    } catch (error) {
        console.error('Gagal menghubungkan ke WhatsApp:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
        return null;
    }
}

// Simple delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Middleware untuk cek admin
const adminOnly = (ctx, next) => {
    if (ctx.from.id.toString() === ADMIN_ID) {
        return next();
    }
    return ctx.reply('⛔ Kamu tidak diizinkan menggunakan bot ini.');
};

// Start command
bot.start(adminOnly, async (ctx) => {
    await ctx.reply(
        '👋 *Selamat datang di WhatsApp Manager Bot!*\n\n' +
        'Bot ini memungkinkan kamu mengelola grup WhatsApp dengan mudah.\n\n' +
        'Tekan tombol di bawah untuk mulai:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Hubungkan WhatsApp', 'connect_whatsapp')]
            ])
        }
    );
});

// Help command
bot.help(adminOnly, async (ctx) => {
    await ctx.reply(
        '📚 *Panduan Penggunaan Bot*\n\n' +
        '1. /start - Mulai bot\n' +
        '2. Tekan "Hubungkan WhatsApp" untuk scan QR\n' +
        '3. Gunakan tombol untuk mengelola grup\n\n' +
        'Fitur:\n' +
        '• Rename semua grup dengan pola berurutan\n' +
        '• Ambil link semua grup\n' +
        '• Tambah admin di semua grup\n' +
        '• Ubah pengaturan grup (edit info OFF, dll)',
        { parse_mode: 'Markdown' }
    );
});

// Connect WhatsApp button
bot.action('connect_whatsapp', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.reply('⏳ Memulai koneksi WhatsApp, tunggu sebentar...');
    
    // Reset QR status
    qrSent = false;
    
    // Connect to WhatsApp
    await connectToWhatsApp(ctx);
});

// Show menu button
bot.action('show_menu', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!waSocket || !waSocket.user) {
        await ctx.reply(
            '❌ *Tidak terhubung ke WhatsApp*\n\n' +
            'Kamu harus terhubung dulu untuk menggunakan fitur ini.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Hubungkan WhatsApp', 'connect_whatsapp')]
                ])
            }
        );
        return;
    }
    
    await ctx.reply(
        '📱 *Menu Utama*\n\n' +
        `WhatsApp terhubung: ${waSocket.user.name}\n` +
        'Pilih tindakan:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📝 Rename Grup', 'rename_groups')],
                [Markup.button.callback('🔗 Ambil Link Grup', 'get_links')],
                [Markup.button.callback('👮 Tambah Admin Grup', 'add_admins')],
                [Markup.button.callback('⚙️ Pengaturan Grup', 'settings')],
                [Markup.button.callback('🚀 Lakukan Semua', 'do_all')]
            ])
        }
    );
});

// Rename groups
bot.action('rename_groups', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!waSocket || !waSocket.user) {
        await ctx.reply('❌ Tidak terhubung ke WhatsApp. Gunakan /start untuk menghubungkan.');
        return;
    }
    
    // Set state untuk menunggu input pola rename
    ctx.scene = { waitingForRenamePattern: true };
    
    await ctx.reply(
        '📝 *Rename Grup*\n\n' +
        'Masukkan pola nama untuk grup:\n\n' +
        '*Contoh:*\n' +
        '• `DATA 1` → DATA 1, DATA 2, ...\n' +
        '• `DATA 001` → DATA 001, DATA 002, ...\n' +
        '• `[PU]Activity (1001` → [PU]Activity (1001, [PU]Activity (1002, ...',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Batal', 'show_menu')]
            ])
        }
    );
});

// Handle input rename pattern
bot.on('text', adminOnly, async (ctx) => {
    // Check if we're waiting for rename pattern
    if (ctx.scene && ctx.scene.waitingForRenamePattern) {
        const pattern = ctx.message.text.trim();
        
        // Reset state
        ctx.scene = null;
        
        // Get all groups
        const loadingMsg = await ctx.reply('⏳ Mengambil daftar grup...');
        
        try {
            // Fetch groups
            const groups = await waSocket.groupFetchAllParticipating();
            const groupsList = Object.values(groups);
            
            if (groupsList.length === 0) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    '❌ Tidak ada grup yang ditemukan.'
                );
                return;
            }
            
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `⏳ Mengganti nama ${groupsList.length} grup...`
            );
            
            // Sort groups by name
            const sortedGroups = [...groupsList].sort((a, b) => {
                const numA = (a.subject.match(/\d+/) || [0])[0];
                const numB = (b.subject.match(/\d+/) || [0])[0];
                return parseInt(numA) - parseInt(numB);
            });
            
            // Extract number from pattern
            const matches = pattern.match(/(\d+)/g);
            let currentNumber = 1;
            let numDigits = 0;
            
            if (matches && matches.length > 0) {
                // Get last number in pattern
                const lastNumber = matches[matches.length - 1];
                currentNumber = parseInt(lastNumber, 10);
                
                // Check if has leading zeros
                if (lastNumber.startsWith('0')) {
                    numDigits = lastNumber.length;
                }
            }
            
            // Results
            const results = [];
            let successCount = 0;
            
            // Rename each group
            for (const group of sortedGroups) {
                let newName = '';
                
                if (matches && matches.length > 0) {
                    // Replace last number with incremented one
                    const lastNumber = matches[matches.length - 1];
                    const lastIndex = pattern.lastIndexOf(lastNumber);
                    const prefix = pattern.substring(0, lastIndex);
                    const suffix = pattern.substring(lastIndex + lastNumber.length);
                    
                    // Format number with padding if needed
                    let formattedNumber = currentNumber.toString();
                    if (numDigits > 0) {
                        formattedNumber = formattedNumber.padStart(numDigits, '0');
                    }
                    
                    newName = prefix + formattedNumber + suffix;
                } else {
                    // No number in pattern, append number at end
                    newName = `${pattern} ${currentNumber}`;
                }
                
                try {
                    // Rename group
                    await waSocket.groupUpdateSubject(group.id, newName);
                    results.push(`✅ ${group.subject} → ${newName}`);
                    successCount++;
                    
                    // Update loading message periodically
                    if (results.length % 5 === 0) {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id, 
                            loadingMsg.message_id, 
                            null, 
                            `⏳ Mengganti nama grup: ${results.length}/${sortedGroups.length}...`
                        );
                    }
                    
                    // Add delay to avoid rate limits
                    await delay(3000);
                } catch (error) {
                    results.push(`❌ ${group.subject}: ${error.message}`);
                }
                
                // Increment number for next group
                currentNumber++;
            }
            
            // Final results
            const resultText = results.join('\n');
            
            if (resultText.length <= 4000) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    `✅ *Selesai mengganti nama grup*\n\n${successCount} dari ${sortedGroups.length} grup berhasil diubah\n\n${resultText}`,
                    { 
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('⏭️ Lanjut ke Link Grup', 'get_links')],
                            [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                        ])
                    }
                );
            } else {
                // Result too long, send as file
                const filePath = './temp/rename_results.txt';
                fs.writeFileSync(filePath, resultText);
                
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    `✅ *Selesai mengganti nama grup*\n\n${successCount} dari ${sortedGroups.length} grup berhasil diubah`
                );
                
                await ctx.replyWithDocument(
                    { source: filePath },
                    { 
                        caption: '📋 Hasil rename grup (file)',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('⏭️ Lanjut ke Link Grup', 'get_links')],
                            [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                        ])
                    }
                );
            }
            
        } catch (error) {
            console.error('Error renaming groups:', error);
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `❌ Error: ${error.message}`
            );
        }
    }
    // Handle other text inputs here if needed
});

// Get group links
bot.action('get_links', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!waSocket || !waSocket.user) {
        await ctx.reply('❌ Tidak terhubung ke WhatsApp. Gunakan /start untuk menghubungkan.');
        return;
    }
    
    const loadingMsg = await ctx.reply('⏳ Mengambil daftar grup...');
    
    try {
        // Fetch groups
        const groups = await waSocket.groupFetchAllParticipating();
        const groupsList = Object.values(groups);
        
        if (groupsList.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return;
        }
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `⏳ Mengambil link dari ${groupsList.length} grup...`
        );
        
        // Sort groups by name
        const sortedGroups = [...groupsList].sort((a, b) => {
            const numA = (a.subject.match(/\d+/) || [0])[0];
            const numB = (b.subject.match(/\d+/) || [0])[0];
            return parseInt(numA) - parseInt(numB);
        });
        
        // Results
        const results = [];
        let successCount = 0;
        
        // Get link for each group
        for (const group of sortedGroups) {
            try {
                // Get invite code
                const code = await waSocket.groupInviteCode(group.id);
                const link = `https://chat.whatsapp.com/${code}`;
                results.push(`*${group.subject}*\n${link}`);
                successCount++;
                
                // Update loading message periodically
                if (results.length % 5 === 0) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id, 
                        loadingMsg.message_id, 
                        null, 
                        `⏳ Mengambil link grup: ${results.length}/${sortedGroups.length}...`
                    );
                }
                
                // Add delay to avoid rate limits
                await delay(1000);
            } catch (error) {
                results.push(`❌ *${group.subject}*: ${error.message}`);
            }
        }
        
        // Final results
        const resultText = results.join('\n\n');
        
        if (resultText.length <= 4000) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `✅ *Link Grup*\n\n${successCount} dari ${sortedGroups.length} link berhasil diambil\n\n${resultText}`,
                { 
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⏭️ Lanjut ke Tambah Admin', 'add_admins')],
                        [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                    ])
                }
            );
        } else {
            // Result too long, send as file
            const filePath = './temp/group_links.txt';
            fs.writeFileSync(filePath, resultText);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `✅ *Link Grup*\n\n${successCount} dari ${sortedGroups.length} link berhasil diambil`
            );
            
            await ctx.replyWithDocument(
                { source: filePath },
                { 
                    caption: '🔗 Link grup (file)',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⏭️ Lanjut ke Tambah Admin', 'add_admins')],
                        [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                    ])
                }
            );
        }
        
    } catch (error) {
        console.error('Error getting group links:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
    }
});

// Add admins to groups
bot.action('add_admins', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!waSocket || !waSocket.user) {
        await ctx.reply('❌ Tidak terhubung ke WhatsApp. Gunakan /start untuk menghubungkan.');
        return;
    }
    
    // Set state for waiting admin numbers
    ctx.scene = { waitingForAdminNumbers: true };
    
    await ctx.reply(
        '👮 *Tambah Admin Grup*\n\n' +
        'Masukkan nomor telepon yang akan dijadikan admin di semua grup.\n\n' +
        '*Format:* 08xxxxxxxxxx atau 628xxxxxxxxxx\n' +
        'Untuk beberapa nomor, pisahkan dengan baris baru atau koma.',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Batal', 'show_menu')]
            ])
        }
    );
});

// Handle input admin numbers
bot.on('text', adminOnly, async (ctx) => {
    // Check if we're waiting for admin numbers
    if (ctx.scene && ctx.scene.waitingForAdminNumbers) {
        const input = ctx.message.text.trim();
        
        // Reset state
        ctx.scene = null;
        
        // Parse phone numbers
        const numbers = input.split(/[\s,\n]+/).filter(n => n.length > 0);
        
        if (numbers.length === 0) {
            await ctx.reply('❌ Tidak ada nomor yang valid.');
            return;
        }
        
        // Format numbers
        const formattedNumbers = numbers.map(n => {
            // Remove non-digits
            let num = n.replace(/\D/g, '');
            // Handle Indonesian format
            if (num.startsWith('0')) {
                num = '62' + num.substring(1);
            }
            return num;
        });
        
        const loadingMsg = await ctx.reply(
            `⏳ Menjadikan ${formattedNumbers.length} nomor sebagai admin di semua grup...`
        );
        
        try {
            // Fetch groups
            const groups = await waSocket.groupFetchAllParticipating();
            const groupsList = Object.values(groups);
            
            if (groupsList.length === 0) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    '❌ Tidak ada grup yang ditemukan.'
                );
                return;
            }
            
            // Results
            const results = [];
            
            // Process each group
            for (const group of groupsList) {
                const groupResult = {
                    name: group.subject,
                    results: []
                };
                
                // Get participants
                const participants = group.participants || [];
                
                // Process each number
                for (const num of formattedNumbers) {
                    try {
                        // Format for WhatsApp
                        const whatsappId = `${num}@s.whatsapp.net`;
                        
                        // Check if user is in group
                        const isInGroup = participants.some(p => p.id === whatsappId);
                        
                        if (!isInGroup) {
                            groupResult.results.push({
                                number: num,
                                success: false,
                                message: 'Nomor tidak ada dalam grup'
                            });
                            continue;
                        }
                        
                        // Promote to admin
                        await waSocket.groupParticipantsUpdate(
                            group.id,
                            [whatsappId],
                            'promote'
                        );
                        
                        groupResult.results.push({
                            number: num,
                            success: true,
                            message: 'Berhasil menjadi admin'
                        });
                        
                        // Delay to avoid rate limits
                        await delay(3000);
                    } catch (error) {
                        groupResult.results.push({
                            number: num,
                            success: false,
                            message: error.message
                        });
                    }
                }
                
                results.push(groupResult);
                
                // Update progress
                if (results.length % 3 === 0) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id, 
                        loadingMsg.message_id, 
                        null, 
                        `⏳ Memproses grup: ${results.length}/${groupsList.length}...`
                    );
                }
            }
            
            // Generate report
            let report = '📋 *Hasil Tambah Admin*\n\n';
            let totalSuccess = 0;
            let totalFailed = 0;
            
            for (const group of results) {
                report += `*${group.name}*\n`;
                
                for (const result of group.results) {
                    const icon = result.success ? '✅' : '❌';
                    report += `${icon} ${result.number}: ${result.message}\n`;
                    
                    if (result.success) totalSuccess++;
                    else totalFailed++;
                }
                
                report += '\n';
            }
            
            report += `Total: ${totalSuccess} berhasil, ${totalFailed} gagal`;
            
            if (report.length <= 4000) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    report,
                    { 
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('⏭️ Lanjut ke Pengaturan Grup', 'settings')],
                            [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                        ])
                    }
                );
            } else {
                // Report too long, send as file
                const filePath = './temp/admin_results.txt';
                fs.writeFileSync(filePath, report);
                
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    `✅ *Selesai menambahkan admin*\n\nTotal: ${totalSuccess} berhasil, ${totalFailed} gagal`
                );
                
                await ctx.replyWithDocument(
                    { source: filePath },
                    { 
                        caption: '👮 Hasil tambah admin (file)',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('⏭️ Lanjut ke Pengaturan Grup', 'settings')],
                            [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
                        ])
                    }
                );
            }
            
        } catch (error) {
            console.error('Error adding admins:', error);
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `❌ Error: ${error.message}`
            );
        }
    }
});

// Group settings
bot.action('settings', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!waSocket || !waSocket.user) {
        await ctx.reply('❌ Tidak terhubung ke WhatsApp. Gunakan /start untuk menghubungkan.');
        return;
    }
    
    await ctx.reply(
        '⚙️ *Pengaturan Grup*\n\n' +
        'Pilih pengaturan yang akan diterapkan ke semua grup:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Matikan Edit Info Grup', 'settings_edit_off')],
                [Markup.button.callback('✅ Default: Sesuai Gambar', 'settings_default')],
                [Markup.button.callback('🔙 Kembali ke Menu', 'show_menu')]
            ])
        }
    );
});

// Apply default settings (from screenshot)
bot.action('settings_default', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    const settings = {
        editInfo: false,     // OFF
        sendMessages: true   // ON
    };
    
    await applySettings(ctx, settings);
});

// Apply edit info OFF
bot.action('settings_edit_off', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    const settings = {
        editInfo: false
    };
    
    await applySettings(ctx, settings);
});

// Apply settings function
async function applySettings(ctx, settings) {
    const loadingMsg = await ctx.reply('⏳ Mengambil daftar grup...');
    
    try {
        // Fetch groups
        const groups = await waSocket.groupFetchAllParticipating();
        const groupsList = Object.values(groups);
        
        if (groupsList.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                '❌ Tidak ada grup yang ditemukan.'
            );
            return;
        }
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `⏳ Mengubah pengaturan ${groupsList.length} grup...`
        );
        
        // Results
        const results = [];
        let successCount = 0;
        
        // Apply settings to each group
        for (const group of groupsList) {
            try {
                // Edit group info setting
                if ('editInfo' in settings) {
                    await waSocket.groupSettingUpdate(
                        group.id,
                        settings.editInfo ? 'unlocked' : 'locked'
                    );
                }
                
                // Send messages setting
                if ('sendMessages' in settings) {
                    await waSocket.groupSettingUpdate(
                        group.id,
                        settings.sendMessages ? 'not_announcement' : 'announcement'
                    );
                }
                
                results.push(`✅ ${group.subject}`);
                successCount++;
                
                // Update progress
                if (results.length % 5 === 0) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id, 
                        loadingMsg.message_id, 
                        null, 
                        `⏳ Mengubah pengaturan: ${results.length}/${groupsList.length} grup...`
                    );
                }
                
                // Delay to avoid rate limits
                await delay(3000);
            } catch (error) {
                results.push(`❌ ${group.subject}: ${error.message}`);
            }
        }
        
        // Final result
        let settingsText = [];
        if ('editInfo' in settings) {
            settingsText.push(`Edit Info Grup: ${settings.editInfo ? 'ON ✅' : 'OFF ❌'}`);
        }
        if ('sendMessages' in settings) {
            settingsText.push(`Kirim Pesan: ${settings.sendMessages ? 'ON ✅' : 'OFF ❌'}`);
        }
        
        const settingsSummary = settingsText.join(', ');
        const resultText = results.join('\n');
        
        if (resultText.length <= 4000) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `✅ *Pengaturan Grup Berhasil Diubah*\n\n` +
                `Pengaturan: ${settingsSummary}\n\n` +
                `${successCount} dari ${groupsList.length} grup berhasil diubah\n\n${resultText}`,
                { 
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Selesai', 'show_menu')]
                    ])
                }
            );
        } else {
            // Result too long, send as file
            const filePath = './temp/settings_results.txt';
            fs.writeFileSync(filePath, resultText);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                null, 
                `✅ *Pengaturan Grup Berhasil Diubah*\n\n` +
                `Pengaturan: ${settingsSummary}\n\n` +
                `${successCount} dari ${groupsList.length} grup berhasil diubah`
            );
            
            await ctx.replyWithDocument(
                { source: filePath },
                { 
                    caption: '⚙️ Hasil pengaturan grup (file)',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Selesai', 'show_menu')]
                    ])
                }
            );
        }
        
    } catch (error) {
        console.error('Error applying settings:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            null, 
            `❌ Error: ${error.message}`
        );
    }
}

// Do all steps
bot.action('do_all', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.reply(
        '🚀 *Lakukan Semua Tindakan*\n\n' +
        'Ini akan menjalankan semua tindakan secara berurutan:\n' +
        '1. Rename Grup\n' +
        '2. Ambil Link Grup\n' +
        '3. Tambah Admin\n' +
        '4. Ubah Pengaturan\n\n' +
        'Mulai dari langkah mana?',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('1️⃣ Rename Grup', 'rename_groups')],
                [Markup.button.callback('2️⃣ Ambil Link', 'get_links')],
                [Markup.button.callback('3️⃣ Tambah Admin', 'add_admins')],
                [Markup.button.callback('4️⃣ Pengaturan', 'settings')],
                [Markup.button.callback('❌ Batal', 'show_menu')]
            ])
        }
    );
});

// Error handler
bot.catch((err, ctx) => {
    console.error(`Bot error:`, err);
    ctx.reply(`❌ Terjadi kesalahan: ${err.message}`).catch(e => {});
});

// Launch bot
bot.launch()
    .then(() => {
        console.log('Bot telah dimulai!');
    })
    .catch(err => {
        console.error('Gagal memulai bot:', err);
    });

// Handle graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
