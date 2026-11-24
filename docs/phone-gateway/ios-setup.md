# Setting up your iPhone to send texts from Platinum

DRAFT. These steps were written before anything was tried on a real iPhone. William will replace them with the tested steps from "iPhone texting: build steps". The numbered lines below are shown on the `/phone-setup` page, so keep each step to one numbered line.

## Before you start

- Your Gmail account (the one connected in Platinum's Firm settings) must be added to Apple's Mail app on this iPhone, with Mail turned on for it.
- You need the device key and the site address from the `/phone-setup` page. The key is shown once.

## Steps

1. Tap "Copy key" above, then tap "Get the shortcut" and add the shortcut to your Shortcuts app.
2. When the shortcut asks for its setup values, paste the key into "Device key".
3. Come back to this page, tap "Copy" next to the site address, and paste it into "Site address" in the shortcut.
4. Run the shortcut once by hand. When iOS asks, allow it to connect to the site and to send messages.
5. In the Shortcuts app, open Automation and add a new personal automation: "Email", sender is your own Gmail address, subject contains "Platinum wake".
6. Set the automation to "Run Immediately" and turn off "Notify When Run", then choose the Platinum shortcut as its action.
7. In Platinum, open Firm settings, find "Your phone", save your own phone number, and press "Send a test to my own number".
8. Within about a minute a text that says "Platinum test. Your phone is connected." should arrive from your own number, and the state in Platinum should say "Connected".

## What the shortcut does

It sends a request to the site address with the device key and `{"action":"claim"}`. If the answer has `"next":"send"`, it sends `body` to `to_phone` with Messages, then sends `{"action":"report","job_id":…,"claim_id":…,"result":"submitted"}` (or `"failed"` with an `error`). It repeats until the answer is `{"next":"none"}`.

The shortcut only sends. It never reads your messages and uploads nothing except whether each text was handed to Messages.

## If something goes wrong

- "Waiting for your phone" never changes: the wake email did not start the automation. Check that the Gmail account is in Apple's Mail app and that the automation's sender and subject match.
- "Not confirmed": the phone took a text but did not report back. Look in Messages on the phone before doing anything else, then answer "It was sent" or "It was not sent" in Platinum.
- "Stopped": three texts in a row got no answer. Fix the phone, then press "Send a test to my own number".
