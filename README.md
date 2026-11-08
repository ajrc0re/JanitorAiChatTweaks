# JanitorAiChatTweaks

Tampermonkey userscript that tweaks the JanitorAI chat page.

## Settings

Open the settings panel with the **gear** button at the end of the chat's bottom bar, or from the Tampermonkey menu: **Chat Tweaks settings**. Changes apply as soon as you press **Save**, and they're stored by Tampermonkey, not in the script file, so updating the script keeps them and no longer warns about overwriting your changes. **Reset to defaults** puts everything back.

Upgrading from 1.6 or older: if you had edited the old `cfg` block, let the update overwrite it once, then set the same values in the panel.

## Bottom bar buttons

- **#**: jump to any message by number, or press **Copy** and pick a message to copy its raw text.
- **Eraser**: strip the story notes tracker (the `~~~{...}` line) from older bot replies and save the edits to JanitorAI, so old trackers stop taking up context. The newest 3 bot replies keep theirs. It asks before editing anything. Change the pattern and how many are kept in the settings panel.
- **Export**: download the whole chat as a Markdown (`.md`) file. Tick **Include my persona at the top** to start the file with your persona's name and description. The checkbox is remembered.
- **Gear**: open the settings panel.
