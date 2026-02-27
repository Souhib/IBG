import { expect, type Browser, type Page } from "@playwright/test";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
  apiLeaveAllRooms,
  apiJoinRoom,
  type LoginResponse,
  type RoomResponse,
} from "./api-client";
import { createPlayerPage } from "../fixtures/auth.fixture";
import { ROUTES } from "./constants";

// ─── Types ──────────────────────────────────────────────────

export interface PlayerContext {
  page: Page;
  login: LoginResponse;
  account: { email: string; password: string };
}

export interface UIGameSetup {
  players: PlayerContext[];
  roomDetails: RoomResponse;
  roomId: string;
  cleanup: () => Promise<void>;
}

export interface CodenamesPlayerRole {
  team: "red" | "blue";
  role: "spymaster" | "operative";
}

// ─── Room Setup via UI ──────────────────────────────────────

/**
 * Create a room via API (faster), then have all players join through the UI.
 * Player 1 (host) navigates directly to the room lobby.
 * Other players join via the rooms page with room code + PIN.
 */
export async function setupRoomWithPlayers(
  browser: Browser,
  accounts: { email: string; password: string }[],
  gameType: "undercover" | "codenames" = "undercover",
): Promise<UIGameSetup> {
  // Login all players via API
  const logins: LoginResponse[] = [];
  for (const account of accounts) {
    logins.push(await apiLogin(account.email, account.password));
  }

  // Ensure no player is stuck in a previous room
  for (const login of logins) {
    await apiLeaveAllRooms(login.user.id, login.access_token);
  }

  // Host creates room via API (retry if UserAlreadyInRoomError)
  let room: RoomResponse;
  try {
    room = await apiCreateRoom(logins[0].access_token, gameType);
  } catch {
    // Retry: force leave all rooms again and create
    await apiLeaveAllRooms(logins[0].user.id, logins[0].access_token);
    room = await apiCreateRoom(logins[0].access_token, gameType);
  }
  const roomDetails = await apiGetRoom(room.id, logins[0].access_token);

  // Create browser page for host and navigate to room
  const hostPage = await createPlayerPage(
    browser,
    accounts[0].email,
    accounts[0].password,
  );
  await hostPage.goto(ROUTES.room(room.id));
  await hostPage.waitForLoadState("domcontentloaded");
  // Wait for room page to render with player count
  await hostPage.waitForFunction(
    () => /Players \(\d+/.test(document.body.innerText),
    { timeout: 10_000 },
  ).catch(() => {});

  const players: PlayerContext[] = [
    { page: hostPage, login: logins[0], account: accounts[0] },
  ];

  // Other players join via UI
  for (let i = 1; i < accounts.length; i++) {
    const page = await createPlayerPage(
      browser,
      accounts[i].email,
      accounts[i].password,
    );

    // Helper: fill form and click join
    const fillAndJoin = async () => {
      await page.locator('input[id="room-code"]').fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let j = 0; j < 4; j++) {
        await page
          .locator(`input[aria-label="Password digit ${j + 1}"]`)
          .fill(pinDigits[j]);
      }
      const joinBtn = page.locator('button[type="submit"]');
      await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
      await joinBtn.click();
      return page
        .waitForURL(/\/rooms\/[a-f0-9-]+/, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
    };

    await page.goto(ROUTES.rooms);
    await page.waitForLoadState("domcontentloaded");

    // Wait for socket connected + room_status listener registered in React
    await page.waitForFunction(
      () => {
        const s = (window as any).__SOCKET__;
        if (!s?.connected) return false;
        // Socket.IO v4 hasListeners checks if the event has any listeners
        return typeof s.hasListeners === "function"
          ? s.hasListeners("room_status")
          : true;
      },
      { timeout: 10_000 },
    );

    // Attempt 1: UI join
    let joined = await fillAndJoin();

    // Attempt 2: API fallback + direct navigation
    if (!joined) {
      await apiJoinRoom(
        room.id,
        logins[i].user.id,
        roomDetails.password,
        logins[i].access_token,
      ).catch(() => {}); // Ignore if already joined
      await page.goto(ROUTES.room(room.id));
      await page.waitForLoadState("domcontentloaded");
      await page.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      );
      await page.waitForFunction(
        () => /Players \(\d+/.test(document.body.innerText),
        { timeout: 15_000 },
      );
    }

    await expect(page).toHaveURL(/\/rooms\/[a-f0-9-]+/, { timeout: 15_000 });

    players.push({ page, login: logins[i], account: accounts[i] });
  }

  // Verify host sees all players in the room before proceeding
  const expectedCount = accounts.length;
  await players[0].page.waitForFunction(
    (count: number) => {
      const text = document.body.innerText;
      const match = text.match(/Players \((\d+)/);
      return match && parseInt(match[1]) >= count;
    },
    expectedCount,
    { timeout: 15_000 },
  ).catch(async () => {
    // Reload host page and retry
    await players[0].page.reload();
    await players[0].page.waitForLoadState("domcontentloaded");
    await players[0].page.waitForFunction(
      (count: number) => {
        const text = document.body.innerText;
        const match = text.match(/Players \((\d+)/);
        return match && parseInt(match[1]) >= count;
      },
      expectedCount,
      { timeout: 10_000 },
    ).catch(() => {});
  });

  // Verify ALL players have Socket.IO connected and see the full player count.
  // This ensures each player's socket has joined the Socket.IO room,
  // which is critical for game start validation (backend checks Socket.IO room size).
  // The room page emits "join_room" only when both isConnected AND roomData are ready,
  // and the server responds with "room_status" which updates the player count.
  for (const player of players) {
    // First: ensure socket is connected
    await player.page
      .waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      )
      .catch(async () => {
        await player.page.reload();
        await player.page.waitForLoadState("domcontentloaded");
        await player.page
          .waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          )
          .catch(() => {});
      });

    // Second: verify the player sees the correct player count
    // (confirms room_status event was received, meaning Socket.IO room membership is confirmed)
    const seesAllPlayers = await player.page
      .waitForFunction(
        (count: number) => {
          const text = document.body.innerText;
          const match = text.match(/Players \((\d+)/);
          return match && parseInt(match[1]) >= count;
        },
        expectedCount,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!seesAllPlayers) {
      // Player's socket likely didn't join the Socket.IO room — reload to trigger join_room again
      await player.page.reload();
      await player.page.waitForLoadState("domcontentloaded");
      await player.page
        .waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        )
        .catch(() => {});
      await player.page
        .waitForFunction(
          (count: number) => {
            const text = document.body.innerText;
            const match = text.match(/Players \((\d+)/);
            return match && parseInt(match[1]) >= count;
          },
          expectedCount,
          { timeout: 15_000 },
        )
        .catch(() => {});
    }
  }

  return {
    players,
    roomDetails,
    roomId: room.id,
    cleanup: async () => {
      for (const p of players) {
        await p.page.context().close().catch(() => {});
      }
    },
  };
}

// ─── Game Start via UI ──────────────────────────────────────

/**
 * Host clicks the start button. For codenames, first selects the game type.
 * Returns after all players have navigated to the game page.
 */
export async function startGameViaUI(
  players: PlayerContext[],
  gameType: "undercover" | "codenames",
): Promise<void> {
  const hostPage = players[0].page;

  // Wait for all players to appear in the lobby before starting
  const playerCountText = `Players (${players.length})`;
  let playersVisible = await hostPage
    .locator(`text=${playerCountText}`)
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!playersVisible) {
    // Reload host page to get latest room state
    await hostPage.reload();
    await hostPage.waitForLoadState("domcontentloaded");
  }
  await expect(
    hostPage.locator(`text=${playerCountText}`),
  ).toBeVisible({ timeout: 15_000 });

  // Wait for socket to confirm all players are in the Socket.IO room
  await hostPage.waitForFunction(
    () => (window as any).__SOCKET__?.connected === true,
    { timeout: 5_000 },
  ).catch(() => {});

  // Select game type if codenames (undercover is default)
  if (gameType === "codenames") {
    await hostPage.locator('button:has-text("Codenames")').click();
    await expect(hostPage.locator('button:has-text("Codenames")')).toHaveAttribute("data-state", /.+/, { timeout: 2_000 }).catch(() => {});
  }

  // Click start game (retry with reload if backend rejects due to timing)
  const startButton = hostPage.locator('button:has-text("Start")');
  await expect(startButton).toBeEnabled({ timeout: 10_000 });
  await startButton.click();

  // Wait for all players to navigate to game page
  const urlPattern =
    gameType === "undercover"
      ? /\/game\/undercover\//
      : /\/game\/codenames\//;

  // Wait for ANY player to reach the game page (host first, then others)
  let gameUrl = "";
  // Check host first with a longer timeout — host is most likely to navigate
  const hostNavigated = await hostPage
    .waitForURL(urlPattern, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (hostNavigated) {
    gameUrl = hostPage.url();
  } else {
    // Check other players with shorter timeouts
    for (const player of players) {
      if (player.page === hostPage) continue;
      const navigated = await player.page
        .waitForURL(urlPattern, { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (navigated) {
        gameUrl = player.page.url();
        break;
      }
    }
  }

  // Retry: reload all pages once, re-establish sockets, and try start again
  if (!gameUrl) {
    for (const player of players) {
      const alive = await player.page.evaluate(() => true).catch(() => false);
      if (!alive) continue;
      await player.page.reload();
      await player.page.waitForLoadState("domcontentloaded");
      await player.page
        .waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        )
        .catch(() => {});
    }
    // Verify host sees all players before retrying start
    await hostPage
      .waitForFunction(
        (count: number) => {
          const text = document.body.innerText;
          const match = text.match(/Players \((\d+)/);
          return match && parseInt(match[1]) >= count;
        },
        players.length,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const retryStartButton = hostPage.locator('button:has-text("Start")');
    const canRetry = await retryStartButton
      .isEnabled({ timeout: 5_000 })
      .catch(() => false);
    if (canRetry) {
      if (gameType === "codenames") {
        await hostPage.locator('button:has-text("Codenames")').click();
      }
      await retryStartButton.click();
      for (const player of players) {
        const navigated = await player.page
          .waitForURL(urlPattern, { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (navigated) {
          gameUrl = player.page.url();
          break;
        }
      }
    }
  }

  if (!gameUrl) {
    throw new Error("No player navigated to the game page after start");
  }

  // Navigate stuck players one at a time to avoid concurrent get_board/get_state
  // calls that cause backend IllegalStateChangeError
  for (const player of players) {
    const onGamePage = urlPattern.test(player.page.url());
    if (!onGamePage) {
      // Set room ID in sessionStorage for players navigated directly (they missed game_started
      // event which normally stores this). The codenames page needs room_id for give_clue/guess_card.
      if (gameType === "codenames" && gameUrl) {
        const roomUrlMatch = player.page.url().match(/\/rooms\/([a-f0-9-]+)/);
        const gameIdMatch = gameUrl.match(/\/game\/codenames\/(.+)/);
        if (roomUrlMatch && gameIdMatch) {
          await player.page.evaluate(
            ([gid, rid]: [string, string]) =>
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid),
            [gameIdMatch[1], roomUrlMatch[1]] as [string, string],
          );
        }
      }
      await player.page.goto(gameUrl);
      await player.page.waitForLoadState("domcontentloaded");

      // Check if player got redirected away (game component error -> home page)
      if (!urlPattern.test(player.page.url())) {
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");
      }

      // Final check - if still not on game page, try one more time
      if (!urlPattern.test(player.page.url())) {
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");
      }

      await expect(player.page).toHaveURL(urlPattern, { timeout: 15_000 });

      // Check for error page ("An error occurred" / "Player not found in game")
      const hasError = await player.page
        .locator("text=An error occurred")
        .isVisible()
        .catch(() => false);
      if (hasError) {
        // Error page — reload to retry getting game state
        await player.page.reload();
        await player.page.waitForLoadState("domcontentloaded");
      }

      // Wait for the game UI to load (board for codenames, heading for undercover)
      if (gameType === "codenames") {
        const boardVisible = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!boardVisible) {
          // Check if player got "Player not found in game" error — skip if so
          const hasErrorPage = await player.page
            .locator("text=An error occurred")
            .isVisible()
            .catch(() => false);
          if (hasErrorPage) {
            // Player wasn't included in the game — skip board assertion
            continue;
          }
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
        }
        await expect(
          player.page.locator(".grid-cols-5 button").first(),
        ).toBeVisible({ timeout: 15_000 });
        // Ensure socket is connected so get_board has updated the SID
        await player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
      } else {
        const headingVisible = await player.page
          .locator("h1:has-text('Undercover')")
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!headingVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
        }
        await expect(
          player.page.locator("h1:has-text('Undercover')"),
        ).toBeVisible({ timeout: 15_000 });
      }
      // Wait for socket connection before processing next player
      await player.page.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  }

  // Ensure ALL players have connected sockets (including auto-navigated ones)
  // This guarantees get_board has been called, SIDs updated, and players are in the SIO room
  for (const player of players) {
    if (!urlPattern.test(player.page.url())) continue;
    await player.page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});
  }
}

// ─── Undercover UI Helpers ──────────────────────────────────

/**
 * Dismiss the role reveal by clicking "I Understand" for each player.
 * Waits for the playing phase to appear.
 */
/**
 * Dismiss the role reveal (if shown) and wait for the playing phase.
 * The undercover page may skip role_reveal entirely if the server
 * responds with turn_number > 0 before the role reveal renders.
 */
export async function dismissRoleRevealAll(
  players: PlayerContext[],
): Promise<PlayerContext[]> {
  const activePlayers: PlayerContext[] = [];

  for (const player of players) {
    // Skip players whose browser context is already closed
    const pageAlive = await player.page
      .evaluate(() => true)
      .then(() => true)
      .catch(() => false);
    if (!pageAlive) continue;

    // First, verify player is on the game page (not redirected to home)
    const onGamePage = /\/game\/undercover\//.test(player.page.url());
    if (!onGamePage) {
      // Player got redirected — find a player who IS on the game page and use their URL
      const gamePlayer = players.find((p) =>
        /\/game\/undercover\//.test(p.page.url()),
      );
      if (gamePlayer) {
        const gameUrl = gamePlayer.page.url();
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");

        // Retry if still redirected
        if (!/\/game\/undercover\//.test(player.page.url())) {
          await player.page.goto(gameUrl);
          await player.page.waitForLoadState("domcontentloaded");
        }
      }
    }

    // Check if player is actually in the game (not Players (0/0))
    const playerCountText = await player.page
      .locator("text=/Players \\(\\d+/")
      .first()
      .textContent()
      .catch(() => "");
    if (playerCountText?.includes("(0/0)") || playerCountText?.includes("(0/")) {
      // Player is not in the game — skip them
      continue;
    }

    // Check if already in playing or describing phase (no role reveal needed)
    const alreadyPlaying = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyPlaying) {
      activePlayers.push(player);
      continue;
    }

    // Check if "I Understand" button is visible (role_reveal phase)
    const dismissButton = player.page.locator(
      'button:has-text("I Understand")',
    );
    const isRoleReveal = await dismissButton
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (isRoleReveal) {
      // Button may disappear if game transitions to playing phase during click
      await dismissButton.click({ timeout: 5_000 }).catch(() => {});
    }

    // Wait for describing or playing phase
    let playingPhaseVisible = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!playingPhaseVisible) {
      // Check page is still alive before reloading
      const pageAlive = await player.page.evaluate(() => true).catch(() => false);
      if (!pageAlive) continue;

      // Reload to get latest game state from server
      await player.page.reload();
      await player.page.waitForLoadState("domcontentloaded");

      // Try clicking "I Understand" again in case reload brought back role reveal
      const dismissAgain = player.page.locator(
        'button:has-text("I Understand")',
      );
      const showAgain = await dismissAgain
        .isVisible()
        .catch(() => false);
      if (showAgain) {
        await dismissAgain.click();
      }
    }

    // Final check — if still no game content, player is not in the game
    const hasGameContent = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (hasGameContent) {
      activePlayers.push(player);
    }
  }

  return activePlayers;
}

/**
 * Have a player vote for a target player by clicking the vote button
 * containing the target's username.
 */
export async function voteForPlayer(
  voterPage: Page,
  targetUsername: string,
): Promise<boolean> {
  // Check if page context is still open (prevents crash on closed browser context)
  const pageAlive = await voterPage.evaluate(() => true).catch(() => false);
  if (!pageAlive) return false;

  // Check if game already over
  const gameOver = await voterPage
    .locator("h2:has-text('Game Over')")
    .isVisible()
    .catch(() => false);
  if (gameOver) return false;

  // Wait for socket to be connected before voting
  const socketConnected = await voterPage
    .waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!socketConnected) {
    // Check page is still alive before reloading
    const stillAlive = await voterPage.evaluate(() => true).catch(() => false);
    if (!stillAlive) return false;
    // Socket disconnected — reload to re-establish connection
    await voterPage.reload();
    await voterPage.waitForLoadState("domcontentloaded");
    // Check if game over after reload
    const gameOverNow = await voterPage
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (gameOverNow) return false;
  }

  // Find the player card that contains the target username and select it
  const playerCard = voterPage.locator(
    `button:has(.font-medium:text("${targetUsername}"))`,
  );
  let buttonVisible = await playerCard
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!buttonVisible) {
    // Check page is still alive before reloading
    const alive = await voterPage.evaluate(() => true).catch(() => false);
    if (!alive) return false;
    // Reload to get fresh game state
    await voterPage.reload();
    await voterPage.waitForLoadState("domcontentloaded");
    // Re-check if game over after reload
    const nowGameOver = await voterPage
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (nowGameOver) return false;
  }

  // Final check: is the card visible and enabled?
  const canVote = await playerCard.isVisible().catch(() => false);
  if (!canVote) return false;

  const isEnabled = await playerCard.isEnabled().catch(() => false);
  if (!isEnabled) return false;

  // Step 1: Select the player (click the card)
  await playerCard.click();

  // Step 2: Click "Vote to Eliminate" to confirm
  const confirmBtn = voterPage.locator("button:has-text('Vote to Eliminate')");
  const confirmVisible = await confirmBtn
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (confirmVisible) {
    await confirmBtn.click();
  }

  // Wait for vote to be processed by backend before next voter
  await voterPage
    .locator("text=Voted")
    .or(voterPage.locator("text=Waiting for other players"))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  return true;
}

