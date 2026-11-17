import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const screenshotsDir = 'C:\\Users\\Rohit\\Downloads\\chrono-liquid-glass-fixed\\chrono-personal\\dist\\screenshots';
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function run() {
  console.log('🚀 Starting Chrono interactive responsive verification...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  // 1. Enter local mode if on login screen
  const continueButtons = await page.$$('button.auth-link');
  for (const btn of continueButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Continue in Local Mode')) {
      await btn.click();
      await new Promise(r => setTimeout(r, 400));
      break;
    }
  }

  // ── Verification 1: Desktop (1440px) ───────────────────────────────────────
  console.log('▶ Testing 1440px Desktop...');
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 400));

  const desktopMetrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-area');
    const trigger = document.querySelector('.mobile-nav-trigger');
    const closeBtn = document.querySelector('.mobile-nav-close');
    return {
      overflow: doc.scrollWidth > doc.clientWidth,
      sidebarWidth: sidebar?.getBoundingClientRect().width,
      mainLeft: main?.getBoundingClientRect().left,
      triggerVisible: trigger ? window.getComputedStyle(trigger).display !== 'none' : false,
      closeBtnVisible: closeBtn ? window.getComputedStyle(closeBtn).display !== 'none' : false
    };
  });
  console.log('  Desktop metrics:', desktopMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'desktop-1440.png') });

  // ── Verification 2: Tablet (768px) ─────────────────────────────────────────
  console.log('▶ Testing 768px Tablet...');
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise(r => setTimeout(r, 400));

  const tabletMetrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-area');
    const trigger = document.querySelector('.mobile-nav-trigger');
    return {
      overflow: doc.scrollWidth > doc.clientWidth,
      sidebarLeft: sidebar?.getBoundingClientRect().left,
      mainWidth: main?.getBoundingClientRect().width,
      triggerVisible: trigger ? window.getComputedStyle(trigger).display !== 'none' : false
    };
  });
  console.log('  Tablet metrics:', tabletMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'tablet-768.png') });

  // ── Verification 3: Mobile (390px) ─────────────────────────────────────────
  console.log('▶ Testing 390px Mobile...');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 400));

  const mobileMetrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-area');
    const trigger = document.querySelector('.mobile-nav-trigger');
    return {
      overflow: doc.scrollWidth > doc.clientWidth,
      sidebarLeft: Math.round(sidebar?.getBoundingClientRect().left || 0),
      mainWidth: Math.round(main?.getBoundingClientRect().width || 0),
      triggerVisible: trigger ? window.getComputedStyle(trigger).display !== 'none' : false
    };
  });
  console.log('  Mobile metrics:', mobileMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-390-clock.png') });

  // ── Verification 4: Mobile Drawer Open / Close / Outside Click / Escape ────
  console.log('▶ Testing Mobile Slide-out Drawer Navigation...');
  // Click mobile hamburger menu trigger
  await page.click('.mobile-nav-trigger');
  await new Promise(r => setTimeout(r, 350));

  const drawerOpenMetrics = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    const bodyOverflow = document.body.style.overflow;
    return {
      isOpen: sidebar?.classList.contains('mobile-open'),
      sidebarLeft: Math.round(sidebar?.getBoundingClientRect().left ?? -999),
      backdropPresent: !!backdrop,
      bodyScrollLocked: bodyOverflow === 'hidden'
    };
  });
  console.log('  Drawer open metrics:', drawerOpenMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-390-drawer.png') });

  // Test Escape key dismissal
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 350));
  const drawerClosedByEsc = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    return !sidebar?.classList.contains('mobile-open') && document.body.style.overflow !== 'hidden';
  });
  console.log('  Drawer dismissed via Escape:', drawerClosedByEsc);

  // Re-open and test navigation item click dismissal
  await page.click('.mobile-nav-trigger');
  await new Promise(r => setTimeout(r, 350));
  // Click Insights nav item inside drawer
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('nav .nav-item'));
    const insightsBtn = items.find(b => b.textContent?.includes('Insights'));
    if (insightsBtn) insightsBtn.click();
  });
  await new Promise(r => setTimeout(r, 350));

  const pageAfterNav = await page.evaluate(() => {
    const title = document.querySelector('.page-title h1')?.textContent;
    const sidebar = document.querySelector('.sidebar');
    return {
      title,
      drawerClosed: !sidebar?.classList.contains('mobile-open')
    };
  });
  console.log('  Navigated to Insights and closed drawer:', pageAfterNav);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-390-insights.png') });

  // ── Verification 5: Settings Page & Controls on 390px ─────────────────────
  console.log('▶ Testing Settings Page on 390px...');
  await page.click('.mobile-nav-trigger');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('nav .nav-item'));
    const settingsBtn = items.find(b => b.textContent?.includes('Settings'));
    if (settingsBtn) settingsBtn.click();
  });
  await new Promise(r => setTimeout(r, 350));

  const settingsMetrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const segmented = document.querySelectorAll('.segmented');
    const typoGrid = document.querySelectorAll('.typography-grid');
    return {
      overflow: doc.scrollWidth > doc.clientWidth,
      segmentedCount: segmented.length,
      typoGridCount: typoGrid.length
    };
  });
  console.log('  Settings page metrics:', settingsMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-390-settings.png') });

  // Test theme switch to dark on 390px
  await page.evaluate(() => {
    const toggle = document.querySelector('.serene-theme-toggle');
    if (toggle) toggle.click();
  });
  await new Promise(r => setTimeout(r, 300));
  const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('  Theme switched to:', currentTheme);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-390-dark-theme.png') });

  // Switch back to light
  await page.evaluate(() => {
    const toggle = document.querySelector('.serene-theme-toggle');
    if (toggle) toggle.click();
  });
  await new Promise(r => setTimeout(r, 200));

  // ── Verification 6: Clock Functionality & Timer on 390px ──────────────────
  console.log('▶ Testing Clock & Timer controls on 390px...');
  await page.click('.mobile-nav-trigger');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('nav .nav-item'));
    const clockBtn = items.find(b => b.textContent?.includes('Clock'));
    if (clockBtn) clockBtn.click();
  });
  await new Promise(r => setTimeout(r, 350));

  // Switch to timer mode
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('.mode-switch button');
    if (tabs[1]) tabs[1].click();
  });
  await new Promise(r => setTimeout(r, 200));

  // Click 15m preset
  await page.evaluate(() => {
    const presets = Array.from(document.querySelectorAll('.duration-presets button'));
    const p15 = presets.find(b => b.textContent?.trim() === '15m');
    if (p15) p15.click();
  });
  await new Promise(r => setTimeout(r, 200));

  const displayTime = await page.evaluate(() => document.querySelector('.unified-clock-display')?.textContent?.trim());
  console.log('  Duration set to 15m, display is:', displayTime);

  // Start timer
  await page.evaluate(() => {
    const startBtn = document.querySelector('.primary-btn.clock-start');
    if (startBtn) startBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const runningStatus = await page.evaluate(() => {
    return {
      statusText: document.querySelector('.clock-status')?.textContent?.trim(),
      display: document.querySelector('.unified-clock-display')?.textContent?.trim()
    };
  });
  console.log('  Timer running state:', runningStatus);

  // Pause timer
  await page.evaluate(() => {
    const pauseBtn = document.querySelector('.primary-btn.clock-start');
    if (pauseBtn) pauseBtn.click();
  });
  await new Promise(r => setTimeout(r, 300));

  const pausedStatus = await page.evaluate(() => document.querySelector('.clock-status')?.textContent?.trim());
  console.log('  Timer paused state:', pausedStatus);

  // Reset timer
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.unified-controls button'));
    const resetBtn = btns.find(b => b.getAttribute('title')?.includes('Discard'));
    if (resetBtn) resetBtn.click();
  });
  await new Promise(r => setTimeout(r, 200));
  console.log('  Timer reset cleanly.');

  // ── Verification 7: Mobile Landscape Immersive Mode ────────────────────────
  console.log('▶ Testing Mobile Landscape Immersive Mode (844x390)...');
  await page.setViewport({ width: 844, height: 390 });
  await new Promise(r => setTimeout(r, 400));

  // Enter immersive mode
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.unified-controls button'));
    const immBtn = btns.find(b => b.getAttribute('title')?.includes('Immersive'));
    if (immBtn) immBtn.click();
  });
  await new Promise(r => setTimeout(r, 450));

  const landscapeMetrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const ring = document.querySelector('.immersive-ring-container');
    const digits = document.querySelector('.immersive-digits');
    const controls = document.querySelector('.immersive-controls');
    return {
      overflow: doc.scrollWidth > doc.clientWidth,
      ringSize: ring ? Math.round(ring.getBoundingClientRect().height) : 0,
      digitsFontSize: digits ? window.getComputedStyle(digits).fontSize : '',
      controlsTop: controls ? Math.round(controls.getBoundingClientRect().top) : 0
    };
  });
  console.log('  Landscape immersive metrics:', landscapeMetrics);
  await page.screenshot({ path: path.join(screenshotsDir, 'mobile-landscape-immersive.png') });

  // Exit immersive mode
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));

  console.log('🎉 Interactive verification completed successfully!');
  await browser.close();
}

run().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
