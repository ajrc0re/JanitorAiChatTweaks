# JanitorAiChatTweaks

Tampermonkey userscript that tweaks the JanitorAI chat page. Settings live in the `cfg` block at the top of `JAI-Chat-Tweaks.user.js`.

## Bottom bar buttons

- **#**: jump to any message by number, or press **Copy** and pick a message to copy its raw text.
- **Eraser**: strip the story notes tracker (the `~~~{...}` line) from older bot replies and save the edits to JanitorAI, so old trackers stop taking up context. The newest 3 bot replies keep theirs. It asks before editing anything. Change the pattern with `trackerRegex` and the number kept with `keepTrackerCount` in `cfg`.
- **Export**: download the whole chat as a Markdown (`.md`) file. Tick **Include my persona at the top** to start the file with your persona's name and description. The checkbox is remembered.
