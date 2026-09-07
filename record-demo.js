#!/usr/bin/env node
/**
 * record-demo.js — 录制 text-browser-agent 演示 GIF
 *
 * 用 ffmpeg gdigrab 录制主屏，然后转成 GIF。
 * 用法：
 *   node record-demo.js start   # 开始录制（后台，写 PID 文件）
 *   node record-demo.js stop    # 优雅停止录制并转 GIF
 *
 * 依赖：ffmpeg（可用 FFMPEG_PATH 指定路径）
 */
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';

const FFMPEG = process.env.FFMPEG_PATH || 'L:\\360MoveData\\Users\\Administrator\\Desktop\\ffmpeg\\ffmpeg.exe';
const OUT_DIR = process.env.EGO_GIF_DIR || join(tmpdir(), 'ego-demo-gif');
const RAW = join(OUT_DIR, 'demo.raw.mkv');
const GIF = join(OUT_DIR, 'demo.gif');
const STOP_FILE = join(OUT_DIR, 'stop.flag');

mkdirSync(OUT_DIR, { recursive: true });

function finalize() {
  if (!existsSync(RAW)) { console.error('未找到原始文件:', RAW); process.exit(1); }
  const palette = join(OUT_DIR, 'palette.png');
  execSync(`"${FFMPEG}" -y -i "${RAW}" -vf "fps=15,scale=720:-1:flags=lanczos,palettegen" "${palette}"`, { stdio: 'inherit' });
  execSync(`"${FFMPEG}" -y -i "${RAW}" -i "${palette}" -lavfi "fps=15,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse" "${GIF}"`, { stdio: 'inherit' });
  console.log('GIF 已生成:', GIF);
  process.exit(0);
}

function main() {
  const cmd = process.argv[2];

  if (cmd === 'start') {
    try { unlinkSync(STOP_FILE); } catch {}

    const args = [
      '-y', '-f', 'gdigrab',
      '-framerate', '30',
      '-offset_x', '0', '-offset_y', '0',
      '-video_size', '1920x1080',
      '-i', 'desktop',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-f', 'matroska',
      RAW,
    ];
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'ignore'], detached: true });
    proc.unref();

    console.log('录制中... 运行 `node record-demo.js stop` 停止');
    console.log('原始文件:', RAW);
    return;
  }

  if (cmd === 'stop') {
    // Graceful stop: taskkill without /F lets ffmpeg finalize the mkv.
    try { execSync('taskkill /IM ffmpeg.exe /T', { stdio: 'ignore' }); } catch {}
    console.log('已停止录制');
    let waited = 0;
    const t = setInterval(() => {
      waited += 500;
      if (waited > 2000) {
        clearInterval(t);
        finalize();
      }
    }, 500);
    return;
  }

  console.log('用法: node record-demo.js start|stop');
}

main();