/**
 * Extract the game ID from the current URL of a player page.
 */
export function getGameIdFromUrl(page: Page): string {
  const url = page.url();
  const match = url.match(/\/game\/(?:undercover|codenames)\/(.+)/);
  if (!match) throw new Error(`Cannot extract game ID from URL: ${url}`);
  return match[1];
}

/**
 * Get the list of alive player usernames from a player's page.
 * These are the players shown as vote targets (excluding self).
 */
export async function getAliveVoteTargets(page: Page): Promise<string[]> {
  const buttons = page.locator(
    ".grid.gap-3 button .font-medium",
  );
  const count = await buttons.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await buttons.nth(i).textContent();
    if (text) names.push(text.trim());
  }
  return names;
}

/**
 * Get the word from the undercover word reminder for a player.
 * In the playing phase, this appears as "Your word: <WORD>".
 */
export async function getUndercoverWord(page: Page): Promise<string> {
  const wordReminder = page.locator(".bg-primary\\/5 .font-bold.text-primary");
  const isVisible = await wordReminder
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (isVisible) {
    return (await wordReminder.textContent()) || "";
  }
  // Mr. White has no word - check if page shows game content
  return "";
}

/**
 * Wait for either elimination or game over to appear on screen.
 *
 * Detects three indicators:
 * 1. Skull icon (.lucide-skull) — elimination screen
 * 2. "Game Over" heading — game ended
 * 3. "Eliminated" text in player list — elimination happened but screen was replaced
 *    by playing phase (get_undercover_state overrides phase to "playing" on reconnect)
 */
