import { configure, type ExtensionFn, test } from "@glubean/sdk";
import { browser, type GlubeanPage } from "@glubean/browser";

const config = configure({
  vars: {
    appUrl: "APP_URL",
  },
  plugins: {
    chrome: browser({ launch: true }),
    chromeWithScreenshots: browser({ launch: true, screenshot: "every-step" }),
  },
});

const pageFixture: ExtensionFn<GlubeanPage> = async (ctx, use) => {
  const pg = await config.chrome.newPage(ctx);
  try {
    await use(pg);
  } catch (err) {
    await pg.screenshotOnFailure();
    throw err;
  } finally {
    await pg.close();
    await config.chrome.close();
  }
};

const screenshotPageFixture: ExtensionFn<GlubeanPage> = async (ctx, use) => {
  const pg = await config.chromeWithScreenshots.newPage(ctx);
  try {
    await use(pg);
  } catch (err) {
    await pg.screenshotOnFailure();
    throw err;
  } finally {
    await pg.close();
    await config.chromeWithScreenshots.close();
  }
};

export const browserTest = test.extend({ page: pageFixture });
export const screenshotTest = test.extend({ page: screenshotPageFixture });
