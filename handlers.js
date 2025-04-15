// handlers.js - Handler untuk bot Telegram

const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./database');
const wa = require('./whatsapp');
const utils = require('./utils');

// Handler functions
const handlers = {
    // Menu Utama
    showMainMenu: async (ctx) => {
        // Ambil semua session
        const sessions = wa.getAllSessions();
        const buttons = [];
        
        // Tambahkan button untuk setiap session
        if (sessions.length > 0) {
            for (const sessionId of sessions) {
                const status = wa.getStatus(sessionId);
                const emoji = status.connected ? '🟢' : '🔴';
                const label = status.connected ? 
                    `${emoji} ${sessionId} (${status.user.name})` : 
                    `${emoji} ${sessionId} (Tidak Terhubung)`;
                
                buttons.push([Markup.button.callback(label, `select_session_${sessionId}`)]);
            }
        }
        
        // Tambahkan button untuk tambah session baru dan kelola admin
        buttons.push([Markup.button.callback('➕ Tambah Session Baru', 'add_session')]);
        buttons.push([Markup.button.callback('👮‍♂️ Kelola Admin Bot', 'manage_admins')]);
        
        // Kirim menu
        await ctx.reply(
            '🤖 *Menu Utama*\n\n' + 
            'Silakan pilih session WhatsApp atau tambahkan session baru:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    },
    
    // Menu Kelola Session
    showSessionMenu: async (ctx, sessionId) => {
        const status = wa.getStatus(sessionId);
        
        if (!status.connected) {
            // Session tidak terhubung
            await ctx.reply(
                `⚠️ *Session ${sessionId} tidak terhubung ke WhatsApp*\n\n` +
                'Pilih tindakan:',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔄 Hubungkan Kembali', `reconnect_${sessionId}`)],
                        [Markup.button.callback('🗑️ Hapus Session', `delete_session_${sessionId}`)],
                        [Markup.button.callback('🔙 Kembali', 'main_menu')]
                    ])
                }
            );
            return;
        }
        
        // Session terhubung
        await ctx.reply(
            `🟢 *Session: ${sessionId}*\n` +
            `Nama: ${status.user.name}\n` +
            `Nomor: ${status.user.id.split('@')[0]}\n\n` +
            'Pilih tindakan:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📱 Kelola Grup WhatsApp', `manage_groups_${sessionId}`)],
                    [Markup.button.callback('🔄 Refresh Connection', `reconnect_${sessionId}`)],
                    [Markup.button.callback('🗑️ Hapus Session', `delete_session_${sessionId}`)],
                    [Markup.button.callback('🔙 Kembali', 'main_menu')]
                ])
            }
        );
    },
    
    // Menu Kelola Grup
    showGroupMenu: async (ctx, sessionId) => {
        await ctx.reply(
            `🏠 *Menu Kelola Grup*\n` +
            `Session: ${sessionId}\n\n` +
            'Pilih menu:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('1️⃣ Ganti Nama Grup', `rename_groups_${sessionId}`)],
                    [Markup.button.callback('2️⃣ Ambil Link Grup', `get_group_links_${sessionId}`)],
                    [Markup.button.callback('3️⃣ Tambah Admin Grup', `promote_admin_${sessionId}`)],
                    [Markup.button.callback('4️⃣ Pengaturan Grup', `change_settings_${sessionId}`)],
                    [Markup.button.callback('📲 Kelola Session Lain', 'main_menu')],
                    [Markup.button.callback('🔄 Mulai Semua Langkah', `start_all_steps_${sessionId}`)]
                ])
            }
        );
    },
    
    // Menu Kelola Admin
    showAdminMenu: async (ctx) => {
        // Tampilkan daftar admin
        const admins = db.getAdmins();
        let adminList = '👮‍♂️ *Daftar Admin Bot:*\n\n';
        
        for (const id of admins) {
            adminList += `• ${id}${id === config.MAIN_ADMIN_ID ? ' (Admin Utama)' : ''}\n`;
        }
        
        await ctx.reply(adminList, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ Tambah Admin', 'add_admin')],
                [Markup.button.callback('🗑️ Hapus Admin', 'remove_admin')],
                [Markup.button.callback('🔙 Kembali', 'main_menu')]
            ])
        });
    },
    
    // Handler tambah session baru
    handleAddSession: async (ctx) => {
        const userId = ctx.from.id.toString();
        
        // Simpan state
        db.setUserState(userId, { step: 'add_session_name' });
        
        await ctx.reply(
            '📝 *Tambah Session Baru*\n\n' +
            'Masukkan nama untuk session WhatsApp baru:\n' +
            '_(Gunakan nama yang mudah diingat, tanpa spasi)_',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Handler input nama session
    handleSessionNameInput: async (ctx) => {
        const userId = ctx.from.id.toString();
        const sessionId = ctx.message.text.trim();
        
        // Validasi nama session
        if (sessionId.includes(' ') || sessionId.length < 3) {
            await ctx.reply(
                '❌ *Nama tidak valid*\n\n' +
                'Nama session harus minimal 3 karakter dan tidak boleh mengandung spasi.\n' +
                'Silakan masukkan nama lain:',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Cek apakah session sudah ada
        const sessions = wa.getAllSessions();
        if (sessions.includes(sessionId)) {
            await ctx.reply(
                '❌ *Session sudah ada*\n\n' +
                'Session dengan nama tersebut sudah ada.\n' +
                'Silakan masukkan nama lain:',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Simpan state
        db.updateUserState(userId, { 
            step: 'connecting_whatsapp',
            sessionId
        });
        
        // Kirim pesan loading
        const loadingMsg = await ctx.reply(
            '⏳ *Memulai session WhatsApp*\n\n' +
            'Harap tunggu...',
            { parse_mode: 'Markdown' }
        );
        
        // Simpan message ID untuk update
        db.updateUserState(userId, { loadingMsgId: loadingMsg.message_id });
        
        // Set callback untuk QR code
        wa.setQRCallback(sessionId, async (qrPath) => {
            try {
                // Update pesan loading
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    '🔄 *Scan QR Code*\n\n' +
                    'Scan QR code ini dengan WhatsApp di HP Anda:',
                    { parse_mode: 'Markdown' }
                );
                
                // Kirim QR code
                await ctx.replyWithPhoto({ source: qrPath }, {
                    caption: '📱 *Petunjuk Scan:*\n\n' +
                            '1. Buka WhatsApp di HP Anda\n' +
                            '2. Ketuk Menu ⋮ atau Setelan ⚙️\n' +
                            '3. Pilih WhatsApp Web/Desktop\n' +
                            '4. Scan QR code ini\n\n' +
                            '🕒 QR code akan kedaluwarsa dalam 20 detik',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Batal', callback_data: 'cancel_operation' }]
                        ]
                    }
                });
                
                // Hapus file QR setelah tidak diperlukan
                setTimeout(() => {
                    utils.deleteFile(qrPath);
                }, 30000);
            } catch (error) {
                console.error('Error sending QR code:', error);
                
                // Fallback - jika gagal kirim gambar
                await ctx.reply(
                    '⚠️ *Error menampilkan QR code*\n\n' +
                    'Coba hubungkan lagi atau kontak developer.',
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 Coba Lagi', callback_data: `reconnect_${sessionId}` }],
                                [{ text: '❌ Batal', callback_data: 'cancel_operation' }]
                            ]
                        }
                    }
                );
            }
        });
        
        // Set callback untuk connect berhasil
        wa.setConnectCallback(sessionId, async (sock) => {
            try {
                const state = db.getUserState(userId);
                
                if (state.loadingMsgId) {
                    const status = wa.getStatus(sessionId);
                    
                    // Update pesan loading
                    if (status.connected) {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id,
                            state.loadingMsgId,
                            null,
                            '✅ *WhatsApp berhasil terhubung!*\n\n' +
                            `Nama: ${status.user.name}\n` +
                            `Nomor: ${status.user.id.split('@')[0]}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
                
                // Reset state
                db.clearUserState(userId);
                
                // Tampilkan menu kelola grup
                await handlers.showGroupMenu(ctx, sessionId);
            } catch (error) {
                console.error('Error handling connection success:', error);
            }
        });
        
        // Set callback untuk disconnect
        wa.setDisconnectCallback(sessionId, async () => {
            try {
                const state = db.getUserState(userId);
                
                if (state.loadingMsgId) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        state.loadingMsgId,
                        null,
                        '❌ *Koneksi terputus dari WhatsApp*\n\n' +
                        'Silakan coba hubungkan kembali.',
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🔄 Coba Lagi', callback_data: `reconnect_${sessionId}` }],
                                    [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                                ]
                            }
                        }
                    );
                }
                
                // Reset state
                db.clearUserState(userId);
            } catch (error) {
                console.error('Error handling disconnect:', error);
            }
        });
        
        // Mulai koneksi
        await wa.connect(sessionId);
    },
    
    // Handler rename grup
    handleRenameGroups: async (ctx, sessionId) => {
        const userId = ctx.from.id.toString();
        
        // Simpan state
        db.setUserState(userId, { 
            step: 'input_rename_pattern',
            sessionId
        });
        
        await ctx.reply(
            '📝 *Ganti Nama Grup*\n\n' +
            'Masukkan pola nama untuk grup:\n\n' +
            'Contoh format:\n' +
            '• `DATA 1` - akan membuat DATA 1, DATA 2, dll.\n' +
            '• `DATA 001` - akan membuat DATA 001, DATA 002, dll.\n' +
            '• `[WS]Activity (1001` - akan membuat [WS]Activity (1001, [WS]Activity (1002, dll.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Handler input pola rename
    handleRenamePatternInput: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        const pattern = ctx.message.text.trim();
        
        if (!state.sessionId) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Update state
        db.updateUserState(userId, { 
            pattern,
            step: 'confirm_rename'
        });
        
        await ctx.reply(
            '✅ *Konfirmasi Pola Rename*\n\n' +
            `Anda akan mengganti nama semua grup dengan pola:\n` +
            `\`${pattern}\`\n\n` +
            'Contoh hasil:\n' +
            getExampleNames(pattern),
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Lanjutkan', 'confirm_rename')],
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Proses rename grup
    processRenameGroups: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.pattern) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Kirim loading message
        const loadingMsg = await ctx.reply(
            '⏳ *Mengganti nama grup*\n\n' +
            'Harap tunggu, proses ini mungkin membutuhkan beberapa waktu...',
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Rename semua grup
            const result = await wa.renameAllGroups(state.sessionId, state.pattern);
            
            // Update pesan loading
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ *${result.message}*`,
                    { parse_mode: 'Markdown' }
                );
                
                // Buat rangkuman hasil
                let summary = '📋 *Hasil Rename Grup:*\n\n';
                
                for (const item of result.results) {
                    const status = item.success ? '✅' : '❌';
                    summary += `${status} \`${item.originalName}\` → \`${item.newName}\`\n`;
                }
                
                // Jika terlalu panjang, kirim sebagai file
                if (summary.length > 4000) {
                    const filePath = await utils.createTextFile(summary, 'rename_results.txt');
                    await ctx.replyWithDocument(
                        { source: filePath },
                        { 
                            caption: '📋 Hasil rename grup (terlalu panjang)',
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Link Grup', callback_data: `get_group_links_${state.sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                    
                    // Hapus file temp
                    utils.deleteFile(filePath);
                } else {
                    await ctx.reply(
                        summary,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Link Grup', callback_data: `get_group_links_${state.sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                }
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ *${result.message}*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Error renaming groups:', error);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ *Terjadi kesalahan:*\n\n${error.message}`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                        ]
                    }
                }
            );
        }
        
        // Reset state
        db.clearUserState(userId);
    },
    
    // Handler ambil link grup
    handleGetGroupLinks: async (ctx, sessionId) => {
        // Kirim loading message
        const loadingMsg = await ctx.reply(
            '⏳ *Mengambil link grup*\n\n' +
            'Harap tunggu, proses ini mungkin membutuhkan beberapa waktu...',
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Ambil link semua grup
            const result = await wa.getAllGroupLinks(sessionId);
            
            // Update pesan loading
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ *${result.message}*`,
                    { parse_mode: 'Markdown' }
                );
                
                // Buat rangkuman hasil
                let linkText = '🔗 *Link Grup:*\n\n';
                
                for (const item of result.results) {
                    if (item.link) {
                        linkText += `*${item.name}*\n${item.link}\n\n`;
                    } else {
                        linkText += `*${item.name}*\n❌ Error: ${item.error}\n\n`;
                    }
                }
                
                // Jika terlalu panjak, kirim sebagai file
                if (linkText.length > 4000 || result.results.length > 20) {
                    const filePath = await utils.createTextFile(linkText, 'group_links.txt');
                    await ctx.replyWithDocument(
                        { source: filePath },
                        { 
                            caption: '🔗 Link grup (terlalu banyak)',
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Tambah Admin', callback_data: `promote_admin_${sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                                ]
                            }
                        }
                    );
                    
                    // Hapus file temp
                    utils.deleteFile(filePath);
                } else {
                    await ctx.reply(
                        linkText,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Tambah Admin', callback_data: `promote_admin_${sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                                ]
                            }
                        }
                    );
                }
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ *${result.message}*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⏭️ Lanjut ke Tambah Admin', callback_data: `promote_admin_${sessionId}` }],
                                [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Error getting group links:', error);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ *Terjadi kesalahan:*\n\n${error.message}`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⏭️ Lanjut ke Tambah Admin', callback_data: `promote_admin_${sessionId}` }],
                            [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                        ]
                    }
                }
            );
        }
    },
    
    // Handler tambah admin grup
    handlePromoteAdmin: async (ctx, sessionId) => {
        const userId = ctx.from.id.toString();
        
        // Simpan state
        db.setUserState(userId, { 
            step: 'input_admin_numbers',
            sessionId,
            numbers: []
        });
        
        await ctx.reply(
            '📱 *Tambah Admin Grup*\n\n' +
            'Masukkan nomor telepon yang akan dijadikan admin di semua grup.\n\n' +
            'Format: 628123456789 atau 08123456789\n' +
            'Anda dapat memasukkan beberapa nomor, satu per baris.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Selesai', 'admin_numbers_done')],
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Handler input nomor admin
    handleAdminNumberInput: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.numbers) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Process nomor yang diinput
        const inputText = ctx.message.text.trim();
        const inputNumbers = inputText.split(/[\s,\n]+/); // Split berdasarkan spasi, koma, atau baris baru
        
        const validNumbers = [];
        const invalidNumbers = [];
        
        // Validasi setiap nomor
        for (const number of inputNumbers) {
            // Hapus karakter non-digit
            const cleanNumber = number.replace(/\D/g, '');
            
            // Validasi format nomor
            if (/^(0|62)\d{9,12}$/.test(cleanNumber)) {
                validNumbers.push(cleanNumber);
            } else {
                invalidNumbers.push(number);
            }
        }
        
        // Update state dengan nomor baru
        const numbers = [...state.numbers, ...validNumbers];
        db.updateUserState(userId, { numbers });
        
        // Buat pesan konfirmasi
        let message = '';
        
        if (validNumbers.length > 0) {
            message += `✅ *${validNumbers.length} nomor ditambahkan*\n`;
        }
        
        if (invalidNumbers.length > 0) {
            message += `❌ *${invalidNumbers.length} nomor tidak valid:*\n`;
            for (const number of invalidNumbers) {
                message += `- ${number}\n`;
            }
        }
        
        message += `\n*Total: ${numbers.length} nomor*\n\n`;
        message += 'Masukkan nomor lain atau tekan "✅ Selesai" jika sudah.';
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Selesai', 'admin_numbers_done')],
                [Markup.button.callback('❌ Batal', 'cancel_operation')]
            ])
        });
    },
    
    // Handler selesai input nomor admin
    handleAdminNumbersDone: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.numbers) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Cek jika tidak ada nomor yang diinput
        if (state.numbers.length === 0) {
            await ctx.reply(
                '⚠️ *Tidak ada nomor yang dimasukkan*\n\n' +
                'Silakan masukkan minimal satu nomor telepon.',
                { 
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('❌ Batal', 'cancel_operation')]
                    ])
                }
            );
            return;
        }
        
        // Update state
        db.updateUserState(userId, { step: 'confirm_promote' });
        
        // Buat konfirmasi
        let message = '📋 *Konfirmasi Nomor Admin*\n\n';
        message += 'Nomor-nomor berikut akan dijadikan admin di semua grup:\n\n';
        
        for (const number of state.numbers) {
            message += `📱 ${number}\n`;
        }
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Lanjutkan', 'confirm_promote')],
                [Markup.button.callback('❌ Batal', 'cancel_operation')]
            ])
        });
    },
    
    // Proses promote admin
    processPromoteAdmin: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.numbers || state.numbers.length === 0) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Kirim loading message
        const loadingMsg = await ctx.reply(
            '⏳ *Menambahkan admin di semua grup*\n\n' +
            'Harap tunggu, proses ini mungkin membutuhkan beberapa waktu...',
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Promote admin di semua grup
            const result = await wa.promoteToAdminAllGroups(state.sessionId, state.numbers);
            
            // Update pesan loading
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ *${result.message}*`,
                    { parse_mode: 'Markdown' }
                );
                
                // Buat rangkuman hasil
                let summary = '📋 *Hasil Tambah Admin:*\n\n';
                let successCount = 0;
                let failedCount = 0;
                
                for (const group of result.results) {
                    summary += `*Grup: ${group.groupName}*\n`;
                    
                    for (const item of group.results) {
                        const status = item.success ? '✅' : '❌';
                        summary += `${status} ${item.number}: ${item.success ? 'Berhasil' : item.message}\n`;
                        
                        if (item.success) successCount++;
                        else failedCount++;
                    }
                    
                    summary += '\n';
                }
                
                summary += `Total: ${successCount} berhasil, ${failedCount} gagal`;
                
                // Jika terlalu panjang, kirim sebagai file
                if (summary.length > 4000) {
                    const filePath = await utils.createTextFile(summary, 'admin_results.txt');
                    await ctx.replyWithDocument(
                        { source: filePath },
                        { 
                            caption: '📋 Hasil tambah admin (terlalu panjang)',
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Pengaturan Grup', callback_data: `change_settings_${state.sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                    
                    // Hapus file temp
                    utils.deleteFile(filePath);
                } else {
                    await ctx.reply(
                        summary,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Pengaturan Grup', callback_data: `change_settings_${state.sessionId}` }],
                                    [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                }
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ *${result.message}*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⏭️ Lanjut ke Pengaturan Grup', callback_data: `change_settings_${state.sessionId}` }],
                                [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Error promoting admins:', error);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ *Terjadi kesalahan:*\n\n${error.message}`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⏭️ Lanjut ke Pengaturan Grup', callback_data: `change_settings_${state.sessionId}` }],
                            [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                        ]
                    }
                }
            );
        }
        
        // Reset state
        db.clearUserState(userId);
    },
    
    // Handler pengaturan grup
    handleGroupSettings: async (ctx, sessionId) => {
        const userId = ctx.from.id.toString();
        
        // Default settings: seperti di gambar yang dikirim user
        const settings = {
            edit_group_info: false, // Off
            send_messages: true,    // On
        };
        
        // Simpan state
        db.setUserState(userId, { 
            step: 'confirm_settings',
            sessionId,
            settings
        });
        
        await ctx.reply(
            '⚙️ *Pengaturan Grup*\n\n' +
            'Pengaturan berikut akan diterapkan ke semua grup:\n\n' +
            `• Edit Pengaturan Grup: ${settings.edit_group_info ? 'ON ✅' : 'OFF ❌'}\n` +
            `• Kirim Pesan: ${settings.send_messages ? 'ON ✅' : 'OFF ❌'}\n\n` +
            'Anda dapat mengubah pengaturan dengan tombol toggle di bawah:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Toggle Edit Info', 'toggle_edit_info'),
                        Markup.button.callback('Toggle Kirim Pesan', 'toggle_send_messages')
                    ],
                    [Markup.button.callback('✅ Terapkan Pengaturan', 'confirm_settings')],
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Handler toggle pengaturan
    handleToggleSetting: async (ctx, setting) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.settings) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Toggle pengaturan
        const settings = { ...state.settings };
        settings[setting] = !settings[setting];
        
        // Update state
        db.updateUserState(userId, { settings });
        
        // Edit pesan dengan pengaturan baru
        await ctx.editMessageText(
            '⚙️ *Pengaturan Grup*\n\n' +
            'Pengaturan berikut akan diterapkan ke semua grup:\n\n' +
            `• Edit Pengaturan Grup: ${settings.edit_group_info ? 'ON ✅' : 'OFF ❌'}\n` +
            `• Kirim Pesan: ${settings.send_messages ? 'ON ✅' : 'OFF ❌'}\n\n` +
            'Anda dapat mengubah pengaturan dengan tombol toggle di bawah:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Toggle Edit Info', 'toggle_edit_info'),
                        Markup.button.callback('Toggle Kirim Pesan', 'toggle_send_messages')
                    ],
                    [Markup.button.callback('✅ Terapkan Pengaturan', 'confirm_settings')],
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Proses ubah pengaturan grup
    processChangeSettings: async (ctx) => {
        const userId = ctx.from.id.toString();
        const state = db.getUserState(userId);
        
        if (!state.sessionId || !state.settings) {
            await ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi dari awal.');
            db.clearUserState(userId);
            return;
        }
        
        // Kirim loading message
        const loadingMsg = await ctx.reply(
            '⏳ *Menerapkan pengaturan ke semua grup*\n\n' +
            'Harap tunggu, proses ini mungkin membutuhkan beberapa waktu...',
            { parse_mode: 'Markdown' }
        );
        
        try {
            // Ubah pengaturan di semua grup
            const result = await wa.changeAllGroupSettings(state.sessionId, state.settings);
            
            // Update pesan loading
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ *${result.message}*`,
                    { parse_mode: 'Markdown' }
                );
                
                // Buat rangkuman hasil
                let summary = '📋 *Hasil Pengaturan Grup:*\n\n';
                let successCount = 0;
                let failedCount = 0;
                
                for (const group of result.results) {
                    const status = group.success ? '✅' : '❌';
                    summary += `${status} ${group.groupName}\n`;
                    
                    // Detail pengaturan yang diterapkan
                    const settingsApplied = [];
                    if ('edit_group_info' in state.settings) {
                        settingsApplied.push(`Edit Info: ${state.settings.edit_group_info ? 'ON' : 'OFF'}`);
                    }
                    if ('send_messages' in state.settings) {
                        settingsApplied.push(`Kirim Pesan: ${state.settings.send_messages ? 'ON' : 'OFF'}`);
                    }
                    
                    summary += `   (${settingsApplied.join(', ')})\n`;
                    
                    if (group.success) successCount++;
                    else failedCount++;
                }
                
                summary += `\nTotal: ${successCount} berhasil, ${failedCount} gagal`;
                
                // Jika terlalu panjang, kirim sebagai file
                if (summary.length > 4000) {
                    const filePath = await utils.createTextFile(summary, 'settings_results.txt');
                    await ctx.replyWithDocument(
                        { source: filePath },
                        { 
                            caption: '📋 Hasil pengaturan grup (terlalu panjang)',
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✅ Selesai', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                    
                    // Hapus file temp
                    utils.deleteFile(filePath);
                } else {
                    await ctx.reply(
                        summary,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✅ Selesai', callback_data: `manage_groups_${state.sessionId}` }]
                                ]
                            }
                        }
                    );
                }
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ *${result.message}*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Error changing settings:', error);
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ *Terjadi kesalahan:*\n\n${error.message}`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali ke Menu', callback_data: `manage_groups_${state.sessionId}` }]
                        ]
                    }
                }
            );
        }
        
        // Reset state
        db.clearUserState(userId);
    },
    
    // Handler tambah admin bot
    handleAddBotAdmin: async (ctx) => {
        const userId = ctx.from.id.toString();
        
        // Simpan state
        db.setUserState(userId, { step: 'input_admin_id' });
        
        await ctx.reply(
            '👮‍♂️ *Tambah Admin Bot*\n\n' +
            'Masukkan ID Telegram user yang akan dijadikan admin bot:\n\n' +
            '_Catatan: User perlu memulai chat dengan bot terlebih dahulu agar ID-nya dapat digunakan._',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Batal', 'cancel_operation')]
                ])
            }
        );
    },
    
    // Handler input ID admin bot
    handleAdminIdInput: async (ctx) => {
        const userId = ctx.from.id.toString();
        const adminId = ctx.message.text.trim();
        
        // Validasi ID
        if (!/^\d+$/.test(adminId)) {
            await ctx.reply(
                '❌ *ID tidak valid*\n\n' +
                'ID Telegram harus berupa angka.\n' +
                'Silakan masukkan ID yang valid:',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Tambahkan admin
        const added = db.addAdmin(adminId);
        
        if (added) {
            await ctx.reply(
                `✅ *Berhasil menambahkan admin*\n\n` +
                `User dengan ID \`${adminId}\` telah dijadikan admin bot.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(
                `⚠️ *Admin sudah ada*\n\n` +
                `User dengan ID \`${adminId}\` sudah menjadi admin bot.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        // Reset state
        db.clearUserState(userId);
        
        // Tampilkan daftar admin
        await handlers.showAdminMenu(ctx);
    },
    
    // Handler hapus admin bot
    handleRemoveBotAdmin: async (ctx) => {
        // Ambil daftar admin
        const admins = db.getAdmins();
        const buttons = [];
        
        // Buat button untuk setiap admin (kecuali admin utama)
        for (const id of admins) {
            if (id !== config.MAIN_ADMIN_ID) {
                buttons.push([Markup.button.callback(`🗑️ ${id}`, `delete_admin_${id}`)]);
            }
        }
        
        buttons.push([Markup.button.callback('🔙 Kembali', 'manage_admins')]);
        
        await ctx.reply(
            '🗑️ *Hapus Admin Bot*\n\n' +
            'Pilih admin yang akan dihapus:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    },
    
    // Handler hapus admin tertentu
    handleDeleteAdmin: async (ctx, adminId) => {
        // Hapus admin
        const removed = db.removeAdmin(adminId);
        
        if (removed) {
            await ctx.reply(
                `✅ *Berhasil menghapus admin*\n\n` +
                `User dengan ID \`${adminId}\` telah dihapus dari daftar admin.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(
                `❌ *Gagal menghapus admin*\n\n` +
                `Admin utama tidak dapat dihapus.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        // Tampilkan daftar admin
        await handlers.showAdminMenu(ctx);
    },
    
    // Handler mulai semua langkah
    handleStartAllSteps: async (ctx, sessionId) => {
        await ctx.reply(
            '🚀 *Mulai Semua Langkah*\n\n' +
            'Proses ini akan menjalankan semua langkah secara berurutan:\n' +
            '1️⃣ Ganti Nama Grup\n' +
            '2️⃣ Ambil Link Grup\n' +
            '3️⃣ Tambah Admin Grup\n' +
            '4️⃣ Pengaturan Grup\n\n' +
            'Pilih tindakan:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Mulai', `rename_groups_${sessionId}`)],
                    [Markup.button.callback('❌ Batal', `manage_groups_${sessionId}`)]
                ])
            }
        );
    },
    
    // Handler hapus session
    handleDeleteSession: async (ctx, sessionId) => {
        await ctx.reply(
            `⚠️ *Konfirmasi Hapus Session*\n\n` +
            `Anda akan menghapus session WhatsApp: \`${sessionId}\`\n\n` +
            'Tindakan ini tidak dapat dibatalkan dan Anda perlu scan QR code lagi untuk menghubungkan ulang.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Ya, Hapus', `confirm_delete_${sessionId}`)],
                    [Markup.button.callback('❌ Tidak', 'main_menu')]
                ])
            }
        );
    },
    
    // Konfirmasi hapus session
    confirmDeleteSession: async (ctx, sessionId) => {
        // Hapus session
        const deleted = wa.deleteSession(sessionId);
        
        if (deleted) {
            await ctx.reply(
                `✅ *Session berhasil dihapus*\n\n` +
                `Session \`${sessionId}\` telah dihapus.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(
                `❌ *Gagal menghapus session*\n\n` +
                `Terjadi kesalahan saat menghapus session \`${sessionId}\`.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        // Tampilkan menu utama
        await handlers.showMainMenu(ctx);
    },
    
    // Handler untuk permintaan akses admin
    handleRequestAdmin: async (ctx) => {
        const userId = ctx.from.id.toString();
        const username = ctx.from.username ? `@${ctx.from.username}` : 'tidak ada username';
        const name = `${ctx.from.first_name} ${ctx.from.last_name || ''}`;
        
        // Kirim notifikasi ke admin utama
        try {
            await ctx.telegram.sendMessage(
                config.MAIN_ADMIN_ID,
                `🔔 *Permintaan Akses Admin*\n\n` +
                `User ID: \`${userId}\`\n` +
                `Username: ${username}\n` +
                `Nama: ${name}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                Markup.button.callback('✅ Terima', `accept_admin_${userId}`),
                                Markup.button.callback('❌ Tolak', `reject_admin_${userId}`)
                            ]
                        ]
                    }
                }
            );
            
            await ctx.reply(
                '✅ *Permintaan terkirim*\n\n' +
                'Permintaan akses admin telah dikirim ke admin utama.\n' +
                'Anda akan mendapatkan notifikasi jika permintaan disetujui.',
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error sending admin request:', error);
            
            await ctx.reply(
                '❌ *Gagal mengirim permintaan*\n\n' +
                'Terjadi kesalahan saat mengirim permintaan. Silakan coba lagi nanti.',
                { parse_mode: 'Markdown' }
            );
        }
    },
    
    // Handler terima permintaan admin
    handleAcceptAdmin: async (ctx, userId) => {
        // Tambahkan ke daftar admin
        const added = db.addAdmin(userId);
        
        if (added) {
            await ctx.reply(
                `✅ *Permintaan diterima*\n\n` +
                `User dengan ID \`${userId}\` telah ditambahkan sebagai admin bot.`,
                { parse_mode: 'Markdown' }
            );
            
            // Kirim notifikasi ke user
            try {
                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Selamat!*\n\n` +
                    `Permintaan akses admin Anda telah disetujui.\n` +
                    `Sekarang Anda dapat menggunakan WhatsApp Manager Bot.\n\n` +
                    `Kirim /start untuk memulai.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Error sending notification:', error);
                
                await ctx.reply(
                    `⚠️ *Berhasil menambahkan admin, tetapi gagal mengirim notifikasi*\n\n` +
                    `Error: ${error.message}`,
                    { parse_mode: 'Markdown' }
                );
            }
        } else {
            await ctx.reply(
                `⚠️ *User sudah menjadi admin*\n\n` +
                `User dengan ID \`${userId}\` sudah terdaftar sebagai admin bot.`,
                { parse_mode: 'Markdown' }
            );
        }
    },
    
    // Handler tolak permintaan admin
    handleRejectAdmin: async (ctx, userId) => {
        await ctx.reply(
            `✅ *Permintaan ditolak*\n\n` +
            `Permintaan akses admin dari user ID \`${userId}\` telah ditolak.`,
            { parse_mode: 'Markdown' }
        );
        
        // Kirim notifikasi ke user
        try {
            await ctx.telegram.sendMessage(
                userId,
                `❌ *Permintaan Ditolak*\n\n` +
                `Maaf, permintaan akses admin Anda telah ditolak oleh admin utama.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error sending notification:', error);
            
            await ctx.reply(
                `⚠️ *Berhasil menolak permintaan, tetapi gagal mengirim notifikasi*\n\n` +
                `Error: ${error.message}`,
                { parse_mode: 'Markdown' }
            );
        }
    },
    
    // Handler batal operasi
    handleCancelOperation: async (ctx) => {
        const userId = ctx.from.id.toString();
        
        // Ambil state untuk mendapatkan sessionId jika ada
        const state = db.getUserState(userId);
        const sessionId = state.sessionId;
        
        // Reset state
        db.clearUserState(userId);
        
        await ctx.reply(
            '❌ *Operasi dibatalkan*',
            { parse_mode: 'Markdown' }
        );
        
        // Kembali ke menu sebelumnya
        if (sessionId) {
            await handlers.showGroupMenu(ctx, sessionId);
        } else {
            await handlers.showMainMenu(ctx);
        }
    }
};

// Helper function untuk mendapatkan contoh nama grup
function getExampleNames(pattern) {
    let examples = '';
    
    // Cari pola angka
    const matches = pattern.match(/(\d+)/g);
    
    if (matches && matches.length > 0) {
        // Ambil angka terakhir
        const lastNumber = matches[matches.length - 1];
        const lastNumberPos = pattern.lastIndexOf(lastNumber);
        
        const prefix = pattern.substring(0, lastNumberPos);
        const suffix = pattern.substring(lastNumberPos + lastNumber.length);
        
        // Tentukan format padding
        const startNum = parseInt(lastNumber, 10);
        const digitPadding = lastNumber.startsWith('0') ? lastNumber.length : 0;
        
        // Tampilkan 3 contoh
        for (let i = 0; i < 3; i++) {
            const num = startNum + i;
            let numStr = num.toString();
            
            if (digitPadding > 0) {
                numStr = numStr.padStart(digitPadding, '0');
            }
            
            examples += `\`${prefix}${numStr}${suffix}\`\n`;
        }
    } else {
        // Jika tidak ada angka, tambahkan angka di akhir
        for (let i = 1; i <= 3; i++) {
            examples += `\`${pattern} ${i}\`\n`;
        }
    }
    
    return examples;
}

module.exports = handlers;