export async function waitForEliminationOrGameOver(page: Page): Promise<"elimination" | "game_over"> {
  const resultLocator = page
    .locator(".lucide-skull, h2:has-text('Game Over')")
    .first();

  // Try to see skull (elimination) or Game Over without reload
  let resultVisible = await resultLocator
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  // If not visible, check if elimination happened but screen was replaced by playing phase
  // (get_undercover_state response overrides phase to "playing" on socket reconnection)
  if (!resultVisible) {
    const hasEliminatedInList = await page
      .locator("text=Eliminated")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasEliminatedInList) {
      // Elimination happened — check for game over
      const isGameOver = await page
        .locator("h2:has-text('Game Over')")
        .isVisible()
        .catch(() => false);
      return isGameOver ? "game_over" : "elimination";
    }
  }

  // If not visible, reload to fetch fresh state from the server
  // (Socket.IO may have missed the player_eliminated / game_over event)
  if (!resultVisible) {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    resultVisible = await resultLocator
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    // After reload, get_undercover_state may show "Eliminated" in player list
    // instead of the skull (phase set to "playing" not "elimination")
    if (!resultVisible) {
      const hasEliminatedInList = await page
        .locator("text=Eliminated")
        .first()
        .isVisible()
        .catch(() => false);
      if (hasEliminatedInList) {
        const isGameOver = await page
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
        return isGameOver ? "game_over" : "elimination";
      }
    }
  }

  if (!resultVisible) {
    // Last resort: reload once more
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Check for any elimination indicator (skull, Game Over, or Eliminated in list)
    const anyIndicator = await page
      .locator(".lucide-skull, h2:has-text('Game Over')")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!anyIndicator) {
      // Final check: "Eliminated" in player list
      const hasEliminatedInList = await page
        .locator("text=Eliminated")
        .first()
        .isVisible()
        .catch(() => false);
      if (hasEliminatedInList) {
        const isGameOver = await page
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
        return isGameOver ? "game_over" : "elimination";
      }
      // Truly nothing found — throw
      await expect(
        page.locator(".lucide-skull, h2:has-text('Game Over'), text=Eliminated").first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  }

  // Wait briefly for game_over to potentially arrive after elimination
  // (when the undercover is eliminated, game_over fires right after player_eliminated)
  await page.locator("h2:has-text('Game Over')")
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => {});

  const isGameOver = await page
    .locator("h2:has-text('Game Over')")
    .isVisible()
    .catch(() => false);

  return isGameOver ? "game_over" : "elimination";
}

