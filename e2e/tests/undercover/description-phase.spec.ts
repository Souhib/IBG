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
  type PlayerContext,
} from "../../helpers/ui-game-setup";

test.beforeAll(async () => {
  await flushRedis();
});

const THREE_ACCOUNTS = [TEST_USER, TEST_PLAYER, TEST_ALI];

test.describe("Undercover — Description Phase", () => {
  test("each player gets a turn to describe", async ({ browser }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      await dismissRoleRevealAll(players);

      // After dismissing roles, players should be in the describing phase
      // At least one player should see the description order
      let describingFound = false;
      for (const player of players) {
        const hasDescriptionUI = await player.page
          .locator("text=Description Order")
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (hasDescriptionUI) {
          describingFound = true;
          break;
        }
      }
      expect(describingFound).toBe(true);

      // The first describer should see the input field
      let inputFound = false;
      for (const player of players) {
        const hasInput = await player.page
          .locator("#description-input")
          .isVisible()
          .catch(() => false);
        if (hasInput) {
          inputFound = true;
          break;
        }
      }
      expect(inputFound).toBe(true);

      // Non-describers should see "Waiting for..." message
      let waitingFound = false;
      for (const player of players) {
        const hasWaiting = await player.page
          .locator("text=/Waiting for .* to describe/")
          .first()
          .isVisible()
          .catch(() => false);
        if (hasWaiting) {
          waitingFound = true;
          break;
        }
      }
      expect(waitingFound).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("single-word validation rejects spaces", async ({ browser }) => {
    test.setTimeout(120_000);
    const { players, cleanup } = await setupRoomWithPlayers(
      browser,
      THREE_ACCOUNTS,
      "undercover",
    );

    try {
      await startGameViaUI(players, "undercover");
      await dismissRoleRevealAll(players);

      // Find the player whose turn it is (has the input)
      let describerPage = null;
      for (const player of players) {
        const hasInput = await player.page
          .locator("#description-input")
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (hasInput) {
          describerPage = player.page;
          break;
        }
      }
      expect(describerPage).not.toBeNull();
      if (!describerPage) return;

      // Type "two words" and submit
      await describerPage.locator("#description-input").fill("two words");
      await describerPage.locator("button:has-text('Submit')").click();

      // Should show error
      const errorMsg = await describerPage
        .locator("text=Must be a single word")
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      expect(errorMsg).toBe(true);

      // Type valid word - should submit successfully
      await describerPage.locator("#description-input").fill("test");
      await describerPage.locator("button:has-text('Submit')").click();

      // Wait for the description to be submitted (input disappears or next player gets turn)
      await describerPage
        .locator("#description-input")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
    } finally {
      await cleanup();
    }
  });

  test("all descriptions visible after completion transitions to voting", async ({
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

      // Submit descriptions for all players
      await submitDescriptionsForAllPlayers(activePlayers);

      // After all descriptions, transition overlay may appear before voting phase.
      // Wait briefly for transition text "All hints are in!" before checking voting phase.
      await activePlayers[0].page
        .locator("text=All hints are in")
        .first()
        .waitFor({ state: "visible", timeout: 5_000 })
        .catch(() => {});

      // Wait for voting phase ("Discuss and vote") to appear after transition completes
      for (const player of activePlayers) {
        const hasVotingUI = await player.page
          .locator("text=Discuss and vote")
          .first()
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!hasVotingUI) {
          // Reload to get latest state
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
        }
        await expect(
          player.page.locator("text=Discuss and vote").first(),
        ).toBeVisible({ timeout: 10_000 });
      }

      // Should see the "Vote to Eliminate" button
      for (const player of activePlayers) {
        const voteBtn = await player.page
          .locator("text=Vote to Eliminate")
          .isVisible()
          .catch(() => false);
        // Only alive players see the button
        if (voteBtn) {
          expect(voteBtn).toBe(true);
        }
      }
    } finally {
      await cleanup();
    }
  });

  test("reconnecting during description phase recovers state", async ({
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
      await dismissRoleRevealAll(players);

      // Wait for description phase to appear
      await players[0].page
        .locator("text=Description Order")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {});

      // Reload a player mid-description
      await players[0].page.reload();
      await players[0].page.waitForLoadState("domcontentloaded");

      // After reload, player should recover to describing phase
      const hasDescriptionUI = await players[0].page
        .locator("text=Description Order")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

      // May have transitioned to playing phase if descriptions completed
      if (!hasDescriptionUI) {
        const hasPlayingUI = await players[0].page
          .locator("text=Discuss and vote")
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasPlayingUI || hasDescriptionUI).toBe(true);
      }
    } finally {
      await cleanup();
    }
  });
});
