import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  console.log('🚀 Starting end-to-end Puppeteer verification for Feature Update 02...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // Helper to bypass login screen if present
    const bypassLogin = async () => {
      await page.waitForFunction(() => {
        return !!document.querySelector('.nav-item') || Array.from(document.querySelectorAll('button')).some(b => b.textContent && b.textContent.includes('Continue in Local Mode'));
      }, { timeout: 10000 });

      const hasNav = await page.$('.nav-item');
      if (!hasNav) {
        console.log('Bypassing login screen into Local Mode...');
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Continue in Local Mode'));
          if (btn) btn.click();
        });
        await page.waitForSelector('.nav-item', { timeout: 10000 });
      }
    };

    await bypassLogin();

    console.log('--- FEATURE 3: Favicon and Web App Icons ---');
    // Check favicon and manifest tags in document head
    const headLinks = await page.evaluate(() => {
      const iconSvg = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
      const iconPng = document.querySelector('link[rel="icon"][sizes="32x32"]');
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      const manifest = document.querySelector('link[rel="manifest"]');
      const themeColor = document.querySelector('meta[name="theme-color"]');
      return {
        svgHref: iconSvg?.getAttribute('href'),
        pngHref: iconPng?.getAttribute('href'),
        appleHref: appleIcon?.getAttribute('href'),
        manifestHref: manifest?.getAttribute('href'),
        themeColor: themeColor?.getAttribute('content'),
      };
    });

    console.log('Head metadata:', headLinks);
    if (headLinks.svgHref !== '/favicon.svg') throw new Error('favicon.svg not linked properly');
    if (headLinks.pngHref !== '/favicon-32x32.png') throw new Error('favicon-32x32.png not linked properly');
    if (headLinks.appleHref !== '/apple-touch-icon.png') throw new Error('apple-touch-icon not linked properly');
    if (headLinks.manifestHref !== '/site.webmanifest') throw new Error('site.webmanifest not linked properly');
    if (headLinks.themeColor !== '#090B10') throw new Error('theme-color meta tag mismatch');

    // Verify manifest fetches successfully
    await page.setCacheEnabled(false);
    const manifestRes = await page.goto('http://localhost:5173/site.webmanifest');
    console.log('site.webmanifest status:', manifestRes?.status());
    if (![200, 304].includes(manifestRes.status())) throw new Error(`Failed to fetch /site.webmanifest, status: ${manifestRes?.status()}`);
    const manifestJson = await manifestRes.json();
    console.log('Manifest parsed:', manifestJson.name, manifestJson.theme_color);
    if (manifestJson.name !== 'Chrono' || manifestJson.theme_color !== '#090B10') {
      throw new Error('Manifest contents incorrect');
    }

    // Return to app
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    await bypassLogin();

    console.log('--- FEATURE 2: Tab Closing Protection (beforeunload) ---');
    // Test 2A: Before starting timer, beforeunload should NOT be prevented
    const beforeStartResult = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return {
        defaultPrevented: evt.defaultPrevented,
        returnValue: evt.returnValue
      };
    });
    console.log('Idle beforeunload check:', beforeStartResult);
    if (beforeStartResult.defaultPrevented) {
      throw new Error('beforeunload should NOT be prevented when idle');
    }

    // Test 2B: Start stopwatch
    const startBtn = await page.waitForSelector('button.clock-start');
    await startBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // While stopwatch is running, beforeunload SHOULD be prevented
    const runningResult = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return {
        defaultPrevented: evt.defaultPrevented,
        returnValue: evt.returnValue
      };
    });
    console.log('Running beforeunload check:', runningResult);
    if (!runningResult.defaultPrevented && runningResult.returnValue !== '') {
      throw new Error('beforeunload MUST be triggered when timer is actively running');
    }

    // Test 2C: Pause stopwatch
    const pauseBtn = await page.waitForSelector('button.clock-start'); // text is "Pause"
    await pauseBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // When paused, beforeunload should NOT be prevented
    const pausedResult = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return {
        defaultPrevented: evt.defaultPrevented,
        returnValue: evt.returnValue
      };
    });
    console.log('Paused beforeunload check:', pausedResult);
    if (pausedResult.defaultPrevented) {
      throw new Error('beforeunload should NOT be prevented when timer is paused');
    }

    // Discard/reset session to clean up
    const discardBtn = await page.$('button.round-btn[title="Discard session"]');
    if (discardBtn) {
      await discardBtn.click();
      await new Promise(r => setTimeout(r, 400));
    }

    console.log('--- FEATURE 1: Auto-Hiding Controls in Immersive Mode ---');
    // Find immersive button on clock page (the Maximize2 button)
    const fsBtn = await page.waitForSelector('button[title*="full-screen" i], button[title*="fullscreen" i], button[title*="Immersive" i]');
    if (!fsBtn) throw new Error('Fullscreen button not found');
    await fsBtn.click();
    await page.waitForSelector('.immersive-overlay', { timeout: 3000 });
    // Allow entry animation (0.45s) to complete before measuring base rect
    await new Promise(r => setTimeout(r, 600));

    // Check initial visibility
    const initialVisibility = await page.evaluate(() => {
      const overlay = document.querySelector('.immersive-overlay');
      const topbar = document.querySelector('.immersive-topbar');
      const controls = document.querySelector('.immersive-controls');
      const digits = document.querySelector('.immersive-digits');
      const digitsRect = digits ? digits.getBoundingClientRect() : null;

      return {
        hasHiddenClass: overlay?.classList.contains('controls-hidden'),
        topbarOpacity: topbar ? window.getComputedStyle(topbar).opacity : null,
        controlsOpacity: controls ? window.getComputedStyle(controls).opacity : null,
        digitsRect: digitsRect ? { x: digitsRect.x, y: digitsRect.y, width: digitsRect.width, height: digitsRect.height } : null,
      };
    });
    console.log('Initial immersive visibility:', initialVisibility);
    if (initialVisibility.hasHiddenClass) {
      throw new Error('Controls should not be hidden initially upon entering immersive mode');
    }
    if (initialVisibility.topbarOpacity !== '1') {
      throw new Error('Topbar should be visible initially');
    }

    // Wait 3.5 seconds for auto-hide
    console.log('Waiting 3.5s for inactivity auto-hide...');
    await new Promise(r => setTimeout(r, 3500));

    // Check hidden state
    const hiddenState = await page.evaluate(() => {
      const overlay = document.querySelector('.immersive-overlay');
      const topbar = document.querySelector('.immersive-topbar');
      const controls = document.querySelector('.immersive-controls');
      const digits = document.querySelector('.immersive-digits');
      const digitsRect = digits ? digits.getBoundingClientRect() : null;

      return {
        hasHiddenClass: overlay?.classList.contains('controls-hidden'),
        topbarOpacity: topbar ? window.getComputedStyle(topbar).opacity : null,
        topbarPointerEvents: topbar ? window.getComputedStyle(topbar).pointerEvents : null,
        controlsOpacity: controls ? window.getComputedStyle(controls).opacity : null,
        controlsPointerEvents: controls ? window.getComputedStyle(controls).pointerEvents : null,
        digitsOpacity: digits ? window.getComputedStyle(digits).opacity : null,
        digitsRect: digitsRect ? { x: digitsRect.x, y: digitsRect.y, width: digitsRect.width, height: digitsRect.height } : null,
      };
    });
    console.log('Hidden state after 3.5s:', hiddenState);
    if (!hiddenState.hasHiddenClass) {
      throw new Error('.immersive-overlay should have .controls-hidden after 3s of inactivity');
    }
    if (hiddenState.topbarPointerEvents !== 'none') {
      throw new Error('Invisible topbar must have pointer-events: none');
    }
    if (hiddenState.controlsPointerEvents !== 'none') {
      throw new Error('Invisible controls must have pointer-events: none');
    }
    if (hiddenState.digitsOpacity !== '1') {
      throw new Error('Clock digits must remain 100% visible when controls hide');
    }

    // Check that clock digits DID NOT MOVE
    if (
      Math.abs(hiddenState.digitsRect.x - initialVisibility.digitsRect.x) > 1 ||
      Math.abs(hiddenState.digitsRect.y - initialVisibility.digitsRect.y) > 1
    ) {
      throw new Error(`Clock moved when controls hid! Before: ${JSON.stringify(initialVisibility.digitsRect)}, After: ${JSON.stringify(hiddenState.digitsRect)}`);
    }
    console.log('✔ Clock position remained completely stationary!');

    // Test mouse movement reveals controls immediately
    console.log('Moving mouse to reveal controls...');
    await page.mouse.move(200, 200);
    await page.mouse.move(250, 250);
    await new Promise(r => setTimeout(r, 100));

    const revealedState = await page.evaluate(() => {
      const overlay = document.querySelector('.immersive-overlay');
      return {
        hasHiddenClass: overlay?.classList.contains('controls-hidden'),
      };
    });
    console.log('Revealed state after mouse move:', revealedState);
    if (revealedState.hasHiddenClass) {
      throw new Error('Moving mouse should immediately reveal controls');
    }

    // Wait 3.5s again for auto-hide
    console.log('Waiting 3.5s for inactivity auto-hide...');
    await new Promise(r => setTimeout(r, 3500));

    // Test clicking screen when hidden reveals controls
    console.log('Clicking screen when hidden to reveal...');
    await page.click('.immersive-overlay');
    await new Promise(r => setTimeout(r, 100));

    const clickedState = await page.evaluate(() => {
      const overlay = document.querySelector('.immersive-overlay');
      return {
        hasHiddenClass: overlay?.classList.contains('controls-hidden'),
      };
    });
    console.log('State after click when hidden:', clickedState);
    if (clickedState.hasHiddenClass) {
      throw new Error('Clicking screen when hidden should reveal controls');
    }

    // Test Escape keyboard shortcut exits immersive mode
    console.log('Pressing Escape key to exit immersive mode...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 400));

    const exitedState = await page.evaluate(() => {
      return {
        hasOverlay: !!document.querySelector('.immersive-overlay'),
      };
    });
    console.log('State after Escape:', exitedState);
    if (exitedState.hasOverlay) {
      throw new Error('Pressing Escape should exit immersive mode');
    }

    console.log('✅ ALL VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
})();