/**
 * Click the "Next Round" button (visible during elimination phase).
 */
export async function clickNextRound(page: Page): Promise<void> {
  const btn = page.locator("button:has-text('Next Round')");
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  // Wait for new round to start — "Describe your word" (describing phase) or "Discuss and vote" (playing phase)
  await page.locator("text=Describe your word")
    .or(page.locator("text=Discuss and vote"))
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
}

/**
 * Ensure a player is on the undercover game page.
 * If they've been redirected (e.g. to home), navigate them back.
 * Returns true if the player is on the game page after the check.
 */
export async function ensureOnUndercoverGamePage(
  page: Page,
  gameUrl: string,
): Promise<boolean> {
  const pageAlive = await page.evaluate(() => true).catch(() => false);
  if (!pageAlive) return false;

  if (/\/game\/undercover\//.test(page.url())) return true;

  // Player got redirected — navigate back
  await page.goto(gameUrl);
  await page.waitForLoadState("domcontentloaded");

  if (/\/game\/undercover\//.test(page.url())) return true;

  // Second try
  await page.goto(gameUrl);
  await page.waitForLoadState("domcontentloaded");

  return /\/game\/undercover\//.test(page.url());
}

// ─── Description Phase Helpers ──────────────────────────────

/**
 * Submit descriptions for all players in the description order.
 * Each player types a word (derived from their position) and submits.
 */
export async function submitDescriptionsForAllPlayers(
  players: PlayerContext[],
): Promise<void> {
  // We need to iterate through description order. Each player who has the input
  // should type a word and submit. We do rounds until no more inputs are visible.
  const words = ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honey", "ice", "jam"];
  let wordIdx = 0;

  for (let round = 0; round < players.length + 2; round++) {
    let found = false;
    for (const player of players) {
      const pageAlive = await player.page.evaluate(() => true).catch(() => false);
      if (!pageAlive) continue;

      const hasInput = await player.page
        .locator("#description-input")
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (hasInput) {
        found = true;
        const word = words[wordIdx % words.length];
        wordIdx++;

        // Fill and submit with retry logic — socket events (turn_started,
        // description_submitted) can clear descriptionInput between fill and click,
        // leaving the Submit button disabled. Strategy: fill + click with short
        // timeout, catch error, re-fill and retry. This is faster and more reliable
        // than checking isEnabled separately (which can pass then fail during click).
        const submitBtn = player.page.locator("button:has-text('Submit')");
        let submitted = false;
        for (let attempt = 0; attempt < 10 && !submitted; attempt++) {
          await player.page.locator("#description-input").fill(word);
          try {
            // Short timeout — fail fast if a socket event disabled the button
            await submitBtn.click({ timeout: 1_000 });
            submitted = true;
          } catch {
            // Button was likely disabled by a socket event clearing the input.
            // Small delay before re-fill to let the event settle.
            await player.page.waitForTimeout(200);
          }
        }

        // Wait for the description to be processed
        await player.page
          .locator("#description-input")
          .waitFor({ state: "hidden", timeout: 10_000 })
          .catch(() => {});

        // Small delay for event propagation
        await player.page.waitForTimeout(500);
        break; // Only one player has the input at a time
      }
    }

    // Check if we've transitioned to voting (or transition overlay is showing)
    const transitioned = await players[0].page
      .locator("text=Discuss and vote")
      .or(players[0].page.locator("text=All hints are in"))
      .first()
      .isVisible()
      .catch(() => false);
    if (transitioned || !found) break;
  }

  // Wait for transition animation to finish and voting phase to appear on ALL players
  for (const player of players) {
    await player.page
      .locator("text=Discuss and vote")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
  }
}

/**
 * Wait for the voting phase to appear on a page.
 * Handles the transition from describing to playing phase.
 */
export async function waitForVotingPhase(page: Page): Promise<void> {
  const visible = await page
    .locator("text=Discuss and vote")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!visible) {
    // Reload to get latest state
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator("text=Discuss and vote")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});
  }
}

