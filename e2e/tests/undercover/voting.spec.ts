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
  voteForPlayer,
  getAliveVoteTargets,
  waitForEliminationOrGameOver,
} from "../../helpers/ui-game-setup";

test.beforeAll(() => { flushRedis() });

test.describe("Undercover — Voting Rules (UI)", () => {
  test("voting buttons do not include the current player (no self-vote)", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      for (const player of setup.players) {
        const targets = await getAliveVoteTargets(player.page);
        expect(targets).toHaveLength(2);
        expect(targets).not.toContain(player.login.user.username);
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("player sees word reminder in playing phase", async ({ browser }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // At least 2 of 3 players should see "Your word:" reminder (Mr. White may not)
      let wordCount = 0;
      for (const player of setup.players) {
        const wordReminder = player.page.locator("text=Your word").first();
        const isVisible = await wordReminder
          .isVisible({ timeout: 5_000 })
          .catch(() => false);
        if (isVisible) wordCount++;
      }
      expect(wordCount).toBeGreaterThanOrEqual(2);
    } finally {
      await setup.cleanup();
    }
  });

  test("vote selection highlights chosen target and disables buttons", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      const voter = setup.players[0];
      const target1 = setup.players[1].login.user.username;

      const voteButton = voter.page.locator(
        `button:has(.font-medium:text("${target1}"))`,
      );
      await expect(voteButton).toBeEnabled({ timeout: 5_000 });

      await voteButton.click();

      // After voting: all vote buttons should be disabled
      const allVoteButtons = voter.page.locator(".grid.gap-3 button");
      const count = await allVoteButtons.count();
      for (let i = 0; i < count; i++) {
        await expect(allVoteButtons.nth(i)).toBeDisabled();
      }

      // "Waiting for other players to vote..." message should appear
      await expect(
        voter.page.locator("text=Waiting for other players"),
      ).toBeVisible({ timeout: 5_000 });

      // "Voted" indicator should be visible
      await expect(
        voter.page.locator("text=Voted").first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await setup.cleanup();
    }
  });

  test("elimination occurs after all alive players vote via UI", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      const targetUsername = setup.players[2].login.user.username;
      const player1Username = setup.players[0].login.user.username;

      await voteForPlayer(setup.players[0].page, targetUsername);
      await voteForPlayer(setup.players[1].page, targetUsername);
      await voteForPlayer(setup.players[2].page, player1Username);

      for (const player of setup.players) {
        await expect(
          player.page
            .locator(".lucide-skull, h2:has-text('Game Over')")
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("players list shows correct count for 3 players via UI", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // Player list should show 3/3 alive
      for (const player of setup.players) {
        await expect(
          player.page.locator("text=Players (3/3)"),
        ).toBeVisible({ timeout: 10_000 });
      }

      // Each player should see 2 vote targets (not self)
      for (const player of setup.players) {
        const targets = await getAliveVoteTargets(player.page);
        expect(targets).toHaveLength(2);
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("voted indicator shows which players have voted", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      const targetUsername = setup.players[2].login.user.username;
      await voteForPlayer(setup.players[0].page, targetUsername);

      await expect(
        setup.players[0].page.locator("text=Voted").first(),
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        setup.players[0].page.locator("text=Waiting for other players"),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await setup.cleanup();
    }
  });
});
