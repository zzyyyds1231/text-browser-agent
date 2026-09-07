#!/usr/bin/env node
/**
 * demo.js — text-browser-agent 演示脚本
 *
 * 展示核心卖点：AX 树文本快照（免视觉 token）驱动浏览器。
 * 运行：node demo.js
 */
import { createHelpers, config, prepareEnv } from './core.js';

prepareEnv();
const helpers = createHelpers();
helpers.setHeadless(true);

try {
  await helpers.ensureStarted();

  // 1. 打开页面
  await helpers.openOrReuseTab('https://example.com');
  const info = await helpers.pageInfo();
  console.log('=== 1. 打开页面 ===');
  console.log('URL  :', info.url);
  console.log('标题 :', info.title);

  // 2. AX 树文本快照（核心卖点）
  const snap = await helpers.snapshotText();
  const lines = snap.split('\n');
  console.log('\n=== 2. AX 树文本快照（免视觉 token）===');
  console.log('快照行数 :', lines.length);
  console.log('快照字符 :', snap.length);
  console.log('--- 快照预览 ---');
  console.log(lines.slice(0, 6).join('\n'));

  // 3. 成本对比（估算）
  console.log('\n=== 3. 成本对比（估算）===');
  const visionTokensPerPage = 1500; // 视觉模型单页截图约 1500 token
  const axTokensPerPage = Math.ceil(snap.length / 4); // 约 4 字符/token
  const pages = 100;
  const visionCost = (visionTokensPerPage * pages / 1e6) * 2.5; // $2.5/M tokens
  const axCost = (axTokensPerPage * pages / 1e6) * 0.15; // $0.15/M tokens
  console.log(`视觉方案 : ${pages} 页 ≈ ${visionTokensPerPage * pages} tokens ≈ $${visionCost.toFixed(2)}`);
  console.log(`AX 文本  : ${pages} 页 ≈ ${axTokensPerPage * pages} tokens ≈ $${axCost.toFixed(2)}`);
  console.log(`节省     : ${(visionCost / axCost).toFixed(0)}x 成本`);

  // 4. 交互（点击链接）
  console.log('\n=== 4. 交互 ===');
  await helpers.click('a');
  await new Promise(r => setTimeout(r, 2000));
  const info2 = await helpers.pageInfo();
  console.log('点击后 URL :', info2.url);

  console.log('\n演示完成 ✅');
} catch (err) {
  console.error('演示失败:', err.message);
  process.exit(1);
} finally {
  await helpers.shutdownAll();
}