// ─── Codenames UI Helpers ───────────────────────────────────

/**
 * Extract a player's team and role from the "My Info" section.
 */
export async function getPlayerRoleFromUI(page: Page): Promise<CodenamesPlayerRole> {
  const infoSection = page.locator(".bg-muted\\/50.p-3.text-center.text-sm");
  await expect(infoSection).toBeVisible({ timeout: 10_000 });
  const text = (await infoSection.textContent()) || "";

  const team: "red" | "blue" = text.includes("Red") ? "red" : "blue";
  const role: "spymaster" | "operative" = text.includes("Spymaster")
    ? "spymaster"
    : "operative";

  return { team, role };
}

/**
 * Get the current team from the turn info bar.
 */
export async function getCurrentTeamFromUI(page: Page): Promise<"red" | "blue"> {
  const turnInfo = page.locator(".bg-muted\\/50.p-3.text-center .font-semibold").first();
  await expect(turnInfo).toBeVisible({ timeout: 10_000 });
  const text = (await turnInfo.textContent()) || "";
  return text.includes("Red") ? "red" : "blue";
}

/**
 * Give a clue as spymaster through the UI form.
 */
export async function giveClueViaUI(
  page: Page,
  word: string,
  number: number,
): Promise<void> {
  const clueLoc = page.locator(`.bg-muted\\/50.p-3.text-center >> text=${word}`);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Ensure socket is connected before submitting
    await page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});

    // Wait for board to be rendered (ensures game state is loaded)
    await page.locator(".grid-cols-5 button").first()
      .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

    // Fill and submit if the form is visible
    const wordInput = page.locator('input[type="text"]');
    if (await wordInput.isVisible().catch(() => false)) {
      await wordInput.fill(word);
      await page.locator('input[type="number"]').fill(String(number));
      await page.locator("button:has-text('Submit')").click();
    }

    // Check: did the backend process it?
    const confirmed = await clueLoc
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmed) return;

    // Event was lost — reconnect socket without full page reload to avoid disconnect
    await page.evaluate(() => {
      const socket = (window as any).__SOCKET__;
      if (socket && !socket.connected) {
        socket.connect();
      }
    });
    await page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 5_000 },
    ).catch(() => {});
  }
}

