//  - File utama WhatsApp Manager Bot

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./database');
const handlers = require('./handlers');
const utils = require('./utils');

// Pastikan direktori penyimpanan sementara ada
if (!fs.existsSync(config.TEMP_DIR)) {
    fs.mkdirSync(config.TEMP_DIR, { recursive: true });
}

// Buat bot Telegram
const bot = new Telegraf(config.BOT_TOKEN);

// Middleware untuk cek admin
const adminMiddleware = async (ctx, next) => {
    const userId = ctx.from.id.toString();
    if (!db.isAdmin(userId)) {
        await ctx.reply('⛔ *Maaf, Anda tidak memiliki akses ke bot ini*', { parse_mode: 'Markdown' });
        return;
    }
    return next();
};

// ===== COMMAND HANDLERS =====

// Command /start - Memulai bot
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Cek apakah user adalah admin
    if (!db.isAdmin(userId)) {
        await ctx.reply(
            '👋 *Selamat datang di WhatsApp Manager Bot!*\n\n' +
            'Bot ini hanya dapat digunakan oleh admin yang ditunjuk.',
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👤 Minta Akses Admin', callback_data: 'request_admin' }]
                    ]
                }
            }
        );
        return;
    }
    
    // Reset user state
    db.clearUserState(userId);
    
    // Tampilkan menu utama untuk admin
    await ctx.reply(
        '👋 *Selamat datang di WhatsApp Manager Bot!*\n\n' +
        'Bot ini memungkinkan Anda mengelola grup WhatsApp dengan mudah.\n' +
        'Gunakan menu di bawah untuk memulai:',
        { parse_mode: 'Markdown' }
    );
    
    // Tampilkan menu utama
    await handlers.showMainMenu(ctx);
});

// Command /menu - Tampilkan menu utama
bot.command('menu', adminMiddleware, async (ctx) => {
    await handlers.showMainMenu(ctx);
});

// Command /help - Bantuan
bot.command('help', async (ctx) => {
    await ctx.reply(
        '📖 *Bantuan WhatsApp Manager Bot*\n\n' +
        'Bot ini memungkinkan Anda mengelola grup WhatsApp, termasuk:\n' +
        '• Mengganti nama grup secara massal\n' +
        '• Mengambil link invite grup\n' +
        '• Menambahkan admin grup secara massal\n' +
        '• Mengubah pengaturan grup\n\n' +
        'Perintah yang tersedia:\n' +
        '/start - Memulai bot\n' +
        '/menu - Tampilkan menu utama\n' +
        '/help - Tampilkan bantuan ini\n\n' +
        'Untuk memulai, kirim /start dan ikuti petunjuk yang diberikan.',
        { parse_mode: 'Markdown' }
    );
});

// ===== CALLBACK QUERY HANDLERS =====

// Main Menu
bot.action('main_menu', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.showMainMenu(ctx);
});

// Tambah Session Baru
bot.action('add_session', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleAddSession(ctx);
});

// Pilih Session
bot.action(/select_session_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.showSessionMenu(ctx, sessionId);
});

// Reconnect Session
bot.action(/reconnect_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Hapus session lama dan buat baru
    const userId = ctx.from.id.toString();
    
    // Set state seperti tambah session baru
    db.setUserState(userId, { 
        step: 'connecting_whatsapp',
        sessionId
    });
    
    // Kirim pesan loading
    const loadingMsg = await ctx.reply(
        '⏳ *Memulai ulang session WhatsApp*\n\n' +
        'Harap tunggu...',
        { parse_mode: 'Markdown' }
    );
    
    // Simpan message ID untuk update
    db.updateUserState(userId, { loadingMsgId: loadingMsg.message_id });
    
    // Delete dan reconnect session (handlers sama dengan tambah session baru)
    await ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
    await handlers.handleSessionNameInput({
        from: { id: userId },
        message: { text: sessionId },
        reply: ctx.reply.bind(ctx),
        telegram: ctx.telegram,
        deleteMessage: ctx.deleteMessage.bind(ctx),
        replyWithPhoto: ctx.replyWithPhoto.bind(ctx)
    });
});

// Hapus Session
bot.action(/delete_session_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleDeleteSession(ctx, sessionId);
});

// Konfirmasi Hapus Session
bot.action(/confirm_delete_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.confirmDeleteSession(ctx, sessionId);
});

