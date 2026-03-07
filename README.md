# Discord Video Downloader Bot

A small Discord bot that detects YouTube/TikTok links, downloads them using `yt-dlp`, optionally compresses them with `ffmpeg`, and re-uploads them to Discord with an embed.

## Requirements
- Node.js 25+
- `ffmpeg` + `ffprobe` installed and in PATH

## Install
Dependencies are listed in `package.json`, so just run:
npm install

## Config (config.json)
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "outputPath": "./",
  "allowedUsers": [""],
  "botRoleID": "",
  "MAX_FILE_MB": 8,
  "AUTO_DOWNLOAD_YOUTUBE": false,
  "SHORT_VIDEO_THRESHOLD": 30,
  "DELETE_ORIGINAL_MESSAGE": true,
  "LOG_CHAT": false
}

## Fields
- token: Discord bot token  
- outputPath: Folder for temp video files  
- allowedUsers: User IDs allowed to DM the bot (`ping`)  
- botRoleID: Role ID for manual download requests  (optional)
- MAX_FILE_MB: Max upload size (8MB recommended)  
- AUTO_DOWNLOAD_YOUTUBE: Auto-download YouTube links  
- SHORT_VIDEO_THRESHOLD: Seconds; short videos get higher quality  
- DELETE_ORIGINAL_MESSAGE: Delete original link message  
- LOG_CHAT: Log messages to console  

## Run
node .

## Usage
- Post a TikTok link → bot downloads and re-uploads.
- Post a YouTube link:
  - If AUTO_DOWNLOAD_YOUTUBE: true → downloads automatically.
  - If false → bot stores the link.
    - Then @mention the bot (or configured role) to download it.

## Notes
- Large videos are compressed to fit the upload limit.
