# Clip Labels for Audacity 4

Adds one label per audio clip with an auto-incrementing code (`TST_1000`, `TST_1100`, ...), so
**File > Export Audio** can split by labels and write one file per clip.

Tested on Audacity 4.0.2 (Windows). Its extension API is undocumented and may change.

## Install

Copy this folder to `%LOCALAPPDATA%\audacity\Audacity4\extensions\clip-labels`, then restart Audacity
or use **Reload plugins**.

## Use

1. Select the audio track.
2. **Analyze > Label Clips** (adds a "Clip codes" label track; Undo removes it).
3. **File > Export Audio**, split into separate files by labels.

## Settings

| Setting | Default |
|---|---|
| Sequence code | `TST` |
| Start number | `1000` |
| Step | `100` |
| Zero padding | `4` |
| Separator | `_` |
| Append clip name | off |

Clips are numbered in timeline order. Going past the padding (e.g. over 9999) is an error.
