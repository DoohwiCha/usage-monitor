import { chromium } from "playwright";

const BASE = "http://localhost:3847";
const DIR = "/home/dominic/usage-monitor/docs/screenshots";

async function main() {
  const browser = await chromium.launch();

  // 1. Landing page (dark)
  const landing = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await landing.goto(BASE + "/");
  await landing.waitForTimeout(2000);
  await landing.screenshot({ path: `${DIR}/01-landing-dark.png`, fullPage: true });
  // Landing (light)
  await landing.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("theme", "light");
  });
  await landing.waitForTimeout(500);
  await landing.screenshot({ path: `${DIR}/02-landing-light.png`, fullPage: true });
  await landing.close();

  // 2. Login page
  const login = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await login.goto(BASE + "/monitor/login");
  await login.waitForTimeout(2000);
  await login.screenshot({ path: `${DIR}/03-login.png` });

  // 3. Login and capture dashboard
  await login.fill("#username", process.env.MONITOR_ADMIN_USER || "admin");
  await login.fill("#password", process.env.MONITOR_ADMIN_PASS || "changeme");
  await login.click('button[type="submit"]');
  await login.waitForURL("**/monitor", { timeout: 10000 });
  await login.waitForTimeout(3000);
  await login.screenshot({ path: `${DIR}/04-dashboard-dark.png`, fullPage: true });
  // Dashboard (light)
  await login.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("theme", "light");
  });
  await login.waitForTimeout(500);
  await login.screenshot({ path: `${DIR}/05-dashboard-light.png`, fullPage: true });
  // Back to dark
  await login.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");
  });
  await login.waitForTimeout(300);

  // 4. Accounts manager
  await login.goto(BASE + "/monitor/accounts");
  await login.waitForTimeout(2000);
  await login.screenshot({ path: `${DIR}/06-accounts.png`, fullPage: true });

  // 5. Account detail (first account if exists)
  const detailLink = login.locator('a[href*="/monitor/accounts/"]').first();
  if (await detailLink.count() > 0) {
    await detailLink.click();
    await login.waitForTimeout(2000);
    await login.screenshot({ path: `${DIR}/07-account-detail.png`, fullPage: true });
  }

  // 6. Language selector demo (Japanese)
  await login.goto(BASE + "/");
  await login.waitForTimeout(1500);
  // Click language selector
  const langBtn = login.locator('button:has-text("ENG")').first();
  if (await langBtn.count() > 0) {
    await langBtn.click();
    await login.waitForTimeout(300);
    const jaBtn = login.locator('button:has-text("日本語")').first();
    if (await jaBtn.count() > 0) {
      await jaBtn.click();
      await login.waitForTimeout(500);
      await login.screenshot({ path: `${DIR}/08-i18n-japanese.png`, fullPage: true });
    }
  }

  await browser.close();
  console.log("Screenshots captured!");
}

main().catch(console.error);
