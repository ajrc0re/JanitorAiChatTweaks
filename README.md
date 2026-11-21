# JanitorAiChatTweaks

Tampermonkey userscript that tweaks the JanitorAI chat page. Saucepan.ai support is in progress.

## Saucepan.ai

The script also runs on saucepan.ai, with its own saved settings. There it adds only the bottom bar tools (jump/copy, eraser, export, settings), not the bubble, width or header styling. The eraser's default pattern matches Saucepan's story notes line (`>!{...}!<`, optionally inside `<notes>` tags), and at least the newest bot reply always keeps its notes, because the GM notebook is carried forward from it.

The Saucepan page itself isn't wired up yet, so for now only the settings panel (from the Tampermonkey menu) works there.

## Settings

Open the settings panel with the **gear** button at the end of the chat's bottom bar, or from the Tampermonkey menu: **Chat Tweaks settings**. Changes apply as soon as you press **Save**, and they're stored by Tampermonkey, not in the script file, so updating the script keeps them and no longer warns about overwriting your changes. **Reset to defaults** puts everything back.

Upgrading from 1.6 or older: if you had edited the old `cfg` block, let the update overwrite it once, then set the same values in the panel.

## Bottom bar buttons

- **#**: jump to any message by number, or press **Copy** and pick a message to copy its raw text.
- **Eraser**: strip the story notes tracker (the `~~~{...}` line) from older bot replies and save the edits to JanitorAI, so old trackers stop taking up context. The newest 3 bot replies keep theirs. It asks before editing anything. Change the pattern and how many are kept in the settings panel.
- **Export**: download the whole chat as a Markdown (`.md`) file. Tick **Include my persona at the top** to start the file with your persona's name and description. The checkbox is remembered.
- **Gear**: open the settings panel.