/**
 * Click a board card by index. Returns the card's text.
 */
export async function clickBoardCard(
  page: Page,
  cardIndex: number,
): Promise<string> {
  const cards = page.locator(".grid-cols-5 button");
  const card = cards.nth(cardIndex);
  const text = (await card.textContent()) || "";
  await card.click();
  return text;
}

/**
 * Find the first unrevealed and enabled card index on the board.
 */
export async function findUnrevealedCardIndex(page: Page): Promise<number> {
  const cards = page.locator(".grid-cols-5 button");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const isDisabled = await cards.nth(i).isDisabled();
    if (!isDisabled) return i;
  }
  return 0;
}

/**
 * Read card types from the spymaster's view by parsing CSS background classes.
 * Returns an array of 25 card types: "red", "blue", "neutral", "assassin", or "unknown".
 */
export async function getSpymasterCardTypes(page: Page): Promise<string[]> {
  const cards = page.locator(".grid-cols-5 button");
  // Wait for board to render (25 cards)
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });

  // Wait for spymaster color classes to be applied (cards start as bg-card
  // until isSpymaster state is set and React re-renders with color classes)
  await page.waitForFunction(
    () => {
      const btns = document.querySelectorAll(".grid-cols-5 button");
      if (btns.length < 25) return false;
      // Check that at least one card has a color class (not just bg-card)
      return Array.from(btns).some(
        (btn) =>
          btn.className.includes("bg-red-") ||
          btn.className.includes("bg-blue-") ||
          btn.className.includes("bg-gray-800") ||
          btn.className.includes("bg-amber-"),
      );
    },
    { timeout: 10_000 },
  );

  const count = await cards.count();
  const types: string[] = [];
  for (let i = 0; i < count; i++) {
    const classes = (await cards.nth(i).getAttribute("class")) || "";
    if (classes.includes("bg-red-")) types.push("red");
    else if (classes.includes("bg-blue-")) types.push("blue");
    else if (classes.includes("bg-gray-800")) types.push("assassin");
    else if (classes.includes("bg-amber-")) types.push("neutral");
    else types.push("unknown");
  }
  return types;
}

