import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotsDir = 'C:\\Users\\Rohit\\Downloads\\chrono-liquid-glass-fixed\\chrono-personal\\dist\\screenshots_update01';
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function run() {
  console.log('🚀 Starting Chrono Feature Update 01 Browser Verification...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(process.env.TEST_URL || 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  // Helper to enter local mode
  const enterLocalMode = async () => {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('Continue in Local Mode')) {
          b.click();
          return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 600));
  };

  await enterLocalMode();

  // Inject sample sessions spanning the day boundary & categories
  await page.evaluate(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    // Use day 16 of current month
    const s1Start = new Date(y, m, 16, 23, 0).getTime();
    const s1End = new Date(y, m, 17, 2, 0).getTime(); // 3 hours (Nov 16 11 PM to Nov 17 2 AM)
    const s2Start = new Date(y, m, 17, 5, 0).getTime();
    const s2End = new Date(y, m, 17, 7, 0).getTime(); // 2 hours (Nov 17 5 AM to 7 AM)

    const raw = localStorage.getItem('chrono-v1');
    const store = raw ? JSON.parse(raw) : {};
    store.sessions = [
      {
        id: 'test_s1',
        start: s1Start,
        end: s1End,
        duration: 10800,
        category: 'college',
        subcategory: 'DSP',
        source: 'stopwatch',
        notes: 'Late night DSP study'
      },
      {
        id: 'test_s2',
        start: s2Start,
        end: s2End,
        duration: 7200,
        category: 'college',
        subcategory: 'Machine Learning',
        source: 'timer',
        notes: 'Morning ML session'
      }
    ];
    store.dayStartHour = 4;
    store.weekStartsOn = 'monday';
    localStorage.setItem('chrono-v1', JSON.stringify(store));
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  await enterLocalMode();

  // ── Verification A: Clock & Timer Functionality ───────────────────────────
  console.log('▶ Verifying Clock & Timer...');
  const clockText = await page.evaluate(() => document.querySelector('.clock-face')?.textContent);
  console.log('  Clock face text:', clockText);

  // ── Verification B: Settings Page ─────────────────────────────────────────
  console.log('▶ Navigating to Settings...');
  await page.evaluate(() => {
    const navBtns = Array.from(document.querySelectorAll('.nav-item'));
    for (const b of navBtns) {
      if (b.textContent && b.textContent.includes('Settings')) {
        b.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 600));

  // Inspect settings rows
  const settingsRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.setting-row'));
    return rows.map(r => r.querySelector('h3')?.textContent?.trim() || '');
  });
  console.log('  Settings row headings:', settingsRows);

  const themeIdx = settingsRows.indexOf('Appearance theme');
  const dayStartIdx = settingsRows.indexOf('Day starts at');
  const weekStartIdx = settingsRows.indexOf('Week starts on');
  const sidebarIdx = settingsRows.indexOf('Sidebar navigation');

  console.log(`  Appearance theme row: index ${themeIdx}`);
  console.log(`  Day starts at row: index ${dayStartIdx}`);
  console.log(`  Week starts on row: index ${weekStartIdx}`);
  console.log(`  Sidebar navigation row: index ${sidebarIdx}`);

  if (dayStartIdx !== themeIdx + 1) throw new Error('Day starts at must be immediately after Appearance theme');
  if (weekStartIdx !== dayStartIdx + 1) throw new Error('Week starts on must be immediately after Day starts at');

  // Test opening CustomSelect in Day Starts At row
  console.log('  Testing Day starts at dropdown...');
  const daySelectTrigger = await page.$('.setting-row:nth-child(2) .custom-select-trigger');
  if (daySelectTrigger) {
    await daySelectTrigger.click();
    await new Promise(r => setTimeout(r, 300));
    const options = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.setting-row:nth-child(2) .custom-select-option')).map(o => o.textContent?.trim());
    });
    console.log('  Day starts at options:', options);
    // Click 04:00 AM option
    const options4AM = await page.$$('.setting-row:nth-child(2) .custom-select-option');
    for (const opt of options4AM) {
      const text = await page.evaluate(el => el.textContent, opt);
      if (text && text.includes('04:00 AM')) {
        await opt.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Test Week Starts On segmented control
  console.log('  Testing Week starts on segmented control...');
  const segmentedButtons = await page.$$('.setting-row:nth-child(3) .segmented button');
  for (const btn of segmentedButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Sunday')) {
      await btn.click();
      console.log('  Selected Sunday week start');
      break;
    }
  }
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(screenshotsDir, 'settings-preferences.png') });

  // ── Verification C: Calendar Page & Weekday Ordering ──────────────────────
  console.log('▶ Navigating to Calendar...');
  await page.evaluate(() => {
    const navBtns = Array.from(document.querySelectorAll('.nav-item'));
    for (const b of navBtns) {
      if (b.textContent && b.textContent.includes('Calendar')) {
        b.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 600));

  const weekdays = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.weekdays span')).map(s => s.textContent?.trim());
  });
  console.log('  Calendar weekdays (with Sunday start):', weekdays);
  if (weekdays[0] !== 'S') throw new Error('First weekday must be S when Sunday start is selected');

  // ── Verification D: Calendar Date Details Popup Hover ─────────────────────
  console.log('▶ Testing Calendar Date Details popup on hover...');
  // Hover day 16 (which has the late night session under 4 AM boundary)
  const day16 = await page.$('.day[data-day-cell="16"]');
  if (day16) {
    await day16.hover();
    await new Promise(r => setTimeout(r, 400));

    const popupData = await page.evaluate(() => {
      const popup = document.querySelector('.calendar-date-popup');
      if (!popup) return null;
      const rect = popup.getBoundingClientRect();
      return {
        visible: window.getComputedStyle(popup).display !== 'none',
        date: popup.querySelector('.cal-popup-date')?.textContent,
        stats: Array.from(popup.querySelectorAll('.cal-popup-stats div')).map(d => d.textContent?.trim()),
        categories: Array.from(popup.querySelectorAll('.cal-popup-cat-header')).map(c => c.textContent?.trim()),
        subs: Array.from(popup.querySelectorAll('.cal-popup-sub-row')).map(s => s.textContent?.trim()),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        window: { width: window.innerWidth, height: window.innerHeight }
      };
    });
    console.log('  Day 16 Hover Popup Data:', popupData);
    if (!popupData) throw new Error('Calendar date popup did not render on hover');

    // Check bounds
    if (popupData.rect.left < 0 || popupData.rect.left + popupData.rect.width > popupData.window.width) {
      throw new Error('Popup clipped horizontally');
    }
    if (popupData.rect.top < 0 || popupData.rect.top + popupData.rect.height > popupData.window.height) {
      throw new Error('Popup clipped vertically');
    }

    await page.screenshot({ path: path.join(screenshotsDir, 'calendar-hover-day16.png') });
  }

  // Hover day 17
  console.log('▶ Testing Hover on Day 17...');
  const day17 = await page.$('.day[data-day-cell="17"]');
  if (day17) {
    await day17.hover();
    await new Promise(r => setTimeout(r, 400));
    const day17Popup = await page.evaluate(() => {
      const popup = document.querySelector('.calendar-date-popup');
      return {
        date: popup?.querySelector('.cal-popup-date')?.textContent,
        stats: Array.from(popup?.querySelectorAll('.cal-popup-stats div') || []).map(d => d.textContent?.trim()),
        categories: Array.from(popup?.querySelectorAll('.cal-popup-cat-header') || []).map(c => c.textContent?.trim()),
      };
    });
    console.log('  Day 17 Hover Popup Data:', day17Popup);
  }

  // Hover empty day
  console.log('▶ Testing Hover on Empty Day (Day 25)...');
  const day25 = await page.$('.day[data-day-cell="25"]');
  if (day25) {
    await day25.hover();
    await new Promise(r => setTimeout(r, 400));
    const day25Popup = await page.evaluate(() => {
      const popup = document.querySelector('.calendar-date-popup');
      return {
        date: popup?.querySelector('.cal-popup-date')?.textContent,
        emptyText: popup?.querySelector('.cal-popup-empty')?.textContent,
        stats: Array.from(popup?.querySelectorAll('.cal-popup-stats div') || []).map(d => d.textContent?.trim())
      };
    });
    console.log('  Day 25 Empty Popup Data:', day25Popup);
  }

  // ── Verification E: Mobile Tap & Backdrop Dismissal ───────────────────────
  console.log('▶ Testing Mobile Tap Interaction (390px Viewport)...');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 400));

  // Tap day 16
  const mobileDay16 = await page.$('.day[data-day-cell="16"]');
  if (mobileDay16) {
    await mobileDay16.click();
    await new Promise(r => setTimeout(r, 400));

    const mobilePopup = await page.evaluate(() => {
      const popup = document.querySelector('.calendar-date-popup');
      const backdrop = document.querySelector('.calendar-popup-backdrop');
      const rect = popup?.getBoundingClientRect();
      return {
        hasPopup: !!popup,
        hasBackdrop: !!backdrop,
        isInteractive: popup?.classList.contains('interactive'),
        rect: rect ? { top: rect.top, left: rect.left, width: rect.width } : null
      };
    });
    console.log('  Mobile Tap Data:', mobilePopup);
    if (!mobilePopup.hasPopup) throw new Error('Mobile tap must show popup');
    if (!mobilePopup.hasBackdrop) throw new Error('Mobile tap must show backdrop');

    await page.screenshot({ path: path.join(screenshotsDir, 'mobile-calendar-tap.png') });

    // Tap outside to dismiss
    console.log('  Tapping outside to dismiss...');
    await page.mouse.click(10, 10);
    await new Promise(r => setTimeout(r, 300));

    const popupAfterBackdrop = await page.$('.calendar-date-popup');
    console.log('  Popup present after outside click:', !!popupAfterBackdrop);
    if (popupAfterBackdrop) throw new Error('Popup must close after outside click');
  }

  // ── Verification F: Switch Theme Verification ─────────────────────────────
  console.log('▶ Testing Theme Switcher...');
  const themeToggle = await page.$('.serene-theme-toggle');
  if (themeToggle) {
    await themeToggle.click();
    await new Promise(r => setTimeout(r, 400));
    const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('  Theme switched to:', currentTheme);
  }

  console.log('🎉 Browser visual & interaction verification completed successfully!');
  await browser.close();
}

run().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
