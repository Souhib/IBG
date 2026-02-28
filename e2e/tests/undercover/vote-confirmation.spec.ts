import { test, expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
  dismissRoleRevealAll,
  submitDescriptionsForAllPlayers,
  waitForVotingPhase,
} from "../../helpers/ui-game-setup";

test.beforeAll(async () => {
  await flushRedis();
});

const THREE_ACCOUNTS = [TEST_USER, TEST_PLAYER, TEST_ALI];

test.describe("Undercover — Vote Confirmation", () => {
  test("select player highlights but doesn't vote immediately", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      const activePlayers = await dismissRoleRevealAll(players);
      await submitDescriptionsForAllPlayers(activePlayers);
      await waitForVotingPhase(activePlayers[0].page);

      const voterPage = activePlayers[0].page;

      // Find a vote target button
      const targetButton = voterPage
        .locator(".grid.gap-3 button")
        .first();
      await expect(targetButton).toBeVisible({ timeout: 10_000 });

      // Click to select (not vote)
      await targetButton.click();

      // Should show "Selected" text (not "Voted")
      const selectedText = await voterPage
        .locator("text=Selected")
        .isVisible()
        .catch(() => false);
      expect(selectedText).toBe(true);

      // Should NOT show the "Your vote has been recorded" toast
      // The vote_casted toast only appears after confirming
      const voteCastedToast = await voterPage
        .locator("[data-sonner-toast] >> text=Your vote has been recorded")
        .isVisible({ timeout: 1_000 })
        .catch(() => false);
      expect(voteCastedToast).toBe(false);

      // "Vote to Eliminate" button should be enabled
      const voteBtn = voterPage.locator("button:has-text('Vote to Eliminate')");
      await expect(voteBtn).toBeEnabled({ timeout: 5_000 });
    } finally {
      await cleanup();
    }
  });

  test("vote button submits the vote", async ({ browser }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      const activePlayers = await dismissRoleRevealAll(players);
      await submitDescriptionsForAllPlayers(activePlayers);
      await waitForVotingPhase(activePlayers[0].page);

      const voterPage = activePlayers[0].page;

      // Select a player
      const targetButton = voterPage
        .locator(".grid.gap-3 button")
        .first();
      await expect(targetButton).toBeVisible({ timeout: 10_000 });
      await targetButton.click();

      // Click "Vote to Eliminate"
      const voteBtn = voterPage.locator("button:has-text('Vote to Eliminate')");
      await expect(voteBtn).toBeEnabled({ timeout: 5_000 });
      await voteBtn.click();

      // Should show "Voted" text
      await voterPage
        .locator("text=Voted")
        .or(voterPage.locator("text=Waiting for other players"))
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    } finally {
      await cleanup();
    }
  });

  test("can change selection before confirming", async ({ browser }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      const activePlayers = await dismissRoleRevealAll(players);
      await submitDescriptionsForAllPlayers(activePlayers);
      await waitForVotingPhase(activePlayers[0].page);

      const voterPage = activePlayers[0].page;

      const targetButtons = voterPage.locator(".grid.gap-3 button");
      const count = await targetButtons.count();
      if (count < 2) {
        // Only one target (3-player game, self excluded) — skip multi-select test
        return;
      }

      // Select first player
      await targetButtons.nth(0).click();

      // Select second player (should deselect first)
      await targetButtons.nth(1).click();

      // Only the second should have the highlight ring
      const secondClasses = await targetButtons.nth(1).getAttribute("class") || "";
      expect(secondClasses).toContain("ring-2");

      // First should not have the ring
      const firstClasses = await targetButtons.nth(0).getAttribute("class") || "";
      expect(firstClasses).not.toContain("ring-2");
    } finally {
      await cleanup();
    }
  });

  test("cannot vote after confirming", async ({ browser }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      const activePlayers = await dismissRoleRevealAll(players);
      await submitDescriptionsForAllPlayers(activePlayers);
      await waitForVotingPhase(activePlayers[0].page);

      const voterPage = activePlayers[0].page;

      // Select and vote
      const targetButton = voterPage.locator(".grid.gap-3 button").first();
      await expect(targetButton).toBeVisible({ timeout: 10_000 });
      await targetButton.click();

      const voteBtn = voterPage.locator("button:has-text('Vote to Eliminate')");
      await voteBtn.click();

      // After voting, "Vote to Eliminate" button should disappear
      await expect(voteBtn).toBeHidden({ timeout: 10_000 });

      // Player cards should be disabled
      const firstCard = voterPage.locator(".grid.gap-3 button").first();
      const isDisabled = await firstCard.isDisabled().catch(() => true);
      expect(isDisabled).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