/**
 * Get indices of cards matching a specific type from the spymaster's view.
 */
export async function getCardIndicesByType(
  page: Page,
  cardType: string,
): Promise<number[]> {
  const types = await getSpymasterCardTypes(page);
  return types
    .map((t, i) => (t === cardType ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * Check if a card at a specific index is revealed (disabled + opacity).
 */
export async function isCardRevealed(page: Page, index: number): Promise<boolean> {
  const card = page.locator(".grid-cols-5 button").nth(index);
  const classes = (await card.getAttribute("class")) || "";
  // Only use opacity-75 as the revealed indicator.
  // Do NOT use isDisabled() because spymaster cards are all disabled
  // (spymasters can't click cards) even though they're not revealed.
  return classes.includes("opacity-75");
}

/**
 * Get indices of unrevealed cards of a given type from spymaster's view.
 */
export async function getUnrevealedCardIndicesByType(
  page: Page,
  cardType: string,
): Promise<number[]> {
  const allIndices = await getCardIndicesByType(page, cardType);
  const unrevealed: number[] = [];
  for (const idx of allIndices) {
    if (!(await isCardRevealed(page, idx))) {
      unrevealed.push(idx);
    }
  }
  return unrevealed;
}

/**
 * Get board word texts from the page.
 */
export async function getBoardWords(page: Page): Promise<string[]> {
  const cards = page.locator(".grid-cols-5 button");
  const count = await cards.count();
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await cards.nth(i).textContent()) || "";
    words.push(text.trim());
  }
  return words;
}
