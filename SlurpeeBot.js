BotUrl = "https://discord.com/oauth2/authorize?client_id=1349197305802260500&permissions=8&integration_type=0&scope=bot";
const TOKEN = '';

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// === SETTINGS ===
const DOWNLOAD_YOUTUBE = true;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB Discord Limit
const DELETE_ORIGINAL_MESSAGE = false;

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

async function isYouTubeEmbedBlocked(videoUrl) {
    try {
        const videoIdMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
        if (!videoIdMatch) return false;

        const videoId = videoIdMatch[1];
        const url = `https://www.youtube.com/embed/${videoId}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' }
        });

        return response.data.includes("UNPLAYABLE") || response.data.includes("Video unavailable");
    } catch (error) {
        return false;
    }
}

async function getBestYouTubeFormat(videoUrl) {
    try {
        const metadata = await ytDlp(videoUrl, {
            dumpSingleJson: true,
            noWarnings: true
        });

        if (!metadata.formats || metadata.formats.length === 0) {
            return null;
        }

        let bestCombination = null;

        metadata.formats.forEach(video => {
            if (video.ext === "mp4" && video.vcodec !== "none" && video.filesize && video.filesize < MAX_FILE_SIZE) {
                metadata.formats.forEach(audio => {
                    if (audio.acodec !== "none" && audio.vcodec === "none" && audio.filesize && video.filesize + audio.filesize <= MAX_FILE_SIZE) {
                        if (!bestCombination || video.height > bestCombination.video.height) {
                            bestCombination = { video, audio };
                        }
                    }
                });
            }
        });

        if (!bestCombination) {
            return null;
        }

        console.log(`✅ Selected: ${bestCombination.video.width}x${bestCombination.video.height}, ${(bestCombination.video.filesize + bestCombination.audio.filesize) / 1024 / 1024}MB`);

        return {
            videoFormat: bestCombination.video.format_id,
            audioFormat: bestCombination.audio.format_id
        };
    } catch (error) {
        return null;
    }
}

async function getBestTikTokFormat(videoUrl) {
    try {
        const metadata = await ytDlp(videoUrl, {
            dumpSingleJson: true,
            noWarnings: true
        });

        if (!metadata.formats || metadata.formats.length === 0) {
            return null;
        }

        let bestFormat = null;

        metadata.formats.forEach(format => {
            if (format.ext === "mp4" && format.vcodec.includes("h264") && format.filesize && format.filesize < MAX_FILE_SIZE) {
                if (!bestFormat || format.height > bestFormat.height) {
                    bestFormat = format;
                }
            }
        });

        if (!bestFormat) {
            return null;
        }

        console.log(`✅ Selected TikTok: ${bestFormat.width}x${bestFormat.height}, ${(bestFormat.filesize) / 1024 / 1024}MB`);

        return bestFormat.format_id;
    } catch (error) {
        return null;
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const ytRegex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/\S+/gi;
    const ttRegex = /(https?:\/\/)?(www\.)?(tiktok\.com)\/\S+/gi;

    const ytMatch = message.content.match(ytRegex);
    const ttMatch = message.content.match(ttRegex);

    let videoUrl = null;
    let isTikTok = false;
    let isYouTube = false;

    if (ttMatch) {
        videoUrl = ttMatch[0];
        isTikTok = true;
    } else if (ytMatch && DOWNLOAD_YOUTUBE) {
        videoUrl = ytMatch[0];
        isYouTube = true;

        const blocked = await isYouTubeEmbedBlocked(videoUrl);
        console.log(blocked ? `🚫 Video is blocked from embedding, downloading: ${videoUrl}` : `✅ Video is embeddable, skipping download: ${videoUrl}`);
        if (!blocked) return;
    } else {
        return;
    }

    try {
        const downloadingMessage = await message.channel.send(`🎥 Downloading video... Please wait!`);

        const outputFileName = `video-${Date.now()}.mp4`;
        const outputPath = `./${outputFileName}`;

        if (isTikTok) {
            const tiktokFormat = await getBestTikTokFormat(videoUrl);
            if (!tiktokFormat) {
                await downloadingMessage.edit("❌ No suitable H.264 TikTok format found.");
                return;
            }

            await ytDlp(videoUrl, {
                output: outputPath,
                format: tiktokFormat
            });
        } else {
            const formats = await getBestYouTubeFormat(videoUrl);
            if (!formats) {
                await downloadingMessage.edit("❌ No suitable video/audio format found.");
                return;
            }

            await ytDlp(videoUrl, {
                output: outputPath,
                format: `${formats.videoFormat}+${formats.audioFormat}`,
                mergeOutputFormat: "mp4"
            });
        }

        if (!fs.existsSync(outputPath)) {
            await downloadingMessage.edit("⚠️ Failed to download video.");
            return;
        }

        const fileStats = fs.statSync(outputPath);
        if (fileStats.size > MAX_FILE_SIZE) {
            await downloadingMessage.edit("⚠️ Video is too large to send (over 8MB).");
            setTimeout(() => downloadingMessage.delete().catch(console.error), 5000);
            fs.unlinkSync(outputPath);
            return;
        }

        await downloadingMessage.delete().catch(console.error);

        const displayName = message.member ? message.member.displayName : message.author.username;
        const avatarUrl = message.author.displayAvatarURL({ size: 256, dynamic: true });

        // Use the correct platform emoji
        const platformIcon = isYouTube ? "📺" : "🎵"; // 📺 for YouTube, 🎵 for TikTok

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: displayName, iconURL: avatarUrl })
            .setDescription(`${platformIcon} **[Original link](<${videoUrl}>)**`);

        await message.channel.send({
            embeds: [embed],
            files: [outputPath]
        });

        if (isTikTok || (DELETE_ORIGINAL_MESSAGE && isYouTube)) {
            await message.delete().catch(console.error);
        }

        fs.unlinkSync(outputPath);
    } catch (error) {
        message.channel.send(`❌ Failed to download the video.`);
    }
});

client.login(TOKEN);
