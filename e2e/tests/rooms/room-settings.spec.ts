import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
  apiJoinRoom,
  apiUpdateRoomSettings,
} from "../../helpers/api-client";

test.describe("Room Settings", () => {
  test("host can update room settings", async () => {
    const accounts = await generateTestAccounts(1);
    const login = await apiLogin(accounts[0].email, accounts[0].password);
    const room = await apiCreateRoom(login.access_token);

    const result = await apiUpdateRoomSettings(
      room.id,
      { description_timer: 120, voting_timer: 90 },
      login.access_token,
    );

    expect(result).toHaveProperty("room_id", room.id);
    expect(result).toHaveProperty("settings");
  });

  test("non-host cannot update room settings", async () => {
    const accounts = await generateTestAccounts(2);
    const login1 = await apiLogin(accounts[0].email, accounts[0].password);
    const login2 = await apiLogin(accounts[1].email, accounts[1].password);
    const room = await apiCreateRoom(login1.access_token);
    const roomDetails = await apiGetRoom(room.id, login1.access_token);

    // Join as non-host
    await apiJoinRoom(
      roomDetails.public_id,
      login2.user.id,
      roomDetails.password,
      login2.access_token,
    );

    // Non-host tries to update settings — should fail
    await expect(
      apiUpdateRoomSettings(
        room.id,
        { description_timer: 120 },
        login2.access_token,
      ),
    ).rejects.toThrow(/403/);
  });
});
