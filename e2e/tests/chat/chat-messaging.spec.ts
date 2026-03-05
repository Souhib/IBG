import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
} from "../../helpers/ui-game-setup";

/**
 * Helper to open the chat panel on a room page.
 * The ChatPanel toggle is a fixed-position button with no text or aria-label,
 * so we target by CSS class (Tailwind's `fixed` utility).
 * Once opened, the input with placeholder "Type a message..." becomes visible.
 */
async function openChatPanel(page: import("@playwright/test").Page) {
  const chatInput = page.locator('input[placeholder="Type a message..."]');

  // Already open?
  if (await chatInput.isVisible().catch(() => false)) return;

  // Click the floating chat toggle (fixed-position button)
  const toggle = page.locator("button.fixed").first();
  if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await toggle.click();
  }

  // Wait for the input to appear
  await expect(chatInput).toBeVisible({ timeout: 5_000 });
}

test.describe("Chat Messaging in Room", () => {
  test("chat panel is visible in room lobby", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    const hostPage = setup.players[0].page;

    // Open chat panel
    await openChatPanel(hostPage);

    // Input should be visible
    await expect(
      hostPage.locator('input[placeholder="Type a message..."]'),
    ).toBeVisible({ timeout: 5_000 });

    await setup.cleanup();
  });

  test("send and receive message between two players in room", async ({
    browser,
  }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    const page1 = setup.players[0].page;
    const page2 = setup.players[1].page;

    // Open chat for player 1 and send a message
    await openChatPanel(page1);
    const input1 = page1.locator('input[placeholder="Type a message..."]');
    await input1.fill("Assalamu Alaikum!");
    await input1.press("Enter");

    // Open chat for player 2 and verify message appears (via polling)
    await openChatPanel(page2);
    await expect(
      page2.getByText("Assalamu Alaikum!"),
    ).toBeVisible({ timeout: 15_000 });

    // Player 2 sends a reply
    const input2 = page2.locator('input[placeholder="Type a message..."]');
    await input2.fill("Wa Alaikum Assalam!");
    await input2.press("Enter");

    // Player 1 should see the reply
    await expect(
      page1.getByText("Wa Alaikum Assalam!"),
    ).toBeVisible({ timeout: 15_000 });

    await setup.cleanup();
  });

  test("messages persist after page reload", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    const hostPage = setup.players[0].page;

    // Open chat and send message
    await openChatPanel(hostPage);
    const input = hostPage.locator('input[placeholder="Type a message..."]');
    await input.fill("Bismillah");
    await input.press("Enter");

    // Verify message appears
    await expect(hostPage.getByText("Bismillah")).toBeVisible({
      timeout: 10_000,
    });

    // Reload page
    await hostPage.reload();
    await hostPage.waitForLoadState("domcontentloaded");

    // Wait for room to re-render (need player count to appear again)
    await hostPage
      .waitForFunction(
        () => document.body.innerText.includes("Players"),
        { timeout: 15_000 },
      )
      .catch(() => {});

    // Re-open chat
    await openChatPanel(hostPage);

    // Message should still be visible
    await expect(hostPage.getByText("Bismillah")).toBeVisible({
      timeout: 15_000,
    });

    await setup.cleanup();
  });
});
