import { configure, test, type ExtensionFn } from "@glubean/sdk";
import { browser, type GlubeanPage } from "@glubean/browser";

const config = configure({
  vars: {
    appUrl: "APP_URL",
  },
  plugins: {
    chrome: browser({ launch: true }),
  },
});

const pageFixture: ExtensionFn<GlubeanPage> = async (ctx, use) => {
  const pg = await config.chrome.newPage(ctx);
  try {
    await use(pg);
  } finally {
    await pg.close();
    await config.chrome.close();
  }
};

export const browserTest = test.extend({ page: pageFixture });
