const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const config = require('./config.json');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const { exec } = require('child_process');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel] // Required for DM channels and partial messages
});

// =====================
// Configuration
// =====================
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB Discord upload limit
const DOWNLOAD_YOUTUBE = true; // Toggle YouTube downloads on/off
const SHORT_VIDEO_THRESHOLD = 30; // Duration in seconds (30 seconds) to consider a video "short"
const DELETE_ORIGINAL_MESSAGE = true; //Should it replace the person's message

// =====================
// Utility to run shell commands (ffmpeg/ffprobe)
// =====================
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) reject(stderr || err);
            else resolve(stdout);
        });
    });
}

// =====================
// Fetch video metadata
// =====================
async function getVideoInfo(url) {
    return ytDlp(url, { dumpSingleJson: true, noWarnings: true });
}

// =====================
// Compress longer videos based on duration
// =====================
async function compressLongVideo(inputPath) {
    // Get video duration using ffprobe
    const durationOutput = await runCommand(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
    const duration = parseFloat(durationOutput.trim());
    if (!duration || duration <= 0) throw new Error('Could not determine video duration');

    // Initialize compression parameters
    let resolution = null; // Set resolution only for longer videos
    let fps = null;
    let audioBitrate;

    // Set resolution, frame rate, and audio bitrate based on video length
    if (duration > 240) { resolution = 144; fps = 15; audioBitrate = 32000; }
    else if (duration > 180) { resolution = 240; fps = 24; audioBitrate = 64000; }
    else if (duration > 120) { resolution = 480; fps = 30; audioBitrate = 96000; }
    else if (duration > 60) { resolution = 720; fps = 30; audioBitrate = 128000; }
    else { audioBitrate = 128000; } // Short videos: keep original resolution

    // Calculate maximum video bitrate to stay under ~7.8MB
    const targetSize = 7.8 * 1024 * 1024; // bytes
    const totalBitrate = Math.floor((targetSize * 8) / duration); // bits per second
    const videoBitrate = Math.max(totalBitrate - audioBitrate, 100000); // minimum 100kbps
    const videoBitrateK = Math.floor(videoBitrate / 1000); // kbps for ffmpeg

    const outputPath = inputPath.replace('.mp4', '_compressed.mp4');

    // Construct ffmpeg command for compression
    let ffmpegCmd;
    if (resolution) {
        // Scale video and adjust fps for long videos
        ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf "scale=-2:${resolution}" -r ${fps} -b:v ${videoBitrateK}k -bufsize ${videoBitrateK}k -maxrate ${videoBitrateK}k -c:a aac -b:a ${audioBitrate} "${outputPath}"`;
    } else {
        // Short videos: just adjust bitrate, keep resolution
        ffmpegCmd = `ffmpeg -y -i "${inputPath}" -b:v ${videoBitrateK}k -bufsize ${videoBitrateK}k -maxrate ${videoBitrateK}k -c:a aac -b:a ${audioBitrate} "${outputPath}"`;
    }

    await runCommand(ffmpegCmd);

    // Ensure compressed file exists
    if (!fs.existsSync(outputPath)) throw new Error('Compression failed');

    // Delete original uncompressed file
    fs.unlinkSync(inputPath);

    return outputPath;
}

// =====================
// YouTube download logic
// =====================
async function downloadYouTube(videoUrl, outputPath) {
    if (!DOWNLOAD_YOUTUBE) throw new Error('YouTube downloads are disabled');

    const info = await getVideoInfo(videoUrl);
    const duration = info.duration || 0;

    // Decide whether to download highest quality or limit to 360p
    let format = duration <= SHORT_VIDEO_THRESHOLD
        ? 'bestvideo+bestaudio/best' // Shorts/high-quality
        : 'bestvideo[height<=360]+bestaudio/best[height<=360]'; // Longer videos

    await ytDlp(videoUrl, { format, mergeOutputFormat: 'mp4', output: outputPath, noWarnings: true });

    if (!fs.existsSync(outputPath)) throw new Error('Failed to download video');

    // If video is still too big, compress it
    const stats = fs.statSync(outputPath);
    if (stats.size > MAX_FILE_SIZE) {
        return compressLongVideo(outputPath);
    }

    return outputPath;
}

// =====================
// TikTok download logic
// =====================
async function downloadTikTok(videoUrl, outputPath) {
    const info = await getVideoInfo(videoUrl);
    const fmt = info.formats.find(f => f.ext === 'mp4' && f.vcodec !== 'none');
    if (!fmt) throw new Error('No valid TikTok MP4 format');

    await ytDlp(videoUrl, { format: fmt.format_id, output: outputPath });
    if (!fs.existsSync(outputPath)) throw new Error('Failed to download TikTok');

    return outputPath;
}

// =====================
// Message handler
// =====================
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.partial) {
        try { await message.fetch(); } catch { return; }
    }

    // Handle DMs
    if (message.channel.type === 1) {
        if (config.allowedUsers.includes(message.author.id) && message.content.toLowerCase() === 'ping') {
            await message.author.send('Pong!');
        } else await message.author.send('go away');
        return;
    }

    // Match YouTube/TikTok URLs
    const ytMatch = message.content.match(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/\S+/gi);
    const ttMatch = message.content.match(/(https?:\/\/)?(www\.)?(tiktok\.com)\/\S+/gi);

    if (!ytMatch && !ttMatch) return;

    const videoUrl = ttMatch ? ttMatch[0] : ytMatch[0];
    const isTikTok = !!ttMatch;
    const outputFile = `video-${Date.now()}.mp4`;
    const outputPath = config.outputPath + outputFile;

    // Notify user that download has started
    const downloadingMessage = await message.channel.send('🎥 Downloading video...');

    try {
        // Download video based on platform
        const finalPath = isTikTok
            ? await downloadTikTok(videoUrl, outputPath)
            : await downloadYouTube(videoUrl, outputPath);

        // Send the video with an embed
        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0x0099ff)
                .setAuthor({ name: message.member ? message.member.displayName : message.author.username, iconURL: message.author.displayAvatarURL({ size: 256, dynamic: true }) })
                .setDescription(`${isTikTok ? '🎵' : '📺'} **[Original link](<${videoUrl}>)**`)
            ],
            files: [finalPath]
        });

        // Delete the "Downloading video..." message after sending video
        await downloadingMessage.delete().catch(() => {});
        fs.unlinkSync(finalPath);

        if (DELETE_ORIGINAL_MESSAGE) {
            await message.delete().catch(console.error);
        }

    } catch (err) {
        console.error('Error processing video:', err);
        await downloadingMessage.edit(`❌ ${err.message || 'Error processing video'}`).catch(() => {});
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
});

// =====================
// Login and shutdown
// =====================
client.once('clientReady', () => {console.log(`Logged in as ${client.user.tag}`);});
client.login(config.token).catch(err => console.error('Login failed', err));

//THOMP
