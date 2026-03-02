import { chromium } from "playwright";
const DIR = "/home/dominic/usage-monitor/docs/screenshots";
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3847/");
  await page.waitForTimeout(2000);
  // Set locale via localStorage and reload
  await page.evaluate(() => { localStorage.setItem("locale", "ja"); });
  await page.reload();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${DIR}/08-i18n-japanese.png`, fullPage: true });
  await browser.close();
  console.log("i18n screenshot captured!");
}
main().catch(console.error);