// Kelola Grup
bot.action(/manage_groups_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.showGroupMenu(ctx, sessionId);
});

// Rename Grup
bot.action(/rename_groups_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleRenameGroups(ctx, sessionId);
});

// Konfirmasi Rename
bot.action('confirm_rename', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.processRenameGroups(ctx);
});

// Ambil Link Grup
bot.action(/get_group_links_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleGetGroupLinks(ctx, sessionId);
});

// Tambah Admin Grup
bot.action(/promote_admin_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handlePromoteAdmin(ctx, sessionId);
});

// Selesai Input Nomor Admin
bot.action('admin_numbers_done', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleAdminNumbersDone(ctx);
});

// Konfirmasi Promote Admin
bot.action('confirm_promote', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.processPromoteAdmin(ctx);
});

// Pengaturan Grup
bot.action(/change_settings_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleGroupSettings(ctx, sessionId);
});

// Toggle Edit Info Grup
bot.action('toggle_edit_info', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleToggleSetting(ctx, 'edit_group_info');
});

// Toggle Kirim Pesan
bot.action('toggle_send_messages', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleToggleSetting(ctx, 'send_messages');
});

// Konfirmasi Pengaturan
bot.action('confirm_settings', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.processChangeSettings(ctx);
});

// Mulai Semua Langkah
bot.action(/start_all_steps_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleStartAllSteps(ctx, sessionId);
});

// Kelola Admin Bot
bot.action('manage_admins', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.showAdminMenu(ctx);
});

// Tambah Admin Bot
bot.action('add_admin', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleAddBotAdmin(ctx);
});

// Hapus Admin Bot
bot.action('remove_admin', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleRemoveBotAdmin(ctx);
});

// Hapus Admin Tertentu
bot.action(/delete_admin_(.+)/, adminMiddleware, async (ctx) => {
    const adminId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleDeleteAdmin(ctx, adminId);
});

// Minta Akses Admin
bot.action('request_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleRequestAdmin(ctx);
});

// Terima Permintaan Admin
bot.action(/accept_admin_(.+)/, adminMiddleware, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleAcceptAdmin(ctx, userId);
});

// Tolak Permintaan Admin
bot.action(/reject_admin_(.+)/, adminMiddleware, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    await handlers.handleRejectAdmin(ctx, userId);
});

// Batal Operasi
bot.action('cancel_operation', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await handlers.handleCancelOperation(ctx);
});

// ===== MESSAGE HANDLERS =====

// Handler untuk input dari user (text)
bot.on('text', adminMiddleware, async (ctx) => {
    const userId = ctx.from.id.toString();
    const state = db.getUserState(userId);
    
    // Handle berdasarkan step
    switch (state.step) {
        case 'add_session_name':
            await handlers.handleSessionNameInput(ctx);
            break;
        
        case 'input_rename_pattern':
            await handlers.handleRenamePatternInput(ctx);
            break;
        
        case 'input_admin_numbers':
            await handlers.handleAdminNumberInput(ctx);
            break;
        
        case 'input_admin_id':
            await handlers.handleAdminIdInput(ctx);
            break;
        
        default:
            // Jika tidak ada state khusus
            await ctx.reply(
                '🤔 *Tidak mengerti perintah*\n\n' +
                'Silakan gunakan menu yang tersedia atau kirim /help untuk bantuan.',
                { parse_mode: 'Markdown' }
            );
    }
});

// ===== ERROR HANDLER =====

bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    
    // Kirim pesan error
    ctx.reply(
        '❌ *Terjadi kesalahan*\n\n' +
        'Maaf, terjadi kesalahan dalam menjalankan operasi.\n' +
        'Silakan coba lagi atau hubungi pengembang jika masalah berlanjut.',
        { parse_mode: 'Markdown' }
    ).catch((e) => console.error('Error sending error message:', e));
});

// ===== STARTUP =====

// Bersihkan direktori temp saat startup
utils.cleanDirectory(config.TEMP_DIR);

// Mulai bot
bot.launch()
    .then(() => {
        console.log('WhatsApp Manager Bot started');
        console.log(`Bot username: @${bot.botInfo.username}`);
    })
    .catch(err => {
        console.error('Error starting bot:', err);
    });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));